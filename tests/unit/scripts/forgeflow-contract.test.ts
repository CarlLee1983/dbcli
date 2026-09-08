/**
 * Running upstream's checkers is only worth it if the result is reconciled.
 *
 * Fixtures, not a repository: the real Story set changes every delivery, and a
 * test that read it would have to be rewritten to stay green.
 */

import { describe, expect, test } from 'bun:test'
import {
  ADMITTED_FINDINGS,
  ADMITTED_STORIES,
  checkoutRefusal,
  formatContractFailures,
  PREDATING_FINDINGS,
  reconcileFindings,
  type Exemptions,
} from '../../../scripts/lib/forgeflow-contract'

const ADOPTED = '51ab1f20defffc9477c02989989dcda244df791e'
const PROSE = 'every trust-boundary field must name an exact field, not prose'

const exemptions = (entries: [string, string[]][]): Exemptions => new Map(entries)

describe('checkoutRefusal', () => {
  test('the adopted revision is accepted', () => {
    expect(checkoutRefusal(ADOPTED, ADOPTED)).toBeNull()
  })

  test('another revision is refused, naming both', () => {
    const refusal = checkoutRefusal(ADOPTED, 'b'.repeat(40))

    // A checkout of some other ForgeFlow enforces some other contract, and an
    // upgrade that moved the marker without moving the rules would otherwise
    // look complete.
    expect(refusal).toContain(ADOPTED)
    expect(refusal).toContain('b'.repeat(40))
  })

  test('an absent checkout is refused, not skipped', () => {
    // A gate that passes wherever its evidence is missing passes in CI and
    // nowhere else.
    const refusal = checkoutRefusal(ADOPTED, undefined)

    expect(refusal).toContain('FORGEFLOW_ROOT')
    expect(refusal).toContain(ADOPTED)
  })
})

describe('reconcileFindings', () => {
  test('a clean Story set passes', () => {
    expect(reconcileFindings([{ story: 'DBCLI-016', findings: [] }], exemptions([]))).toEqual([])
  })

  test('a finding in a Story with no exemption fails', () => {
    const failures = reconcileFindings([{ story: 'DBCLI-016', findings: [PROSE] }], exemptions([]))

    expect(failures).toEqual([{ subject: 'DBCLI-016', reason: PROSE }])
  })

  test('an admitted finding passes', () => {
    const failures = reconcileFindings(
      [{ story: 'DBCLI-PLAT-004', findings: [PROSE] }],
      exemptions([['DBCLI-PLAT-004', [PROSE]]])
    )

    expect(failures).toEqual([])
  })

  test('a new finding in an exempt Story fails', () => {
    // Counting instead of comparing would let a Story trade one finding for
    // another and keep its total.
    const failures = reconcileFindings(
      [{ story: 'DBCLI-PLAT-004', findings: ['something else entirely'] }],
      exemptions([['DBCLI-PLAT-004', [PROSE]]])
    )

    expect(failures).toHaveLength(2)
    expect(failures[0]!.reason).toMatch(/this finding is new/)
    expect(failures[1]!.reason).toMatch(/no longer reports/)
  })

  test('a finding that has been fixed fails as a stale exemption', () => {
    const failures = reconcileFindings(
      [{ story: 'DBCLI-PLAT-004', findings: [] }],
      exemptions([['DBCLI-PLAT-004', [PROSE]]])
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]!.reason).toMatch(/delete the exemption entry/)
  })

  test('an exemption for a Story that no longer exists fails', () => {
    const failures = reconcileFindings([], exemptions([['DBCLI-GONE', [PROSE]]]))

    expect(failures[0]!.reason).toMatch(/no Story directory/)
  })
})

describe('formatContractFailures', () => {
  test('every failure is named with its subject', () => {
    const report = formatContractFailures([{ subject: 'DBCLI-016', reason: PROSE }])

    expect(report).toContain('DBCLI-016')
    expect(report).toContain(PROSE)
    expect(report).toContain('1 finding(s)')
  })
})

describe('the exemption ratchet', () => {
  test('admits exactly what it says it admits', () => {
    // The rule is "may shrink and never grow". Shrinking is already mechanical
    // — a fixed finding fails as a stale entry. This is the other direction:
    // adding an entry fails here until someone lowers, never raises, these two
    // numbers, which is the deliberate act the rule asks for. Without it the
    // ratchet was a sentence in a header that nothing checked.
    const findings = [...PREDATING_FINDINGS.values()].reduce(
      (total, list) => total + list.length,
      0
    )

    expect(PREDATING_FINDINGS.size).toBe(ADMITTED_STORIES)
    expect(findings).toBe(ADMITTED_FINDINGS)
  })

  test('admits no duplicate finding within one Story', () => {
    // A repeated string would satisfy the count while admitting one fewer real
    // finding than it appears to.
    for (const [story, findings] of PREDATING_FINDINGS) {
      expect(new Set(findings).size, story).toBe(findings.length)
    }
  })
})
