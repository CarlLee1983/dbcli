import pkg from '../package.json'
import { createLogger, setGlobalLogger, LogLevel } from './utils/logger'
import { formatUpdateHint, formatSkillUpdateReminder } from './commands/upgrade'
import { checkForUpdate, type VersionCheckCache } from './utils/version-check'
import { checkSkillUpdates } from './commands/skill'
import { setGlobalConnectionName } from './core/config'
import { resolveConfigPath } from './utils/config-path'
import { buildProgram } from './program'
import { join } from 'path'

// Module-level state for background version check
let _bgVersionCheckResult: { hasUpdate: boolean; latestVersion: string } | null | undefined

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

program.hook('preAction', (thisCommand, actionCommand) => {
  const opts = thisCommand.opts()

  const useConnection = opts.use as string | undefined
  setGlobalConnectionName(useConnection)

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

  if (!opts.quiet && !QUIET_OUTPUT_COMMANDS.has(actionCommand.name()) && !shouldSkipBackgroundChecks()) {
    const configPath = resolveConfigPath(actionCommand)
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
  if (_bgVersionCheckResult?.hasUpdate) {
    process.stderr.write(formatUpdateHint(_bgVersionCheckResult.latestVersion) + '\n')
  }

  const isQuietOutput = QUIET_OUTPUT_COMMANDS.has(actionCommand.name()) || actionCommand.name() === 'skill'
  if (!thisCommand.opts().quiet && !isQuietOutput && !shouldSkipBackgroundChecks()) {
    const outdatedSkills = await checkSkillUpdates()
    if (outdatedSkills.length > 0) {
      process.stderr.write(formatSkillUpdateReminder(outdatedSkills) + '\n')
    }
  }
})

// Show help when no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

program.parse(process.argv)

export default program
