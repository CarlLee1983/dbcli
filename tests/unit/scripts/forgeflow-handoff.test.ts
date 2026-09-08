/**
 * The delivery gate reads Story IDs from Stories, not from directory names.
 *
 * Since DBCLI-016 it reads only delivery claims. Which Story is in progress and
 * which is next are ForgePilot's answers, and the gate's job around them is to
 * refuse a handoff that gives a second one.
 *
 * The old gate derived an ID with `/^(DBCLI-\d+).*$/` over the directory name.
 * `DBCLI-PLAT-001-capability-contract` does not match it, `String.replace`
 * hands back the input unchanged, and the Story ends up keyed under its own
 * full directory name — so recording `DBCLI-PLAT-001` as completed failed with
 * "has no specs/stories directory", about a directory sitting right there.
 *
 * Widening the pattern would buy one ID family. These tests exist to pin the
 * property that makes the next family free: the gate recognises no ID shape at
 * all. Each `story.md` declares its own ID in its heading, and the gate reads
 * it. What it still checks is that the declared ID and the directory name agree
 * — two names for one Story that disagree are worse than either alone.
 *
 * Everything runs on fixtures. A test that read `specs/handoff.md` would change
 * its verdict every time a Story is delivered, which is a test that has to be
 * rewritten to stay green — the opposite of a regression test.
 */

import { describe, test, expect } from 'bun:test'
import {
  collectStoryIds,
  formatFailures,
  formatViolations,
  lifecycleBlock,
  readLifecycle,
  readStoryId,
  reconcile,
  shallowCloneRefusal,
  type Exemption,
} from '../../../scripts/lib/forgeflow-handoff'

const handoffFile = (body: string) => `# Handoff\n\nprose\n\n\`\`\`yaml\n${body}\`\`\`\n`

const BODY = `workflow:
  current_story: none
  next_story: pending
  completed_stories:
    - DBCLI-001
    - DBCLI-PLAT-001
  status: done

baseline:
  repository: CarlLee1983/dbcli
  branch: main
  commit: 0000000000000000000000000000000000000000
  dirty_worktree: false
  story_owned_paths: []
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: pass
`

const HANDOFF = handoffFile(BODY)

const DIRECTORIES = new Map([
  ['DBCLI-001', 'DBCLI-001-contract-absence-and-invalid-drift'],
  ['DBCLI-PLAT-001', 'DBCLI-PLAT-001-capability-contract'],
  ['DBCLI-PLAT-013', 'DBCLI-PLAT-013-agent-platform-closeout'],
])

const NO_EXEMPTIONS: ReadonlyMap<string, Exemption> = new Map()

const present = async () => true
const absent = async () => false

/** The default reconciliation: everything backed, nothing exempt. */
function inputs(overrides: Partial<Parameters<typeof reconcile>[0]> = {}) {
  return {
    lifecycle: readLifecycle(BODY).lifecycle,
    directories: DIRECTORIES,
    trailers: new Set(['DBCLI-001', 'DBCLI-PLAT-001', 'DBCLI-PLAT-013']),
    exemptions: NO_EXEMPTIONS,
    commitExists: present,
    ...overrides,
  }
}

describe('lifecycleBlock', () => {
  test('returns the body of the one fenced yaml block', () => {
    expect(lifecycleBlock(HANDOFF)).toBe(BODY)
  })

  test('a handoff with no lifecycle block is refused', () => {
    expect(() => lifecycleBlock('# Handoff\n\njust prose\n')).toThrow(/lifecycle block/)
  })

  test('a second fenced yaml block is refused rather than shadowing the real one', () => {
    // The handoff is five hundred lines of prose that quotes this block. Taking
    // the first fence would let a narrative example become the gate's input,
    // and the block below it — the one a human reads and edits — would go
    // unchecked entirely.
    const quoted = `# Handoff\n\n\`\`\`yaml\nworkflow:\n  current_story: none\n\`\`\`\n\n${HANDOFF}`
    expect(() => lifecycleBlock(quoted)).toThrow(/2 fenced yaml blocks/)
  })
})

