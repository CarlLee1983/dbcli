import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { collectInspect, renderJson, renderMarkdown } from '@/core/inspect'

const ALLOWED_FORMATS = ['json', 'markdown'] as const

export const inspectCommand = new Command()
  .name('inspect')
  .description(t('inspect.description'))
  .option('--format <format>', 'Output format: json (default) or markdown', 'json')
  .option('--brief', 'Trim samples / intents / commands for compact output', false)
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .option('--no-connect', 'Skip the database connect + version probe')
  .option(
    '--probe-timeout <ms>',
    'Hard timeout for cheap version/object probe (default 1500)',
    (v) => parseInt(v, 10),
    1500
  )
  .action(async (options: Record<string, unknown>, command: Command) => {
    try {
      const forAgent = options.forAgent === true
      const format = forAgent ? 'json' : (options.format as string)
      const brief = forAgent || options.brief === true
      validateFormat(format, ALLOWED_FORMATS, 'inspect')

      const configPath = resolveConfigPath(command, options as { config?: string })
      const snap = await collectInspect({
        workspace: process.cwd(),
        configPath,
        noConnect: options.connect === false,
        brief,
        probeTimeoutMs: options.probeTimeout as number,
      })

      const out =
        format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
      console.log(out)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
