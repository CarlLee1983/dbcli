import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { collectInspect, renderJson, renderMarkdown } from '@/core/inspect'
import { configModule } from '@/core/config'
import { writeAuditEntry } from '@/core/audit/integration-helper'

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
  .option(
    '--recovery',
    'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
    false
  )
  .option(
    '--require-schema-cache',
    'Throw SCHEMA_CACHE_MISSING (recovery code) when the active SQL connection has no usable schema cache',
    false
  )
  .action(async (options: Record<string, unknown>, command: Command) => {
    let config: any
    try {
      const forAgent = options.forAgent === true
      const format = forAgent ? 'json' : (options.format as string)
      const brief = forAgent || options.brief === true
      validateFormat(format, ALLOWED_FORMATS, 'inspect')

      const configPath = resolveConfigPath(command, options as { config?: string })
      config = await configModule.read(configPath)

      const snap = await collectInspect({
        workspace: process.cwd(),
        configPath,
        noConnect: options.connect === false,
        brief,
        probeTimeoutMs: options.probeTimeout as number,
      })

      if (options.requireSchemaCache === true) {
        const { requireSchemaCacheOrThrow } = await import('@/core/inspect')
        requireSchemaCacheOrThrow(snap.schemaCache, snap.system ?? null)
      }

      const out =
        format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
      console.log(out)

      if (config) {
        await writeAuditEntry(config, 'inspect', options, {
          success: true,
          target: '*',
        })
      }
    } catch (err) {
      if (config) {
        await writeAuditEntry(config, 'inspect', options, {
          success: false,
          target: '*',
          error: err,
        })
      }

      if (options.recovery === true) {
        const { emitRecoveryEnvelope } = await import('@/core/recovery')
        emitRecoveryEnvelope(err, { operation: 'inspect' })
      }
      console.error((err as Error).message)
      process.exit(1)
    }
  })
