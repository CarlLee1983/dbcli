import { Command } from 'commander'
import crypto from 'node:crypto' // Phase 25 D-51
import { t } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { collectInspect, renderJson, renderMarkdown } from '@/core/inspect'
import { configModule } from '@/core/config'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import {
  attachCommandEvidenceReceipt,
  finalizeCommandEvidenceReceipt,
} from '@/commands/command-evidence-receipt'

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

      // Phase 25 DOCS-02: embed last N audit entries on agent JSON paths.
      if (config) {
        const { shouldEmbedRecent, loadRecentAudit } = await import('@/core/audit/recent')
        if (shouldEmbedRecent({ forAgent, format })) {
          snap.audit_recent = await loadRecentAudit(config, configPath)
        }
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
      let auditId: string | null = null
      let envelopeId: string | undefined
      if (options.recovery === true) {
        envelopeId = crypto.randomUUID() // Phase 25 D-51 / D-J
      }
      if (config) {
        auditId = await writeAuditEntry(config, 'inspect', options, {
          success: false,
          target: '*',
          error: err,
          ...(envelopeId && { recovery_ref: envelopeId }), // Phase 25 D-J
        })
      }

      if (envelopeId !== undefined) {
        await finalizeCommandEvidenceReceipt(command, 'inspect', 'failed', config, auditId)
        const { emitRecoveryEnvelope } = await import('@/core/recovery')
        emitRecoveryEnvelope(
          err,
          { operation: 'inspect' },
          {
            envelopeId, // Phase 25 D-51
            auditRef: auditId ?? undefined, // Phase 25 K1
          }
        )
      }
      console.error((err as Error).message)
      await finalizeCommandEvidenceReceipt(command, 'inspect', 'failed', config, auditId)
      process.exit(1)
    }
  })

attachCommandEvidenceReceipt(inspectCommand, 'inspect')
