/**
 * AuditIntegrationHelper — centralized entry point for wiring audit logs into commands.
 */
import { AuditLogger } from './logger'
import { SessionIdService } from './session-id'
import { resolveConfigStoragePath } from '../config-binding'
import { getGlobalConnectionName } from '../config'
import type { DbcliConfig } from '../../utils/validation'
import type { DatabaseSystem } from '../../adapters/types'
import { getEngineCapability } from '../../adapters/capabilities'
import { redactArgv, redactSql, redactSensitive } from '../../utils/redaction'
import { getOperationTarget } from '../../utils/engine-hints'
import type { AuditEntry } from './types'

let _sessionIdService: SessionIdService | null = null
const _loggers = new Map<string, AuditLogger>()

/**
 * Get or create an AuditLogger for the given connection.
 */
export async function getAuditLogger(
  config: DbcliConfig,
  configPath: string
): Promise<AuditLogger> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const connName =
    (config as { effectiveConnectionName?: string }).effectiveConnectionName ||
    getGlobalConnectionName() ||
    'default'
  const key = `${storagePath}:${connName}`

  if (!_loggers.has(key)) {
    if (!_sessionIdService) {
      _sessionIdService = new SessionIdService(storagePath)
    }
    _loggers.set(
      key,
      new AuditLogger({
        storagePath,
        connectionName: connName,
        enabled: config.audit?.enabled ?? true,
        rotation: {
          maxBytes: config.audit?.rotation?.max_bytes ?? 10_485_760,
          maxEntries: config.audit?.rotation?.max_entries ?? 1000,
        },
        sessionIdService: _sessionIdService,
      })
    )
  }
  return _loggers.get(key)!
}

export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
}

/**
 * High-level helper to write an audit entry from a command handler.
 * Catch-all for D6 (non-blocking) and standardizing fields.
 */
export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<void> {
  try {
    const logger = await getAuditLogger(config, options.config || '.dbcli')
    const engine = (config.connection?.system as DatabaseSystem) || 'postgresql'

    // 1. Resolve Target
    const target = outcome.target || getOperationTarget(engine, commandName, options, outcome.sql)

    // 2. Resolve Side Effect Tier
    let tier = getEngineCapability(engine, commandName as any).tier
    if (options.dryRun || options.plan) {
      tier = 'dry-run'
    }

    // 3. Redact Error (if any)
    let errorMessage: string | undefined
    if (outcome.error) {
      errorMessage = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
      errorMessage = redactSensitive(errorMessage)
    }

    // 4. Build Entry
    const entry: Omit<AuditEntry, 'id' | 'ts' | 'session_id'> = {
      engine,
      command: commandName,
      side_effect_tier: tier,
      target,
      success: outcome.success,
      redacted_query: redactArgv(process.argv),
      ...(outcome.sql && { redacted_sql: redactSql(outcome.sql) }),
      ...(errorMessage && { error: errorMessage }),
      metadata: outcome.metadata,
    }

    await logger.write(entry)
  } catch {
    // D6: Never throw from audit integration.
    // Logger already prints to stderr once if write fails.
  }
}
