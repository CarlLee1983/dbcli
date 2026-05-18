import { ConnectionError } from '@/adapters/types'
import { PermissionError } from '@/core/permission-guard'
import { BlacklistError } from '@/types/blacklist'
import { SavedQueryError } from '@/core/saved-queries/types'
import { stepsForCode } from './recovery-steps'
import { verifyForCode } from './verify-steps'
import { buildConnectionBranches } from './connection-branches'
import {
  RECOVERY_CODE_METADATA,
  RECOVERY_SCHEMA_VERSION,
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
  const branchExtras =
    recoveryError.category === 'connection' ? buildConnectionBranches(ctxWithDetails) : null
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

function classifyConnection(err: ConnectionError): RecoveryError {
  const code: RecoveryCode =
    err.code === 'ECONNREFUSED'
      ? 'CONN_REFUSED'
      : err.code === 'ETIMEDOUT'
        ? 'CONN_TIMEOUT'
        : err.code === 'AUTH_FAILED'
          ? 'CONN_AUTH_FAILED'
          : err.code === 'ENOTFOUND'
            ? 'CONN_HOST_NOT_FOUND'
            : 'CONN_UNKNOWN'
  return baseError(code, { connectionCode: err.code })
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
  }
}
