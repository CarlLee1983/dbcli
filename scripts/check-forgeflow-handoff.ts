/**
 * Gate: every Story the handoff calls delivered is backed by the repository.
 *
 * `specs/handoff.md` records `completed_stories` as a plain list, and nothing
 * compared it to anything. DBCLI-001 sat in that list across ten handoff
 * revisions, was described in four of them as "recorded as delivered by an
 * earlier handoff; that claim is carried forward and has still not been
 * re-verified", and no session ever spent the two minutes to settle it. It
 * turned out to be true. That is the point: an unbacked claim is not
 * necessarily false, it is unchecked, and an unchecked claim survives by
 * inertia until someone finally looks.
 *
 * Upstream ForgeFlow 0.3.1 added `scripts/story-check` and
 * `scripts/handoff-check`, and this gate deliberately does not overlap them.
 * Those are static structure checks over the text a human wrote, and their own
 * documentation is explicit that they never decide whether a declaration is
 * truthful. They live in a ForgeFlow checkout, so CI cannot run them anyway.
 * This gate checks the one thing they exclude: does the repository actually
 * contain what the handoff says it contains.
 *
 * A Story is backed when a commit carries its `Story: <ID>` trailer. Stories
 * delivered before that convention existed are backed instead by an explicit
 * DELIVERED_BEFORE_TRAILERS entry naming the commit and the evidence, so the
 * claim travels with its proof rather than with a promise to check later.
 *
 * That map is a ratchet, not an amnesty. It may shrink and never grow: a new
 * Story must carry a trailer. An entry whose commit stops existing fails, and
 * so does an entry for a Story that has since acquired a trailer — a stale
 * exemption is drift of the same kind this gate exists to catch.
 */

import { $ } from 'bun'

const repoRoot = new URL('../', import.meta.url)
const handoffPath = new URL('specs/handoff.md', repoRoot)
const storiesRoot = new URL('specs/stories/', repoRoot)

/**
 * Stories delivered before commits carried `Story:` trailers.
 *
 * Each entry names the commit that delivered it and the evidence that was
 * re-run to confirm it, so the claim is checkable without reading history.
 * Only ever remove entries.
 */
const DELIVERED_BEFORE_TRAILERS: ReadonlyMap<string, { commit: string; evidence: string }> =
  new Map([
    [
      'DBCLI-001',
      {
        commit: '3a310d08eb0460b1d0334453009d734a2d5c5ecb',
        evidence:
          "tests/unit/commands/skill-context.test.ts 'preserves semantic context when the optional contracts file is absent without creating an adapter' and tests/unit/core/contracts/contracts.test.ts 'reports invalid drift without disclosing arbitrary input or creating an adapter'",
      },
    ],
  ])

interface Failure {
  story: string
  reason: string
}

/** Reads the lifecycle block's `completed_stories` list. */
function completedStories(handoff: string): string[] {
  const lifecycle = handoff.match(/```yaml\n([\s\S]*?)```/)
  if (!lifecycle) throw new Error('specs/handoff.md has no lifecycle block')
  const list = lifecycle[1]?.match(/completed_stories:\n((?:\s+-\s+\S+\n)+)/)
  if (!list) throw new Error('the lifecycle block records no completed_stories')
  return [...(list[1] ?? '').matchAll(/-\s+(\S+)/g)].map(([, id]) => id as string)
}

/** Story IDs that have a `Story: <ID>` trailer somewhere in history. */
async function storiesWithTrailers(): Promise<Set<string>> {
  const log = await $`git log --all --format=%b`.text()
  return new Set([...log.matchAll(/^Story:\s*(\S+)\s*$/gm)].map(([, id]) => id as string))
}

async function commitExists(commit: string): Promise<boolean> {
  try {
    await $`git cat-file -e ${`${commit}^{commit}`}`.quiet()
    return true
  } catch {
    return false
  }
}

async function storyDirectories(): Promise<Map<string, string>> {
  const entries = await Array.fromAsync(
    new Bun.Glob('DBCLI-*/story.md').scan({ cwd: storiesRoot.pathname })
  )
  return new Map(
    entries.map((entry) => {
      const directory = entry.replace(/\/story\.md$/, '')
      return [directory.replace(/^(DBCLI-\d+).*$/, '$1'), directory]
    })
  )
}

const handoff = await Bun.file(handoffPath).text()
const completed = completedStories(handoff)
const trailers = await storiesWithTrailers()
const directories = await storyDirectories()
const failures: Failure[] = []

for (const story of completed) {
  const directory = directories.get(story)
  if (!directory) {
    failures.push({ story, reason: 'is recorded as completed but has no specs/stories directory' })
    continue
  }

  const exemption = DELIVERED_BEFORE_TRAILERS.get(story)
  if (trailers.has(story)) {
    if (exemption) {
      failures.push({
        story,
        reason:
          'now carries a Story: trailer, so its DELIVERED_BEFORE_TRAILERS entry is stale — delete the entry',
      })
    }
    continue
  }

  if (!exemption) {
    failures.push({
      story,
      reason:
        'is recorded as completed but no commit carries its `Story:` trailer — deliver it, or record the delivering commit and its evidence in DELIVERED_BEFORE_TRAILERS',
    })
    continue
  }

  if (!(await commitExists(exemption.commit))) {
    failures.push({
      story,
      reason: `names delivering commit ${exemption.commit}, which this repository does not contain`,
    })
  }
}

for (const story of DELIVERED_BEFORE_TRAILERS.keys()) {
  if (!completed.includes(story)) {
    failures.push({
      story,
      reason: 'has a DELIVERED_BEFORE_TRAILERS entry but is not recorded as completed',
    })
  }
}

if (failures.length > 0) {
  console.error('ForgeFlow handoff reconciliation failed:\n')
  for (const { story, reason } of failures) console.error(`  ${story} ${reason}`)
  console.error(`\n${failures.length} unbacked claim(s) in specs/handoff.md.`)
  process.exit(1)
}

const exempt = DELIVERED_BEFORE_TRAILERS.size
console.log(
  `forgeflow handoff reconciliation passed: ${completed.length} completed Stories ` +
    `(${completed.length - exempt} by commit trailer, ${exempt} by recorded delivering commit)`
)
