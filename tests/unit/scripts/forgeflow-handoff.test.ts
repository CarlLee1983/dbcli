/**
 * The delivery gate reads Story IDs from Stories, not from directory names.
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
  parseLifecycle,
  readStoryId,
  reconcile,
  shallowCloneRefusal,
  type Exemption,
} from '../../../scripts/lib/forgeflow-handoff'

const lifecycleBlock = (body: string) => `# Handoff\n\nprose\n\n\`\`\`yaml\n${body}\`\`\`\n`

const HANDOFF = lifecycleBlock(`workflow:
  current_story: DBCLI-PLAT-013
  next_story: DBCLI-PLAT-012
  completed_stories:
    - DBCLI-001
    - DBCLI-PLAT-001
  status: in_progress
`)

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
    lifecycle: parseLifecycle(HANDOFF),
    directories: DIRECTORIES,
    trailers: new Set(['DBCLI-001', 'DBCLI-PLAT-001', 'DBCLI-PLAT-013']),
    exemptions: NO_EXEMPTIONS,
    commitExists: present,
    ...overrides,
  }
}

describe('parseLifecycle', () => {
  test('reads the current Story and the completed list', () => {
    expect(parseLifecycle(HANDOFF)).toEqual({
      currentStory: 'DBCLI-PLAT-013',
      completedStories: ['DBCLI-001', 'DBCLI-PLAT-001'],
    })
  })

  test('a handoff with no lifecycle block is refused', () => {
    expect(() => parseLifecycle('# Handoff\n\njust prose\n')).toThrow(/lifecycle block/)
  })

  test('a lifecycle block recording no completed_stories is refused', () => {
    expect(() => parseLifecycle(lifecycleBlock('workflow:\n  current_story: DBCLI-001\n'))).toThrow(
      /completed_stories/
    )
  })

  test('an absent current_story is null rather than a failure to parse', () => {
    // `current_story` may legitimately be unset between Stories; the list is
    // what this gate reconciles, and it is what must be present.
    const lifecycle = parseLifecycle(
      lifecycleBlock('workflow:\n  completed_stories:\n    - DBCLI-001\n')
    )
    expect(lifecycle.currentStory).toBeNull()
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
        lifecycle: { currentStory: null, completedStories: ['DBCLI-001'] },
      })
    )
    expect(failures).toEqual([])
  })

  test('a PLAT Story backed by a trailer and a directory passes', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { currentStory: null, completedStories: ['DBCLI-PLAT-001'] },
      })
    )
    expect(failures).toEqual([])
  })

  test('both families reconcile together, alongside a current Story', async () => {
    expect(await reconcile(inputs())).toEqual([])
  })

  test('a completed Story with no directory fails closed', async () => {
    const failures = await reconcile(
      inputs({ lifecycle: { currentStory: null, completedStories: ['DBCLI-PLAT-004'] } })
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

  test('a Story recorded as both current and completed fails closed', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { currentStory: 'DBCLI-PLAT-001', completedStories: ['DBCLI-PLAT-001'] },
      })
    )
    expect(failures.map((failure) => failure.story)).toEqual(['DBCLI-PLAT-001'])
    expect(failures[0]!.reason).toMatch(/current_story and completed_stories/)
  })

  test('a current Story with no directory fails closed', async () => {
    const failures = await reconcile(
      inputs({ lifecycle: { currentStory: 'DBCLI-PLAT-099', completedStories: ['DBCLI-001'] } })
    )
    expect(failures.map((failure) => failure.story)).toEqual(['DBCLI-PLAT-099'])
    expect(failures[0]!.reason).toMatch(/no specs\/stories directory/)
  })

  test('an exemption backs a Story delivered before trailers existed', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { currentStory: null, completedStories: ['DBCLI-001'] },
        trailers: new Set<string>(),
        exemptions: new Map([['DBCLI-001', { commit: 'abc123', evidence: 'two named tests' }]]),
      })
    )
    expect(failures).toEqual([])
  })

  test('an exemption naming a commit this repository lacks fails', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { currentStory: null, completedStories: ['DBCLI-001'] },
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
        lifecycle: { currentStory: null, completedStories: ['DBCLI-001'] },
        exemptions: new Map([['DBCLI-001', { commit: 'abc123', evidence: 'two named tests' }]]),
      })
    )
    expect(failures[0]!.reason).toMatch(/stale/)
  })

  test('an exemption for a Story not recorded as completed fails', async () => {
    const failures = await reconcile(
      inputs({
        lifecycle: { currentStory: null, completedStories: ['DBCLI-001'] },
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
