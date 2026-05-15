import type { DatabaseSystem } from '../../adapters/types'
import type { SideEffectTier } from '../../adapters/capabilities'

export interface AuditEntry {
  /** Unique ID for the audit entry (e.g., UUID). */
  id: string
  /** ISO-8601 timestamp. */
  ts: string
  /** Session ID (provided by SessionIdService). */
  session_id: string
  /** The database system being used. */
  engine: DatabaseSystem
  /** The command that was executed (e.g., 'query', 'insert'). */
  command: string
  /** The side-effect tier of the command. */
  side_effect_tier: SideEffectTier
  /** The operation target (e.g., table name, collection name). */
  target: string
  /** Whether the operation was successful. */
  success: boolean
  /** Error message if success is false (redacted). */
  error?: string
  /** Optional reference to a recovery envelope if the operation failed. */
  recovery_ref?: string
  /** Redacted query or command summary (argv). */
  redacted_query: string
  /** Redacted SQL body (if applicable). */
  redacted_sql?: string
  /** Additional non-sensitive metadata (e.g., rows_affected, execution_ms). */
  metadata?: Record<string, unknown>
}
