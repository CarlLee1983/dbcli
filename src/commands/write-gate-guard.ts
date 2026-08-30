/**
 * The gate as the write commands use it: classify, ask or refuse, record.
 *
 * `write-gate.ts` decides the tier and `write-gate-prompt.ts` handles the
 * asking; this is the third of the three, and exists so that `query`, `update`
 * and `delete` cannot record the same decision three different ways — the audit
 * trail is the only evidence that will exist about whether this gate ever
 * stopped anything, and it is worth exactly as much as its consistency.
 */

import { writeAuditEntryBeforeEffect } from '@/core/audit/integration-helper'
/** The config shape the audit helper accepts, taken from the helper itself. */
type AuditableConfig = Parameters<typeof writeAuditEntryBeforeEffect>[0]
import { humanOutputContext } from './mutation-outcome'
import {
  classifyStructuredWriteGate,
  type UniquenessFacts,
  type WriteGateVerdict,
} from './write-gate'
import { enforceWriteGate, WriteGateRefusal } from './write-gate-prompt'

export type GateOutcome = 'allowed' | 'declined' | 'refused'

/**
 * Record a tier-two evaluation whether it allowed or refused.
 *
 * Deliberately unconditional. A gate that only logs its refusals can say how
 * often it fired but not how often it was reached, and "everyone routes around
 * it" and "nobody ever writes like that" produce the same empty log.
 */
export async function recordGateDecision(request: {
  config: AuditableConfig
  command: string
  options: Record<string, unknown>
  verdict: WriteGateVerdict
  outcome: GateOutcome
  /** Which gate produced this decision. Tier one is recorded only when declined. */
  tier: 'one' | 'two'
  sql?: string
}): Promise<void> {
  // 這是效果**發生前**的紀錄——該函式的 docstring 講的就是這件事——所以
  // `audit.strict` 在這裡強制得起來：寫不出這一列就不要往下執行。
  await writeAuditEntryBeforeEffect(request.config, request.command, request.options, {
    success: request.outcome === 'allowed',
    // The decision is about a statement that writes, whatever the command's own
    // capability tier says. Read off the command, one DROP decision was filed
    // as `readonly` from `query`, `db-write` from `delete` and `interactive`
    // from `shell`, so filtering the log for destructive operations by tier —
    // the obvious first filter — found a third of them (#83).
    sideEffectTier: 'db-write',
    ...(request.sql && { sql: request.sql }),
    ...(request.verdict.table && { target: request.verdict.table }),
    metadata: {
      write_gate_tier: request.tier,
      write_gate_outcome: request.outcome,
      write_gate_reason: request.verdict.reason ?? 'no_where',
    },
  })
}

/**
 * The gate for `update` and `delete`.
 *
 * Returns true when the write may proceed and false when the operator declined;
 * throws `WriteGateRefusal` when nobody was there to answer. `--force` is not
 * consulted: it skips the ordinary confirmation, and this is not one.
 */
export async function guardStructuredWrite(request: {
  operation: 'update' | 'delete'
  table: string
  where: Record<string, unknown>
  schema: UniquenessFacts
  config: AuditableConfig
  options: { format?: string } & Record<string, unknown>
}): Promise<boolean> {
  const verdict = classifyStructuredWriteGate({
    table: request.table,
    where: request.where,
    schema: request.schema,
  })
  if (verdict.tier !== 'two') return true

  const operation = request.operation.toUpperCase()
  const preview = `${operation} ${request.table} WHERE ${Object.keys(request.where).join(', ')}`

  const record = (outcome: GateOutcome) =>
    recordGateDecision({
      config: request.config,
      command: request.operation,
      options: request.options,
      verdict,
      outcome,
      tier: 'two',
      sql: preview,
    })

  try {
    const proceed = await enforceWriteGate({
      verdict,
      statement: preview,
      operation,
      human: humanOutputContext(request.options),
    })
    await record(proceed ? 'allowed' : 'declined')
    return proceed
  } catch (error) {
    if (error instanceof WriteGateRefusal) await record('refused')
    throw error
  }
}
