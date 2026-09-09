/**
 * Running upstream's checkers is only worth it if the result is reconciled.
 *
 * Fixtures, not a repository: the real Story set changes every delivery, and a
 * test that read it would have to be rewritten to stay green.
 */

import { describe, expect, test } from 'bun:test'
import {
  ADMITTED_FINDINGS,
  readCheckerRun,
  ADMITTED_STORIES,
  checkoutRefusal,
  formatContractFailures,
  parseStoryCheck,
  PREDATING_FINDINGS,
  reconcileFindings,
  type Exemptions,
} from '../../../scripts/lib/forgeflow-contract'

const ADOPTED = '51ab1f20defffc9477c02989989dcda244df791e'
const PROSE = 'every trust-boundary field must name an exact field, not prose'

const exemptions = (entries: [string, string[]][]): Exemptions => new Map(entries)

const clean = { root: '/tmp/forgeflow', revision: ADOPTED, status: '' }

describe('checkoutRefusal', () => {
  test('a clean checkout at the adopted revision is accepted', () => {
    expect(checkoutRefusal(ADOPTED, clean)).toBeNull()
  })

  test('another revision is refused, naming both', () => {
    // A checkout of some other ForgeFlow enforces some other contract, and an
    // upgrade that moved the marker without moving the rules would otherwise
    // look complete.
    const refusal = checkoutRefusal(ADOPTED, { ...clean, revision: 'b'.repeat(40) })

    expect(refusal).toContain(ADOPTED)
    expect(refusal).toContain('b'.repeat(40))
  })

  test('an unset FORGEFLOW_ROOT is refused, not skipped', () => {
    // A gate that passes wherever its evidence is missing passes in CI and
    // nowhere else.
    const refusal = checkoutRefusal(ADOPTED, {
      root: undefined,
      revision: undefined,
      status: undefined,
    })

    expect(refusal).toContain('FORGEFLOW_ROOT is not set')
  })

  test('a path git cannot read is refused as that, not as an unset variable', () => {
    // Both used to print the same sentence, so a typo in the path sent the
    // reader to set a variable they had already set.
    const refusal = checkoutRefusal(ADOPTED, {
      root: '/nonexistent',
      revision: undefined,
      status: undefined,
    })

    expect(refusal).toContain('/nonexistent')
    expect(refusal).toContain('not a readable git checkout')
  })

  test('a dirty checkout is refused, because it is not at any revision', () => {
    // Editing `scripts/story-check` to stop emitting a finding leaves
    // `rev-parse HEAD` untouched, so the banner would go on asserting the
    // adopted revision while the rules being run were somebody's local edit.
    const refusal = checkoutRefusal(ADOPTED, { ...clean, status: ' M scripts/story-check\n' })

    expect(refusal).toContain('uncommitted changes')
    expect(refusal).toContain('scripts/story-check')
  })
})

