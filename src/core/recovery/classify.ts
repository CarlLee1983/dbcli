import { ConnectionError, type ConnectionErrorCode } from '@/adapters/types'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistError } from '@/types/blacklist'
import { SavedQueryError } from '@/core/saved-queries/types'
import { stepsForCode } from './recovery-steps'
import { verifyForCode } from './verify-steps'
import { buildConnectionBranches } from './connection-branches'
import {
  RECOVERY_CODE_METADATA,
  RECOVERY_SCHEMA_VERSION,
  STATEMENT_TIMEOUT_CODE,
  SchemaCacheMissingError,
  type RecoveryCode,
  type RecoveryContext,
  type RecoveryEnvelope,
  type RecoveryError,
} from './types'

export function classifyError(error: unknown, ctx: RecoveryContext): RecoveryEnvelope {
  const recoveryError = errorToRecoveryError(error, ctx)
  const ctxWithDetails = applyDetailsToContext(ctx, recoveryError)
  const recovery = stepsForCode(recoveryError.code, ctxWithDetails)
  const verify = verifyForCode(recoveryError.code, ctxWithDetails)
  // 分支計畫的 branchFork.after = 1 指的是「跑完第 1 步 doctor 之後」。語句逾時
  // 的計畫第 1 步不是 doctor，掛上這組分支等於要 agent 依一個沒跑過的結果選路。
  const branchExtras =
    recoveryError.category === 'connection' &&
    ctxWithDetails.connectionCode !== STATEMENT_TIMEOUT_CODE
      ? buildConnectionBranches(ctxWithDetails)
      : null
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: false,
    error: recoveryError,
    recovery,
    ...(verify !== null ? { verify } : {}),
    ...(branchExtras !== null
      ? { branches: branchExtras.branches, branchFork: branchExtras.branchFork }
      : {}),
  }
}

function errorToRecoveryError(error: unknown, ctx: RecoveryContext): RecoveryError {
  if (error instanceof ConnectionError) {
    return classifyConnection(error)
  }
  if (error instanceof PermissionError) {
    return baseError('PERMISSION_DENIED', {
      requiredPermission: error.requiredPermission,
    })
  }
  if (error instanceof BlacklistError) {
    return classifyBlacklist(error)
  }
  if (error instanceof SavedQueryError) {
    return classifySavedQuery(error, ctx)
  }
  if (error instanceof SchemaCacheMissingError) {
    return baseError('SCHEMA_CACHE_MISSING', {
      table: error.table ?? ctx.table,
    })
  }
  if (error instanceof Error) {
    if (/Run "dbcli init" first/.test(error.message)) {
      return baseError('CONFIG_MISSING')
    }
  }
  // Fallback: never echo raw error text — it can carry host, port, SQL,
  // credentials, or driver internals. Use the static safe description only.
  return baseError('UNKNOWN')
}

/**
 * adapter code → envelope code。涵蓋整個 union，新增 adapter code 時不補就編不過：
 * 漏掉的那個會安靜地變成 CONN_UNKNOWN，也就是回到 #61 / #62 要修的那個籠統值。
 *
 * 語句逾時共用 CONN_TIMEOUT，避免為它加一個 RecoveryCode 而動到 schemaVersion；
 * details.connectionCode 是兩者的分辨依據，步驟庫據此給不同的計畫。
 */
