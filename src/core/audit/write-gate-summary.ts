/**
 * The tier-two write gate, counted (issue #79).
 *
 * ADR 0010 justifies the gate on a measurement rather than on an argument:
 * every tier-two evaluation is logged — allowed, declined and refused alike —
 * so whether the gate stops anything is a question the log answers. The data was
 * always there; what was missing is that answering it meant hand-writing a jq
 * filter over `.dbcli/audit/*.jsonl`, and a measurement somebody has to
 * remember to reinvent is one that will not be taken in six months. That left
 * the ADR's falsification condition in a state nothing would ever trigger.
 *
 * Pure counting, no I/O and no output: the command layer reads the files and
 * renders (ADR 0009).
 */

import type { AuditEntry } from './types'

/** Outcomes `recordGateDecision` writes. Others are counted under their own name. */
export const GATE_OUTCOMES = ['allowed', 'declined', 'refused'] as const

/**
 * Reasons the gate can reach tier two, seeded into every summary at zero.
 *
 * A reason that never fires is the finding, not an absence to hide: ADR 0010
 * says that if tier two goes untouched the criterion is wrong, and #80 asks
 * exactly that of `unparseable`. Dropping empty rows would answer "how often did
 * this fire" while quietly refusing to answer "does this fire at all".
 */
export const GATE_REASONS = [
  'no_where',
  'ddl_destruction',
  'unparseable',
  'multiple_statements',
  'non_unique_where',
] as const

export interface WriteGateSummary {
  /** Audit entries examined, gate decision or not. */
  scanned: number
  /**
   * Time span of everything examined. This is the denominator: two decisions in
   * a week and two in a year are different findings, and only this makes "six
   * months" a statable interval rather than a figure of speech.
   */
  window: { from: string; to: string } | null
  /** Tier-two evaluations. */
  total: number
  /** Counts by outcome; the three known ones are always present, at zero if unseen. */
  outcomes: Record<string, number>
  /** Counts by reason, tier two only; every known reason present, at zero if unseen. */
  reasons: Record<string, number>
  /**
   * Everything the gate recorded that was not tier two, counted the same way.
   *
   * Tier one is written only when the operator declined, so folding it into the
   * tier-two totals would report refusals the tier-two criterion never made. It
   * is broken down by outcome rather than reported as a bare "declines" count so
   * the number describes itself: the "only when declined" rule lives in
   * `query.ts`, and a summary that hardcoded it as a label would go on asserting
   * it after that rule changed.
   */
  tierOne: { total: number; outcomes: Record<string, number> }
  /** Time span of the tier-two decisions themselves; null when there were none. */
  range: { from: string; to: string } | null
}

function metadataOf(entry: AuditEntry): Record<string, unknown> {
  const metadata = (entry as { metadata?: unknown }).metadata
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Accumulates a min/max over ISO-8601 UTC timestamps, which compare lexically. */
class Span {
  private from: string | undefined
  private to: string | undefined

  add(ts: string): void {
    if (this.from === undefined || ts < this.from) this.from = ts
    if (this.to === undefined || ts > this.to) this.to = ts
  }

  value(): { from: string; to: string } | null {
    return this.from === undefined || this.to === undefined
      ? null
      : { from: this.from, to: this.to }
  }
}

export function summarizeWriteGate(entries: readonly AuditEntry[]): WriteGateSummary {
  const outcomes: Record<string, number> = Object.fromEntries(GATE_OUTCOMES.map((o) => [o, 0]))
  const reasons: Record<string, number> = Object.fromEntries(GATE_REASONS.map((r) => [r, 0]))
  const tierOneOutcomes: Record<string, number> = {}
  const window = new Span()
  const range = new Span()
  let total = 0
  let tierOneTotal = 0

  // An outcome or reason this build does not recognise is counted under its own
  // name rather than dropped. A log written by another version must not turn the
  // measurement into a silent underestimate — the exact failure the summary
  // exists to prevent.
  const tally = (into: Record<string, number>, key: string): void => {
    into[key] = (into[key] ?? 0) + 1
  }

  for (const entry of entries) {
    window.add(entry.ts)

    const metadata = metadataOf(entry)
    const tier = readString(metadata, 'write_gate_tier')
    if (!tier) continue

    const outcome = readString(metadata, 'write_gate_outcome') ?? 'unknown'

    if (tier !== 'two') {
      tierOneTotal += 1
      tally(tierOneOutcomes, outcome)
      continue
    }

    total += 1
    range.add(entry.ts)
    tally(outcomes, outcome)
    tally(reasons, readString(metadata, 'write_gate_reason') ?? 'unknown')
  }

  return {
    scanned: entries.length,
    window: window.value(),
    total,
    outcomes,
    reasons,
    tierOne: { total: tierOneTotal, outcomes: tierOneOutcomes },
    range: range.value(),
  }
}
