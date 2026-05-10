import type { GuideStep } from '@/core/guide/types'
import type { RecoveryCode, RecoveryContext } from './types'

/**
 * Per-RecoveryCode verifier step appended to the envelope.
 *
 * Invariants (enforced by tests in `verify-steps.test.ts`):
 * - Always `risk: 'readonly'`.
 * - Never contains unresolved `<token>` placeholders.
 * - Never `interactive: true`.
 * - argv must be allowlisted under classifyArgvForCode for the same code.
 * - `order: 0` is a sentinel meaning "verify, not part of the main plan".
 */

const VERIFY_COMMAND_BY_CODE: Record<RecoveryCode, string> = {
  CONFIG_MISSING: 'dbcli inspect --no-connect --format json',
  CONN_REFUSED: 'dbcli doctor --format json',
  CONN_TIMEOUT: 'dbcli doctor --format json',
  CONN_UNKNOWN: 'dbcli doctor --format json',
  CONN_AUTH_FAILED: 'dbcli doctor --format json',
  CONN_HOST_NOT_FOUND: 'dbcli doctor --format json',
  PERMISSION_DENIED: 'dbcli inspect --for-agent',
  BLACKLIST_TABLE: 'dbcli inspect --for-agent',
  BLACKLIST_COLUMN_WRITE: 'dbcli inspect --for-agent',
  SNIPPET_NOT_FOUND: 'dbcli queries list --format json',
  SNIPPET_AMBIGUOUS: 'dbcli queries list --format json',
  SNIPPET_PARAM_MISSING: 'dbcli queries list --format json',
  SCHEMA_CACHE_MISSING: 'dbcli inspect --format json',
  UNKNOWN: 'dbcli doctor --format json',
}

const VERIFY_RATIONALE_BY_CODE: Record<RecoveryCode, string> = {
  CONFIG_MISSING: 'After init, confirm a config exists and is readable.',
  CONN_REFUSED: 'After re-config/reconnect, confirm the doctor health check passes.',
  CONN_TIMEOUT: 'After re-config/reconnect, confirm the doctor health check passes.',
  CONN_UNKNOWN: 'After re-config/reconnect, confirm the doctor health check passes.',
  CONN_AUTH_FAILED: 'After credential update, confirm doctor reports auth ok.',
  CONN_HOST_NOT_FOUND: 'After hostname update, confirm doctor reports DNS ok.',
  PERMISSION_DENIED: 'After permission widen, confirm capability flags via inspect.',
  BLACKLIST_TABLE: 'After blacklist amend, confirm permission/blacklist context.',
  BLACKLIST_COLUMN_WRITE: 'After blacklist amend, confirm permission/blacklist context.',
  SNIPPET_NOT_FOUND: 'After snippet discovery, confirm queries inventory loads.',
  SNIPPET_AMBIGUOUS: 'After variant pick, confirm queries inventory loads.',
  SNIPPET_PARAM_MISSING: 'After param fill, confirm queries inventory loads.',
  SCHEMA_CACHE_MISSING: 'After schema refresh, confirm `schemaCache.available` is true.',
  UNKNOWN: 'Re-run doctor to confirm no regression after recovery.',
}

const VERIFY_EXPECTS_BY_CODE: Record<RecoveryCode, string> = {
  CONFIG_MISSING: 'JSON snapshot with `connection.name` not null.',
  CONN_REFUSED: 'JSON doctor report with all critical checks passing.',
  CONN_TIMEOUT: 'JSON doctor report with all critical checks passing.',
  CONN_UNKNOWN: 'JSON doctor report with all critical checks passing.',
  CONN_AUTH_FAILED: 'JSON doctor report with all critical checks passing.',
  CONN_HOST_NOT_FOUND: 'JSON doctor report with all critical checks passing.',
  PERMISSION_DENIED: 'Brief JSON with permission.level / canWrite / canDestruct.',
  BLACKLIST_TABLE: 'Brief JSON with permission + blacklist context.',
  BLACKLIST_COLUMN_WRITE: 'Brief JSON with permission + blacklist context.',
  SNIPPET_NOT_FOUND: 'JSON list of snippets.',
  SNIPPET_AMBIGUOUS: 'JSON list of snippets.',
  SNIPPET_PARAM_MISSING: 'JSON list of snippets.',
  SCHEMA_CACHE_MISSING: 'JSON snapshot with `schemaCache.available === true`.',
  UNKNOWN: 'JSON doctor report.',
}

export function verifyForCode(code: RecoveryCode, _ctx: RecoveryContext): GuideStep | null {
  const command = VERIFY_COMMAND_BY_CODE[code]
  if (!command) return null
  return {
    order: 0,
    command,
    rationale: VERIFY_RATIONALE_BY_CODE[code],
    risk: 'readonly',
    expects: VERIFY_EXPECTS_BY_CODE[code],
  }
}