describe('parseStoryCheck', () => {
  const OUTPUT = [
    'ForgeFlow Story Contract Check',
    '',
    'INFO  specs/stories/DBCLI-016-a: Story ID DBCLI-016',
    'PASS  specs/stories/DBCLI-016-a: classification security=no baseline=no',
    'INFO  specs/stories/DBCLI-PLAT-004-b: Story ID DBCLI-PLAT-004',
    `FAIL  specs/stories/DBCLI-PLAT-004-b: ${PROSE}`,
    '',
  ].join('\n')

  test('every Story upstream saw is reported, clean or not', () => {
    // Upstream discovers the directories; globbing for them here was directory
    // selection reimplemented, and it hid a directory with no `story.md`.
    expect(parseStoryCheck(OUTPUT)).toEqual([
      { story: 'DBCLI-016-a', findings: [] },
      { story: 'DBCLI-PLAT-004-b', findings: [PROSE] },
    ])
  })

  test('lines that are neither INFO nor FAIL are ignored', () => {
    expect(parseStoryCheck('Result: STORY_CONTRACT_OK\nStories checked: 2\n')).toEqual([])
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

  test('no longer admits anything for DBCLI-PLAT-004 or DBCLI-PLAT-005', () => {
    // DBCLI-022 and DBCLI-023 re-derived those Stories' declarations against the
    // code, so upstream reports nothing for either. The counts above would still
    // agree if an entry were merely renamed or traded for another, which is what
    // this names outright.
    expect([...PREDATING_FINDINGS.keys()]).toEqual([
      'DBCLI-PLAT-006-correlation-id',
      'DBCLI-PLAT-007-bounded-evidence-receipts',
      'DBCLI-PLAT-012-schema-cache-write-boundary',
    ])
  })

  test('what remains is fixture cells and two trust-boundary sections', () => {
    // The Classification contradiction was PLAT-005's and is gone, so the
    // header's claim about what is left is now checkable rather than prose.
    const remaining = [...PREDATING_FINDINGS.values()].flat()

    expect(remaining.filter((f) => f.startsWith('security fixture row'))).toHaveLength(16)
    expect(remaining.filter((f) => f.includes('trust-boundary'))).toHaveLength(2)
    expect(remaining.filter((f) => f.includes('Baseline conformance'))).toHaveLength(0)
  })

  test('admits no duplicate finding within one Story', () => {
    // A repeated string would satisfy the count while admitting one fewer real
    // finding than it appears to.
    for (const [story, findings] of PREDATING_FINDINGS) {
      expect(new Set(findings).size, story).toBe(findings.length)
    }
  })
})

describe('readCheckerRun', () => {
  test('a clean run is no findings', () => {
    expect(readCheckerRun('DBCLI-016', { exitCode: 0, output: 'PASS  all good\n' })).toEqual([])
  })

  test('a run with findings returns them', () => {
    const read = readCheckerRun('DBCLI-016', { exitCode: 1, output: `FAIL  ${PROSE}\n` })

    expect(read).toEqual([`FAIL  ${PROSE}`])
  })

  test('a Story upstream refused to read is not a clean Story', () => {
    // The false PASS this function exists to prevent: upstream reports a
    // missing or unreadable acceptance.md on stderr with an ERROR prefix and
    // exit 2, printing no FAIL lines, and a reader that only looks for FAIL
    // counts the Story as satisfying the contract it was never checked against.
    const read = readCheckerRun('DBCLI-999', {
      exitCode: 2,
      output: 'ERROR required Story file is missing or unreadable\n',
    })

    expect(typeof read).toBe('string')
    expect(read as string).toContain('DBCLI-999')
    expect(read as string).toContain('exited 2')
  })

  test('a checker that could not be spawned is not a clean repository', () => {
    // `.nothrow()` swallows the spawn failure, and every Story then yields zero
    // findings — which reads exactly like a repository with nothing wrong.
    const read = readCheckerRun('DBCLI-016', {
      exitCode: 1,
      output: 'bun: command not found: story-check\n',
    })

    expect(typeof read).toBe('string')
  })

  test('findings without a failing exit are refused too', () => {
    expect(typeof readCheckerRun('DBCLI-016', { exitCode: 0, output: 'FAIL  x\n' })).toBe('string')
  })
})

describe('findings are compared as multisets', () => {
  test('two identical findings do not match one exemption entry', () => {
    // With `includes` in both directions the count would agree while one real
    // finding went unadmitted.
    const failures = reconcileFindings(
      [{ story: 'DBCLI-PLAT-004', findings: [PROSE, PROSE] }],
      exemptions([['DBCLI-PLAT-004', [PROSE]]])
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]!.reason).toMatch(/this finding is new/)
  })

  test('a duplicated exemption entry is reported stale', () => {
    const failures = reconcileFindings(
      [{ story: 'DBCLI-PLAT-004', findings: [PROSE] }],
      exemptions([['DBCLI-PLAT-004', [PROSE, PROSE]]])
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]!.reason).toMatch(/delete the exemption entry/)
  })
})