describe('readLifecycle', () => {
  const body = (workflow: string) => `workflow:\n${workflow}  completed_stories:\n    - DBCLI-001\n`
  const violations = (source: string) => readLifecycle(source).violations
  const locations = (source: string) => violations(source).map((violation) => violation.location)

  test('reads the completed list, and nothing about work in progress', () => {
    // The delivery record is the whole of what this gate parses. Current and
    // next are ForgePilot's, and a second copy here is the drift DBCLI-016
    // removed.
    expect(readLifecycle(BODY).lifecycle).toEqual({
      completedStories: ['DBCLI-001', 'DBCLI-PLAT-001'],
    })
  })

  test('a block that names no live Story has nothing to report', () => {
    expect(violations(BODY)).toEqual([])
  })

  test('a named current Story is refused, pointing at ForgePilot', () => {
    const found = violations(body('  current_story: DBCLI-016\n  next_story: pending\n'))
    expect(found).toHaveLength(1)
    expect(found[0]!.location).toBe('workflow.current_story')
    expect(found[0]!.reason).toMatch(/ForgePilot/)
    expect(found[0]!.reason).toMatch(/none/)
  })

  test('a named next Story is refused the same way', () => {
    const found = violations(body('  current_story: none\n  next_story: DBCLI-017\n'))
    expect(found.map((violation) => violation.location)).toEqual(['workflow.next_story'])
    expect(found[0]!.reason).toMatch(/ForgePilot/)
  })

  test('the value that shipped before DBCLI-016 is refused too', () => {
    // `current_story: pending` is not the contract's spelling of "no Story",
    // and it is what the handoff actually held while nothing was reading it.
    expect(locations(body('  current_story: pending\n  next_story: pending\n'))).toEqual([
      'workflow.current_story',
    ])
  })

  test('an absent current or next Story is refused, because the contract requires both keys', () => {
    const found = violations(body(''))
    expect(found.map((violation) => violation.location)).toEqual([
      'workflow.current_story',
      'workflow.next_story',
    ])
    expect(found[0]!.reason).toMatch(/is not stated/)
  })

  test('a key stated twice is refused rather than resolved by line order', () => {
    // Last-wins let a named Story be laundered past the refusal by writing the
    // sentinel underneath it; the same two lines reversed were refused, and
    // neither order says which value the writer meant.
    const laundered = body(
      '  current_story: DBCLI-016\n  next_story: pending\n  current_story: none\n'
    )
    expect(locations(laundered)).toEqual(['workflow.current_story', 'workflow.current_story'])
    // Both statements are true and both are reported: the key is stated twice,
    // and the value the writer put first names a Story.
    expect(violations(laundered)[0]!.reason).toMatch(/twice/)
    expect(violations(laundered)[1]!.reason).toMatch(/ForgePilot/)
  })

  test('a section declared twice is refused', () => {
    expect(locations(`${BODY}\nworkflow:\n  status: done\n`)).toContain('workflow')
  })

  test('a key the adopted contract does not define is refused, naming it', () => {
    const found = violations(`${BODY}  detail: something the contract has no field for\n`)
    expect(found.map((violation) => violation.location)).toEqual(['verification.detail'])
    expect(found[0]!.reason).toMatch(/handoff contract/)
  })

  test('a section the contract does not define is refused', () => {
    expect(locations(`${BODY}\nnotes:\n  anything: here\n`)).toEqual(['notes'])
  })

  test('a folded prose continuation is refused as unsupported indentation', () => {
    // The block held six lines of one, under a `detail:` key, and upstream's
    // own checker is the only thing that ever objected.
    const found = violations(
      `${BODY}  result_note: >-\n    a sentence continued\n    over two lines\n`
    )
    expect(found.map((violation) => violation.location)).toContain('verification.result_note')
    expect(found.some((violation) => /indentation/.test(violation.reason))).toBe(true)
  })

  test('a blank line inside the delivery list does not truncate it', () => {
    // Two readers of one list disagreed here: the list regex stopped at the
    // gap, the contract scan did not care, and a Story recorded below it was
    // reconciled against nothing and reported by nobody.
    const gapped =
      'workflow:\n  current_story: none\n  next_story: pending\n  completed_stories:\n    - DBCLI-001\n\n    - DBCLI-999\n  status: done\n'
    expect(readLifecycle(gapped).lifecycle.completedStories).toEqual(['DBCLI-001', 'DBCLI-999'])
  })

  test('a delivery list written inline is refused rather than read as empty', () => {
    const inline =
      'workflow:\n  current_story: none\n  next_story: pending\n  completed_stories: [DBCLI-001]\n'
    const found = violations(inline)
    expect(found.map((violation) => violation.location)).toEqual(['workflow.completed_stories'])
    expect(found[0]!.reason).toMatch(/inline/)
  })

  test('a block recording no completed Story is refused, not reconciled as empty', () => {
    const empty = 'workflow:\n  current_story: none\n  next_story: pending\n  status: done\n'
    expect(locations(empty)).toEqual(['workflow.completed_stories'])
  })
})

