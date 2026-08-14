// Full command runtime. Keep the lightweight process entry point in cli.ts so
// standalone version checks do not parse database drivers and every command.
//
// IMPORTING THIS MODULE RUNS THE CLI. The bottom of the file calls outputHelp()
// and parseAsync(process.argv) at top level, so an import never returns a module
// — it dispatches against the host process's argv and can exit. Only cli.ts may
// import it, and only to launch. For an inert command tree use buildProgram()
// from ./program (synchronous, side-effect free, what check-cli-contract.ts,
// completion and the REPL walk). package.json exports no entry that reaches
// here; tests/integration/runtime-contract.test.ts pins both facts.
import type { Command } from 'commander'
import pkg from '../package.json'
import { createLogger, setGlobalLogger, LogLevel } from './utils/logger'
import { checkForUpdate, type VersionCheckCache } from './utils/version-check'
import { setGlobalConnectionName } from './core/config'
import { setGlobalConnectionTimeout, setGlobalStatementTimeout } from './utils/connection-timeout'
import { resolveConnectionSelector } from './core/connection-selector'
import { resolveConfigPath } from './utils/config-path'
import { isMachineReadableCommand } from './utils/cli-output'
import { claimUpdateHint, defaultCliSessionKey } from './utils/update-hint-state'
import { readSkillCheckCache, writeSkillCheckCache } from './utils/skill-check-cache'
import { buildProgramFor } from './program-lazy'
import { presentCliError } from './utils/cli-error'
import { join } from 'path'
import { writeSync } from 'node:fs'
import { format } from 'node:util'

/**
 * Bun versions supported by dbcli can exit before asynchronous pipe writes are
 * drained. Use blocking fd writes whenever stdout is redirected so every CLI
 * output path, including commands that call process.exit(), is complete.
 */
function installSynchronousRedirectedStdout(): void {
  if (process.stdout.isTTY) return

  const retrySignal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const writeAll = (bytes: Uint8Array): void => {
    let offset = 0
    while (offset < bytes.byteLength) {
      let written: number
      try {
        written = writeSync(1, bytes, offset, bytes.byteLength - offset)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
          Atomics.wait(retrySignal, 0, 0, 1)
          continue
        }
        throw error
      }
      if (written === 0) throw new Error('Unable to write CLI output to stdout')
      offset += written
    }
  }

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ): boolean => {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined
    const onComplete = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)
    writeAll(bytes)
    onComplete?.()
    return true
  }) as typeof process.stdout.write

  console.log = (...args: unknown[]) => {
    writeAll(Buffer.from(`${format(...args)}\n`))
  }
}

installSynchronousRedirectedStdout()

// Module-level state for background version check
let _bgVersionCheckResult: { hasUpdate: boolean; latestVersion: string } | null | undefined
let _bgVersionCheckContext: {
  configPath: string
  sessionKey: string
  machineOutput: boolean
} | null = null

function shouldSkipBackgroundChecks(): boolean {
  return (
    process.env.DBCLI_NO_UPDATE_CHECK === '1' ||
    process.env.DBCLI_NO_UPDATE_CHECK === 'true' ||
    process.env.NODE_ENV === 'test'
  )
}

// Commands whose normal-case output must stay quiet (no update / skill reminders).
// `completion` is included because its stdout is eval'd at shell startup.
const QUIET_OUTPUT_COMMANDS = new Set(['upgrade', 'completion'])

/**
 * Building the program now involves a dynamic import per invocation (ADR 0007),
 * so it can fail where the old static construction could not. Route that
 * failure through the same presenter as every other CLI error instead of
 * letting it surface as an unhandled rejection.
 */
async function buildProgramOrExit(): Promise<Command> {
  try {
    return await buildProgramFor(process.argv)
  } catch (error) {
    presentCliError(error)
    process.exit(1)
  }
}

const program = await buildProgramOrExit()

function misplacedConnectionSelectorHint(): string | undefined {
  const rawArgs = process.argv.slice(2)
  let commandName: string | undefined
  let commandIndex = -1

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]!
    if (token === '--') break
    if (token === '--config' || token === '--use') {
      index += 1
      continue
    }
    if (token.startsWith('--config=') || token.startsWith('--use=') || token.startsWith('-')) {
      continue
    }
    commandName = token
    commandIndex = index
    break
  }

  const command = program.commands.find((candidate) => candidate.name() === commandName)
  if (!command || command.options.some((option) => option.long === '--use')) return undefined

  const misplacedOptionIndex = rawArgs.findIndex(
    (token, index) => index > commandIndex && (token === '--use' || token.startsWith('--use='))
  )
  if (misplacedOptionIndex === -1) return undefined

  const commandPath = [command.name()]
  let currentCommand = command
  for (const token of rawArgs.slice(commandIndex + 1, misplacedOptionIndex)) {
    const child = currentCommand.commands.find((candidate) => candidate.name() === token)
    if (!child) continue
    commandPath.push(child.name())
    currentCommand = child
  }

  return `Hint: Place --use before the command: dbcli --use <connection> ${commandPath.join(' ')}`
}

