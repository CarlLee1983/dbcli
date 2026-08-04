import pkg from '../package.json'
import { createLogger, setGlobalLogger, LogLevel } from './utils/logger'
import { formatUpdateHint, formatSkillUpdateReminder } from './commands/upgrade'
import { checkForUpdate, type VersionCheckCache } from './utils/version-check'
import { checkSkillUpdates } from './commands/skill'
import { setGlobalConnectionName } from './core/config'
import { resolveConnectionSelector } from './core/connection-selector'
import { resolveConfigPath } from './utils/config-path'
import { isMachineReadableCommand } from './utils/cli-output'
import { claimUpdateHint, defaultCliSessionKey } from './utils/update-hint-state'
import { buildProgram } from './program'
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

const program = buildProgram()

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
    const outdatedSkills = await checkSkillUpdates()
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