describe('readStoryId', () => {
  test('reads the ID from the Story heading, whatever its shape', () => {
    expect(readStoryId('# Story: DBCLI-001 Contract Absence\n', 'a/story.md')).toBe('DBCLI-001')
    expect(readStoryId('# Story: DBCLI-PLAT-001 Capability Contract\n', 'b/story.md')).toBe(
      'DBCLI-PLAT-001'
    )
    // Nothing here knows what a Story ID looks like, so a family that does not
    // exist yet needs no change to this gate.
    expect(readStoryId('# Story: DBCLI-OPS-2027-01 Something\n', 'c/story.md')).toBe(
      'DBCLI-OPS-2027-01'
    )
  })

  test('a Story with no heading is refused, naming the file', () => {
    expect(() => readStoryId('# Something Else\n\nprose\n', 'specs/stories/x/story.md')).toThrow(
      /specs\/stories\/x\/story\.md/
    )
  })
})

describe('collectStoryIds', () => {
  test('keys each directory by the ID its Story declares', () => {
    const ids = collectStoryIds([
      { directory: 'DBCLI-001-contract-absence', source: '# Story: DBCLI-001 Contract Absence\n' },
      {
        directory: 'DBCLI-PLAT-001-capability-contract',
        source: '# Story: DBCLI-PLAT-001 Capability Contract\n',
      },
    ])
    expect(ids.get('DBCLI-PLAT-001')).toBe('DBCLI-PLAT-001-capability-contract')
  })

  test('a declared ID that is not the directory prefix is refused, naming both', () => {
    expect(() =>
      collectStoryIds([
        { directory: 'DBCLI-002-something', source: '# Story: DBCLI-001 Contract Absence\n' },
      ])
    ).toThrow(/DBCLI-002-something[\s\S]*DBCLI-001|DBCLI-001[\s\S]*DBCLI-002-something/)
  })

  test('two directories declaring the same ID are refused, naming both', () => {
    expect(() =>
      collectStoryIds([
        { directory: 'DBCLI-001-first', source: '# Story: DBCLI-001 First\n' },
        { directory: 'DBCLI-001-second', source: '# Story: DBCLI-001 Second\n' },
      ])
    ).toThrow(/DBCLI-001-first[\s\S]*DBCLI-001-second/)
  })
})