function configureConnectionSelectorHints(command: typeof program): void {
  command.configureOutput({
    outputError: (message, write) => {
      const hint = /unknown option '--use(?:'|=)/.test(message)
        ? misplacedConnectionSelectorHint()
        : undefined
      write(hint ? `${message}${hint}\n` : message)
    },
  })
  for (const child of command.commands) configureConnectionSelectorHints(child as typeof program)
}

configureConnectionSelectorHints(program)

program.hook('preAction', (thisCommand, actionCommand) => {
  // A program instance can be exercised more than once in tests or by an
  // embedding caller. Never let a completed check from the previous action
  // leak into the next command's stderr.
  _bgVersionCheckResult = undefined
  _bgVersionCheckContext = null

  const opts = thisCommand.opts()
  const machineOutput = isMachineReadableCommand(actionCommand, thisCommand)

  setGlobalConnectionName(
    resolveConnectionSelector({
      root: opts.use as string | undefined,
      command: actionCommand.opts().use as string | undefined,
      environment: process.env.DBCLI_CONNECTION,
    })
  )

  setGlobalConnectionTimeout(opts.timeout as number | undefined)
  setGlobalStatementTimeout(opts.statementTimeout as number | undefined)

  if (opts.color === false) {
    process.env.NO_COLOR = '1'
  }

  let level = LogLevel.NORMAL
  if (opts.quiet) {
    level = LogLevel.QUIET
  } else if (opts.verbose >= 2) {
    level = LogLevel.DEBUG
  } else if (opts.verbose >= 1) {
    level = LogLevel.VERBOSE
  }

  setGlobalLogger(createLogger(level))

  const configPath = resolveConfigPath(actionCommand)
  _bgVersionCheckContext = {
    configPath,
    sessionKey: defaultCliSessionKey(),
    machineOutput,
  }

  if (
    !opts.quiet &&
    !QUIET_OUTPUT_COMMANDS.has(actionCommand.name()) &&
    !machineOutput &&
    !shouldSkipBackgroundChecks()
  ) {
    void (async () => {
      try {
        let cache: VersionCheckCache | null = null
        try {
          const cacheFile = Bun.file(join(configPath, 'version-check.json'))
          if (await cacheFile.exists()) {
            cache = (await cacheFile.json()) as VersionCheckCache
          }
        } catch {
          // ignore
        }
        const result = await checkForUpdate(pkg.version, configPath, cache)
        _bgVersionCheckResult = result
      } catch {
        _bgVersionCheckResult = null
      }
    })()
  }
})

program.hook('postAction', async (thisCommand, actionCommand) => {
  const context = _bgVersionCheckContext
  if (
    _bgVersionCheckResult?.hasUpdate &&
    context &&
    !context.machineOutput &&
    !thisCommand.opts().quiet &&
    !QUIET_OUTPUT_COMMANDS.has(actionCommand.name()) &&
    (await claimUpdateHint(
      context.configPath,
      'update',
      context.sessionKey,
      _bgVersionCheckResult.latestVersion
    ))
  ) {
    const { formatUpdateHint } = await import('./commands/upgrade')
    process.stderr.write(formatUpdateHint(_bgVersionCheckResult.latestVersion) + '\n')
  }

  const isQuietOutput =
    QUIET_OUTPUT_COMMANDS.has(actionCommand.name()) || actionCommand.name() === 'skill'
  if (
    !thisCommand.opts().quiet &&
    !isQuietOutput &&
    !context?.machineOutput &&
    !shouldSkipBackgroundChecks()
  ) {
    // TTL 快取：有效期內完全不碰 skill 檔案。掃描本身要讀十來個檔，而結論
    // 幾乎永遠是「沒事」——那筆成本不該由每一個命令的收尾承擔（#45）。
    const skillCacheKey = context?.configPath ?? resolveConfigPath(actionCommand)
    let outdatedSkills = await readSkillCheckCache(skillCacheKey, pkg.version)
    if (outdatedSkills === null) {
      const { checkSkillUpdates } = await import('./commands/skill')
      outdatedSkills = await checkSkillUpdates()
      await writeSkillCheckCache(skillCacheKey, pkg.version, outdatedSkills)
    }
    if (
      outdatedSkills.length > 0 &&
      context &&
      (await claimUpdateHint(
        context.configPath,
        'skill',
        context.sessionKey,
        outdatedSkills.slice().sort().join(',')
      ))
    ) {
      const { formatSkillUpdateReminder } = await import('./commands/upgrade')
      process.stderr.write(formatSkillUpdateReminder(outdatedSkills) + '\n')
    }
  }
})

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

try {
  await program.parseAsync(process.argv)
} catch (error) {
  presentCliError(error)
  process.exitCode = 1
}

export default program
