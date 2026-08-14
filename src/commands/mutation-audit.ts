/**
 * One mapping from a mutation's outcome to what the audit log records.
 *
 * insert, update and delete each carried their own copy of this, all three
 * reading `status === 'success'` — which was true for a cancelled operation
 * until 2.0.0, so declining at the prompt wrote an entry saying the write had
 * succeeded. Sharing the mapping is what keeps the three from disagreeing again.
 */

import type { AuditOutcome } from '@/core/audit/integration-helper'
import type { DataExecutionResult } from '@/types/data'

export function auditOutcomeForMutation(
  result: DataExecutionResult,
  table: string
): AuditOutcome {
  return {
    // A dry run did what it was asked to do. A cancellation did not do what it
    // was asked, but did not fail either — the boolean cannot say so, which is
    // why `outcome` carries the precise answer alongside it.
    success: result.status === 'success' || result.status === 'dry_run',
    target: table,
    ...(result.sql && { sql: result.sql }),
    metadata: {
      rows_affected: result.rows_affected,
      outcome: result.status,
      ...(result.status === 'dry_run' && { dry_run: true }),
    },
    ...(result.status === 'error' && {
      error: new Error(result.error ?? `${result.operation} failed`),
    }),
  }
}
