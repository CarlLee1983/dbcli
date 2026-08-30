/**
 * AuditIntegrationHelper — centralized entry point for wiring audit logs into commands.
 */
import { AuditLogger, type AuditWriteResult } from './logger'
import { SessionIdService } from './session-id'
import { resolveConfigStoragePath } from '../config-binding'
import { getGlobalConnectionName } from '../config'
import type { DbcliConfig } from '../../utils/validation'
import type { DatabaseSystem } from '../../adapters/types'
import { getEngineCapability, type SideEffectTier } from '../../adapters/capabilities'
import {
  redactArgv,
  redactArgvSensitiveText,
  redactSql,
  redactSensitive,
} from '../../utils/redaction'
import { getOperationTarget } from '../../utils/engine-hints'
import type { AuditEntry } from './types'

let _sessionIdService: SessionIdService | null = null
const _loggers = new Map<string, AuditLogger>()

/**
 * Get or create an AuditLogger for the given connection.
 */
export async function getAuditLogger(
  config: DbcliConfig,
  configPath: string,
  connectionName?: string
): Promise<AuditLogger> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const connName =
    connectionName ||
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
  /**
   * What the statement this entry is about would do, when the command's
   * capability tier says something else. The capability describes the command
   * as a whole — `query` is `readonly` because most queries read — which is the
   * wrong answer for an entry about one specific statement that writes.
   *
   * The field states the statement's effect, not whether it happened: a
   * refused or declined write is still `db-write`, and `success` together with
   * the entry's own metadata says what became of it. `--dry-run` / `--plan`
   * still win, because those are an explicit execution mode rather than an
   * outcome.
   *
   * Deliberately narrower than `SideEffectTier`: this exists so a caller that
   * knows more than the capability table can say so, never to file a write
   * under a quieter tier than it deserves. Widen it when something actually
   * needs a value that is not here.
   */
  sideEffectTier?: Extract<SideEffectTier, 'db-write' | 'local-write'>
  /** Phase 25 D-J: envelope id from the catch block, propagated onto the persisted audit entry as `recovery_ref`. */
  recovery_ref?: string
}

/**
 * High-level helper to write an audit entry from a command handler.
 * Catch-all for D6 (non-blocking) and standardizing fields.
 *
 * Phase 25 D-K: returns the entry UUID on success, or null on disabled /
 * skipped / failed paths. Existing callers that drop the return value
 * continue to work unchanged (TS permits dropping a Promise<T>).
 */
export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<string | null> {
  const result = await writeAuditEntryResult(config, commandName, options, outcome)
  return 'success' in result ? result.id : null
}

/** 稽核在這個位置是控制本身，而它寫不出來。 */
export class AuditRequiredError extends Error {
  constructor(detail: string) {
    super(
      `Refused: the audit entry for this operation could not be written (${detail}), and ` +
        `audit.strict is on. Fix the audit sink (disk space, directory permissions, a stale ` +
        `lockfile under .dbcli/audit) or turn audit.strict off to accept unrecorded operations.`
    )
    this.name = 'AuditRequiredError'
    Object.setPrototypeOf(this, AuditRequiredError.prototype)
  }
}

/** 只有真正的寫入失敗算失敗：關閉是使用者的選擇，不是控制失效。 */
export function auditWriteFailed(result: AuditWriteResult): boolean {
  return !('success' in result) && result.skipped !== 'disabled'
}

/**
 * 效果發生**之前**的稽核寫入點。`audit.strict` 只在這裡有意義。
 *
 * audit 呼叫分兩種位置：效果發生前（ES shell 送出請求前的 attempt、SQL 的
 * gate decision）與效果發生後（outcome）。strict 的語意是「稽核寫不出來就別
 * 動資料庫」，而那個「別動」只有在前一種位置說得出口——效果已經發生之後，
 * 拒絕擋不回任何東西，只會把一次成功的操作回報成失敗。
 *
 * 所以強制點是這個函式，不是每一個 `writeAuditEntry` 呼叫端。加一個新的
 * 效果前寫入點時要呼叫它；那也是唯一需要記住的規則。
 *
 * @throws {AuditRequiredError} `audit.strict` 開啟且這一列寫不出去
 */
