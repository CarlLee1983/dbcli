/**
 * What a person sees after a mutation finishes.
 *
 * The machine envelope is unchanged and remains the only thing written when
 * nobody is watching; this is the parallel surface for when somebody is. Core
 * cannot reach stdout, so deciding between them is this layer's job alone.
 *
 * insert is served here even though #70 scoped the human output path to update
 * and delete. The status correction had to reach insert regardless — it shared
 * the audit bug — and once insert was building the same result, leaving it as
 * the one write command that answers a person in JSON would have been a gap to
 * explain rather than a scope honoured. Recorded so that a later reader
 * comparing this file against #70 does not read it as an oversight.
 */

import { t, t_vars } from '@/i18n/message-loader'
import { BlacklistError } from '@/types/blacklist'
import type { DataExecutionResult } from '@/types/data'

export interface HumanOutputContext {
  /** Whether stdout is attached to a terminal. */
  isTTY: boolean

  /** The --format flag as given, if any. */
  format?: string
}

/**
 * Decide whether this invocation has a human reading it.
 *
 * Two rules, in order. An explicit `--format json` is a statement of intent and
 * settles it whatever the terminal says. Otherwise a terminal means a reader and
 * a pipe means a program — which keeps every existing non-interactive caller on
 * byte-identical output.
 *
 * `--format text` is deliberately not treated as a request for prose: it is the
 * flag's default value, so it appears on invocations that never asked for
 * anything, and honouring it would push prose into redirects.
 */
export function shouldRenderForHuman(context: HumanOutputContext): boolean {
  if (context.format === 'json') return false
  return context.isTTY
}

/**
 * Read the audience off the command's options.
 *
 * Every mutation branch in insert/update/delete needs this same pair, and there
 * are fifteen such branches. Written out at each one, a change to how the
 * audience is decided — which the ceremony work will make — becomes fifteen
 * edits, and the fifteenth is the one that gets missed.
 */
export function humanOutputContext(options: { format?: string }): HumanOutputContext {
  return { isTTY: process.stdout.isTTY === true, ...(options.format && { format: options.format }) }
}

const VERB_KEY: Record<DataExecutionResult['operation'], string> = {
  insert: 'ceremony.inserted',
  update: 'ceremony.updated',
  delete: 'ceremony.deleted',
}

/**
 * Render the finished operation as lines for a person.
 *
 * Timing is reported only for work that actually ran. A duration attached to a
 * cancellation reads as though something happened.
 *
 * The reversal line appears only on the two outcomes where reversal is a live
 * question — a write that changed rows, and a failure. Telling somebody who
 * cancelled that nothing can be undone is noise, and noise on the routine cases
 * is how the line stops being read on the case that matters.
 */
export function renderMutationOutcome(
  result: DataExecutionResult,
  table: string,
  elapsedMs: number
): string[] {
  if (result.status === 'error') {
    return [
      t_vars('ceremony.failed', { reason: result.error ?? t('ceremony.unknown_error') }),
      t('ceremony.recovery_retry'),
    ]
  }

  if (result.status === 'cancelled') {
    return [t_vars('ceremony.cancelled', { table })]
  }

  if (result.status === 'dry_run') {
    return [t_vars('ceremony.dry_run', { table })]
  }

  const elapsed = t_vars('ceremony.elapsed', { seconds: (elapsedMs / 1000).toFixed(2) })

  if (result.rows_affected === 0) {
    return [t_vars('ceremony.matched_nothing', { table }), elapsed]
  }

  return [
    t_vars(VERB_KEY[result.operation], { count: result.rows_affected, table }),
    elapsed,
    t('ceremony.recovery_none'),
  ]
}

/** Write one mutation result without letting backend branches choose their own status vocabulary. */
export function printMutationOutcome(
  result: DataExecutionResult,
  table: string,
  elapsedMs: number,
  context: HumanOutputContext,
  envelopeExtras: Record<string, unknown> = {}
): void {
  if (shouldRenderForHuman(context)) {
    // A failure is still an error message and belongs on stderr with every
    // other human-facing failure in this file; every other outcome is routine
    // progress and stays on stdout.
    const writeLine = result.status === 'error' ? console.error : console.log
    for (const line of renderMutationOutcome(result, table, elapsedMs)) writeLine(line)
    return
  }

  console.log(JSON.stringify({ ...mutationEnvelope(result), ...envelopeExtras }, null, 2))
}

/**
 * Report a failure that never reached the executor — a blacklist refusal, a
 * malformed --set, a missing table name — the same way `printMutationOutcome`
 * reports one that did.
 *
 * Machine mode prints the same envelope shape the catch-all branches in
 * insert/update/delete used to build inline, byte for byte. Human mode writes
 * to stderr, matching the `PermissionError` and `ConnectionError` branches in
 * the same catch blocks: an error message belongs on the error stream, not
 * mixed into stdout with the routine cases.
 *
 * The `--recovery` hint that `renderMutationOutcome` prints for an executor
 * failure is deliberately absent here — `--recovery` writes a plan for a
 * statement that failed against the database, and a failure at this stage
 * never reached one. A `BlacklistError` gets its own hint instead, pointing
 * at the command that explains the refusal.
 */
export function printMutationFailure(
  error: Error,
  operation: DataExecutionResult['operation'],
  context: HumanOutputContext
): void {
  if (shouldRenderForHuman(context)) {
    console.error(t_vars('ceremony.failed', { reason: error.message }))
    if (error instanceof BlacklistError) {
      console.error(t('ceremony.blacklist_hint'))
    }
    return
  }

  console.log(
    JSON.stringify({ status: 'error', operation, rows_affected: 0, error: error.message }, null, 2)
  )
}

/**
 * The result of a write somebody declined.
 *
 * `DataExecutor` builds this for SQL; MongoDB and Redis writes never reach it,
 * so their commands build the same thing here rather than each inventing a
 * shape. A cancellation reports the statement it did not run, which is what
 * makes the envelope readable as "this, and it did not happen".
 */
export function cancelledOutcome(
  operation: DataExecutionResult['operation'],
  preview: string
): DataExecutionResult {
  return {
    status: 'cancelled',
    operation,
    rows_affected: 0,
    sql: preview,
    timestamp: new Date().toISOString(),
  }
}

/**
 * The machine-facing shape, listed field by field.
 *
 * Deliberately not a spread of the result. What agents parse is a decision this
 * layer makes, not a side effect of what core happens to carry: spreading would
 * publish any field a future edit adds to DataExecutionResult, which is exactly
 * the leak ADR 0009 removed from the other direction.
 */
function mutationEnvelope(result: DataExecutionResult): Record<string, unknown> {
  return {
    status: result.status,
    operation: result.operation,
    rows_affected: result.rows_affected,
    ...(result.timestamp && { timestamp: result.timestamp }),
    ...(result.sql && { sql: result.sql }),
    ...(result.error && { error: result.error }),
  }
}
