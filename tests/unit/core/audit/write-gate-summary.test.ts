/**
 * ADR 0010 stakes the tier-two gate's justification on a measurement: in six
 * months, "is this gate stopping anything, or has everyone routed around it"
 * has to be answerable from the log. These tests pin the arithmetic that turns
 * the raw entries into that answer (issue #79).
 *
 * The interesting cases are the ones a naive count gets wrong: an empty log is
 * a finding rather than a blank table, a reason that never fires has to stay
 * visible as a zero, and tier one shares the metadata keys with tier two while
 * being recorded under a different rule.
 */

import { describe, test, expect } from 'bun:test'
import { summarizeWriteGate } from '@/core/audit/write-gate-summary'
import type { AuditEntry } from '@/core/audit/types'

let seq = 0

/** An audit entry shaped like the ones `recordGateDecision` writes. */
function gateEntry(
  ts: string,
  metadata: Record<string, unknown>,
  overrides: Partial<AuditEntry> = {}
): AuditEntry {
  return {
    id: `id-${++seq}`,
    ts,
    session_id: 's',
    engine: 'postgresql',
    command: 'delete',
    side_effect_tier: 'db-write',
    target: 'users',
    success: true,
    redacted_query: 'dbcli delete users',
    metadata,
    ...overrides,
  } as AuditEntry
}

/** An ordinary entry: no gate was consulted, so it only moves `scanned`. */
function plainEntry(ts: string): AuditEntry {
  return gateEntry(ts, { connection_name: 'default' }, { command: 'query' })
}

describe('summarizeWriteGate', () => {
  test('counts tier-two decisions by outcome and by reason', () => {
    const s = summarizeWriteGate([
      gateEntry('2026-01-01T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'allowed',
        write_gate_reason: 'no_where',
      }),
      gateEntry('2026-01-02T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'declined',
        write_gate_reason: 'no_where',
      }),
      gateEntry('2026-01-03T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'refused',
        write_gate_reason: 'unparseable',
      }),
    ])

    expect(s.total).toBe(3)
    expect(s.outcomes).toEqual({ allowed: 1, declined: 1, refused: 1 })
    expect(s.reasons.no_where).toBe(2)
    expect(s.reasons.unparseable).toBe(1)
  })

  // The gate's whole argument is that a reason which never fires is a wrong
  // criterion, not an absent risk (#80 is that question for `unparseable`). A
  // reason has to be able to show up as zero, so the caller can tell "never
  // triggered" from "not a reason this version knows about".
  test('keeps every known reason visible, including the ones that never fired', () => {
    const s = summarizeWriteGate([
      gateEntry('2026-01-01T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'allowed',
        write_gate_reason: 'no_where',
      }),
    ])

    expect(s.reasons).toEqual({
      no_where: 1,
      ddl_destruction: 0,
      unparseable: 0,
      multiple_statements: 0,
      non_unique_where: 0,
      multi_table: 0,
      nested_write: 0,
    })
  })

  test('reports the decision range and the wider window it was measured over', () => {
    const s = summarizeWriteGate([
      plainEntry('2026-01-01T00:00:00.000Z'),
      gateEntry('2026-02-01T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'allowed',
        write_gate_reason: 'no_where',
      }),
      gateEntry('2026-03-01T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'declined',
        write_gate_reason: 'no_where',
      }),
      plainEntry('2026-04-01T00:00:00.000Z'),
    ])

    expect(s.scanned).toBe(4)
    expect(s.range).toEqual({ from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' })
    // Without the window, "the gate fired twice" has no denominator: two in a
    // week and two in a year are different findings.
    expect(s.window).toEqual({ from: '2026-01-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' })
  })

  // "Nobody writes like that" and "everybody found a way past it" are the two
  // readings an empty count has to keep apart, so a log with entries but no
  // decisions is a stated result, not a blank table.
  test('an audit log with no tier-two decision is a finding, not an empty table', () => {
    const s = summarizeWriteGate([
      plainEntry('2026-01-01T00:00:00.000Z'),
      plainEntry('2026-04-01T00:00:00.000Z'),
    ])

    expect(s.total).toBe(0)
    expect(s.scanned).toBe(2)
    expect(s.range).toBeNull()
    expect(s.window).toEqual({ from: '2026-01-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' })
    expect(s.outcomes).toEqual({ allowed: 0, declined: 0, refused: 0 })
  })

  test('an entirely empty log reports no window at all', () => {
    const s = summarizeWriteGate([])
    expect(s.total).toBe(0)
    expect(s.scanned).toBe(0)
    expect(s.window).toBeNull()
    expect(s.range).toBeNull()
  })

  // Tier one is written only when the operator declined, so folding it into the
  // tier-two totals would report refusals the tier-two criterion never made.
  test('tier one is counted apart from tier two', () => {
    const s = summarizeWriteGate([
      gateEntry('2026-01-01T00:00:00.000Z', {
        write_gate_tier: 'one',
        write_gate_outcome: 'declined',
        write_gate_reason: 'no_where',
      }),
      gateEntry('2026-01-02T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'allowed',
        write_gate_reason: 'no_where',
      }),
    ])

    expect(s.total).toBe(1)
    expect(s.tierOne).toEqual({ total: 1, outcomes: { declined: 1 } })
    expect(s.outcomes).toEqual({ allowed: 1, declined: 0, refused: 0 })
    expect(s.reasons.no_where).toBe(1)
  })

  // A log written by a version this build does not know about must not go
  // missing from the total — an outcome that silently vanishes turns a
  // measurement into an underestimate, which is the failure mode this whole
  // summary exists to avoid.
  test('an unrecognised outcome is still counted, under its own name', () => {
    const s = summarizeWriteGate([
      gateEntry('2026-01-01T00:00:00.000Z', {
        write_gate_tier: 'two',
        write_gate_outcome: 'deferred',
        write_gate_reason: 'no_where',
      }),
    ])

    expect(s.total).toBe(1)
    expect(s.outcomes).toEqual({ allowed: 0, declined: 0, refused: 0, deferred: 1 })
  })
})