describe('reconcile', () => {
  test('a numeric Story backed by a trailer and a directory passes', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { completedStories: ['DBCLI-001'] },
      })
    )
    expect(failures).toEqual([])
  })

  test('a PLAT Story backed by a trailer and a directory passes', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { completedStories: ['DBCLI-PLAT-001'] },
      })
    )
    expect(failures).toEqual([])
  })

  test('both families reconcile together', async () => {
    expect(await reconcile(inputs())).toEqual([])
  })

  test('a completed Story with no directory fails closed', async () => {
    const failures = await reconcile(
      inputs({ lifecycle: { completedStories: ['DBCLI-PLAT-004'] } })
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]!.story).toBe('DBCLI-PLAT-004')
    expect(failures[0]!.reason).toMatch(/no specs\/stories directory/)
  })

  test('a completed Story with no trailer and no exemption fails closed', async () => {
    const failures = await reconcile(inputs({ trailers: new Set(['DBCLI-001']) }))
    expect(failures.map((failure) => failure.story)).toEqual(['DBCLI-PLAT-001'])
    expect(failures[0]!.reason).toMatch(/`Story:` trailer/)
  })

  test('an exemption backs a Story delivered before trailers existed', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { completedStories: ['DBCLI-001'] },
        trailers: new Set<string>(),
        exemptions: new Map([['DBCLI-001', { commit: 'abc123', evidence: 'two named tests' }]]),
      })
    )
    expect(failures).toEqual([])
  })

  test('an exemption naming a commit this repository lacks fails', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { completedStories: ['DBCLI-001'] },
        trailers: new Set<string>(),
        exemptions: new Map([['DBCLI-001', { commit: 'abc123', evidence: 'two named tests' }]]),
        commitExists: absent,
      })
    )
    expect(failures[0]!.reason).toMatch(/abc123/)
  })

  test('an exemption for a Story that has since acquired a trailer is stale', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { completedStories: ['DBCLI-001'] },
        exemptions: new Map([['DBCLI-001', { commit: 'abc123', evidence: 'two named tests' }]]),
      })
    )
    expect(failures[0]!.reason).toMatch(/stale/)
  })

  test('an exemption for a Story not recorded as completed fails', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { completedStories: ['DBCLI-001'] },
        exemptions: new Map([['DBCLI-777', { commit: 'abc123', evidence: 'x' }]]),
      })
    )
    expect(failures.map((failure) => failure.story)).toContain('DBCLI-777')
  })
})

describe('shallowCloneRefusal', () => {
  test('a shallow clone is refused with the command that fixes it', () => {
    const message = shallowCloneRefusal('true\n')
    expect(message).toMatch(/shallow clone/)
    expect(message).toMatch(/--unshallow/)
    expect(message).toMatch(/fetch-depth: 0/)
  })

  test('a full clone is not refused', () => {
    expect(shallowCloneRefusal('false\n')).toBeNull()
  })

  test('an answer that is neither is refused rather than assumed full', () => {
    // Skipping wherever the evidence is missing is the failure this gate was
    // written to avoid; an unreadable answer is not a "no".
    expect(shallowCloneRefusal('')).not.toBeNull()
  })
})

describe('formatFailures', () => {
  test('every failure is named with its reason', () => {
    const report = formatFailures([{ story: 'DBCLI-777', reason: 'is not backed' }])
    expect(report).toContain('DBCLI-777')
    expect(report).toContain('is not backed')
    expect(report).toContain('1 unbacked claim')
  })
})

describe('formatViolations', () => {
  test('every violation is named with its reason', () => {
    const report = formatViolations([
      { location: 'workflow.next_story', reason: 'is not the contract value' },
    ])
    expect(report).toContain('workflow.next_story')
    expect(report).toContain('is not the contract value')
    expect(report).toContain('1 lifecycle statement')
  })
})

describe('the gate is offline by construction', () => {
  test('the rules module imports nothing', async () => {
    // Not a stylistic preference: with no imports there is no transport, so
    // "this gate does not reach the network" is a property of the file rather
    // than a promise in its header. Everything variable is injected.
    const source = await Bun.file(
      new URL('../../../scripts/lib/forgeflow-handoff.ts', import.meta.url)
    ).text()
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\bfetch\s*\(|\brequire\s*\(/)
  })
})