export async function writeAuditEntryBeforeEffect(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<AuditWriteResult> {
  const result = await writeAuditEntryResult(config, commandName, options, outcome)
  if (config.audit?.strict === true && auditWriteFailed(result)) {
    throw new AuditRequiredError('skipped' in result ? result.skipped : 'unknown')
  }
  return result
}

/**
 * 同 `writeAuditEntry`，但回傳完整的 `AuditWriteResult`。
 *
 * `writeAuditEntry` 把「audit 關閉」與「audit 寫失敗」一起收斂成 `null`，
 * 於是想要 fail-closed 的呼叫端分不出這兩件事——而它們的正確反應完全相反：
 * 關閉是使用者的選擇，寫失敗是控制失效。`config.audit.strict` 要能成立，
 * 這個區別必須留到呼叫端手上。
 */
export async function writeAuditEntryResult(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<AuditWriteResult> {
  try {
    const connectionName =
      (typeof options.connectionName === 'string' && options.connectionName) ||
      (config as { effectiveConnectionName?: string }).effectiveConnectionName ||
      getGlobalConnectionName() ||
      'default'
    const logger = await getAuditLogger(config, options.config || '.dbcli', connectionName)
    const engine = (config.connection?.system as DatabaseSystem) || 'postgresql'

    // 1. Resolve Target
    const target = outcome.target || getOperationTarget(engine, commandName, options, outcome.sql)

    // 2. Resolve Side Effect Tier
    let tier = outcome.sideEffectTier ?? getEngineCapability(engine, commandName as any).tier
    if (options.dryRun || options.plan) {
      tier = 'dry-run'
    }

    // 3. Redact Error (if any)
    let errorMessage: string | undefined
    if (outcome.error) {
      errorMessage = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
      errorMessage = redactSensitive(errorMessage)
      errorMessage = redactArgvSensitiveText(errorMessage, process.argv)
    }

    // 4. Build Entry
    const entry: Omit<AuditEntry, 'id' | 'ts' | 'session_id'> = {
      engine,
      command: commandName,
      side_effect_tier: tier,
      target,
      success: outcome.success,
      redacted_query: redactArgv(process.argv),
      // `redactSql` 是 SQL 字面值遮罩：它會把數字換成 `0`、吃掉引號之間的東西。
      // 套在 Elasticsearch 的 `<METHOD> <path>` 上會吃掉操作對象本身——
      // `DELETE /orders/_doc/12345` 變成 `DELETE /orders/_doc/0`，
      // `POST /logs-2026.08.30/_delete_by_query` 變成 `POST /logs-0.0/...`。
      // ES 的 statement 是路徑不是語句，改用一般的敏感字串遮罩。
      ...(outcome.sql && {
        redacted_sql:
          engine === 'elasticsearch' ? redactSensitive(outcome.sql) : redactSql(outcome.sql),
      }),
      ...(errorMessage && { error: errorMessage }),
      ...(outcome.recovery_ref && { recovery_ref: outcome.recovery_ref }),
      // The resolved runtime identity is authoritative.  Keep it in every
      // entry so audit consumers can distinguish otherwise identical commands
      // across environments without reading endpoint or credential fields.
      metadata: {
        ...(outcome.metadata ?? {}),
        connection_name: connectionName,
        environment: (config as { effectiveEnvironment?: string }).effectiveEnvironment ?? null,
      },
    }

    return await logger.write(entry)
  } catch (error) {
    // D6: Never throw from audit integration.
    // Logger already prints to stderr once if write fails.
    return {
      skipped: 'write-failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