const RECOVERY_CODE_BY_CONNECTION_CODE: Record<ConnectionErrorCode, RecoveryCode> = {
  ECONNREFUSED: 'CONN_REFUSED',
  CONNECTION_LOST: 'CONN_REFUSED',
  TOO_MANY_CONNECTIONS: 'CONN_REFUSED',
  ETIMEDOUT: 'CONN_TIMEOUT',
  STATEMENT_TIMEOUT: 'CONN_TIMEOUT',
  AUTH_FAILED: 'CONN_AUTH_FAILED',
  // 憑證問題與帳密問題的復原計畫一樣是「改設定再連一次」，且都不是網路不通
  TLS_ERROR: 'CONN_AUTH_FAILED',
  ENOTFOUND: 'CONN_HOST_NOT_FOUND',
  EHOSTUNREACH: 'CONN_HOST_NOT_FOUND',
  SQL_SYNTAX_ERROR: 'CONN_UNKNOWN',
  TABLE_NOT_FOUND: 'CONN_UNKNOWN',
  COLUMN_NOT_FOUND: 'CONN_UNKNOWN',
  UNKNOWN: 'CONN_UNKNOWN',
}

function classifyConnection(err: ConnectionError): RecoveryError {
  const code = RECOVERY_CODE_BY_CONNECTION_CODE[err.code]
  const base = baseError(code, { connectionCode: err.code })
  if (err.code === STATEMENT_TIMEOUT_CODE) {
    // CONN_TIMEOUT 的靜態描述講的是網路，對「連線正常但語句被伺服器取消」是誤導。
    // 覆寫成固定字串加上一個毫秒數——數字不是 host / port / SQL / 憑證，沒有洩漏，
    // 而少了它 agent 無從得知計畫裡的 `--statement-timeout <ms>` 該填多少。
    const ceiling = err.limitMs !== undefined ? ` The ceiling in force was ${err.limitMs}ms.` : ''
    return {
      ...base,
      message: `The server canceled the statement for exceeding the statement timeout.${ceiling}`,
    }
  }
  return base
}

function classifyBlacklist(err: BlacklistError): RecoveryError {
  if (/touches blacklisted columns:/i.test(err.message)) {
    const cols = err.message.split(/columns:\s*/i)[1]?.trim() ?? ''
    return baseError('BLACKLIST_COLUMN_WRITE', {
      table: err.tableName,
      columns: cols,
    })
  }
  return baseError('BLACKLIST_TABLE', { table: err.tableName })
}

function classifySavedQuery(err: SavedQueryError, ctx: RecoveryContext): RecoveryError {
  if (err.code === 'NOT_FOUND') {
    return baseError('SNIPPET_NOT_FOUND', { snippet: ctx.snippet })
  }
  if (err.code === 'AMBIGUOUS') {
    return baseError('SNIPPET_AMBIGUOUS', { snippet: ctx.snippet })
  }
  if (err.code === 'PARAM_MISSING') {
    const match = err.message.match(/Missing required parameters:\s*([^\s,]+)/i)
    return baseError('SNIPPET_PARAM_MISSING', {
      snippet: ctx.snippet,
      paramName: match?.[1],
    })
  }
  // Other SavedQueryError codes fall back to UNKNOWN with the static safe
  // description; raw err.message can include user data.
  return baseError('UNKNOWN', ctx.snippet ? { snippet: ctx.snippet } : undefined)
}

function baseError(code: RecoveryCode, details?: RecoveryError['details']): RecoveryError {
  const trimmed = details ? pickDefined(details) : undefined
  return {
    code,
    category: RECOVERY_CODE_METADATA[code].category,
    message: RECOVERY_CODE_METADATA[code].description,
    ...(trimmed && Object.keys(trimmed).length > 0 ? { details: trimmed } : {}),
  }
}

function pickDefined(
  d: NonNullable<RecoveryError['details']>
): NonNullable<RecoveryError['details']> {
  const out: NonNullable<RecoveryError['details']> = {}
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined && v !== null && v !== '') {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

function applyDetailsToContext(ctx: RecoveryContext, err: RecoveryError): RecoveryContext {
  // Promote details into the context so step rendering can substitute placeholders.
  return {
    ...ctx,
    table: err.details?.table ?? ctx.table,
    snippet: err.details?.snippet ?? ctx.snippet,
    hint: err.details?.paramName ?? ctx.hint,
    connectionCode: err.details?.connectionCode ?? ctx.connectionCode,
  }
}
