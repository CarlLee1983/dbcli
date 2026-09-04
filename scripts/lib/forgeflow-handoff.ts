// Reconciliation rules for the ForgeFlow delivery claims in `specs/handoff.md`.
//
// The gate itself is `scripts/check-forgeflow-handoff.ts`; everything decidable
// without touching git or the filesystem lives here, next to the reasoning for
// why each rule is drawn where it is. The split matters twice over: the rules
// become testable against fixtures rather than against a repository whose
// answers change every time a Story is delivered, and — because nothing in this
// file imports anything — "the gate does not reach the network" stops being a
// promise in a header comment and becomes a property of the file. Everything
// variable arrives as an argument.
//
// What the gate is for: `completed_stories` is a plain list, and for ten
// revisions nothing compared it to anything. DBCLI-001 sat in it the whole
// time, described in four of those revisions as a claim carried forward and
// still not re-verified. It turned out to be true. That is the point — an
// unbacked claim is not necessarily false, it is unchecked, and an unchecked
// claim survives by inertia until someone finally looks.
//
// It deliberately does not overlap upstream ForgeFlow's `story-check` and
// `handoff-check`. Those are static structure checks over text a human wrote,
// their own documentation is explicit that they never decide whether a
// declaration is truthful, and they live in a ForgeFlow checkout that CI cannot
// run. This gate checks the one thing they exclude: does the repository
// actually contain what the handoff says it contains.
//
// ## Story IDs come from Stories
//
// The previous version derived an ID from the directory name with
// `/^(DBCLI-\d+).*$/`. `DBCLI-PLAT-001-capability-contract` does not match, so
// `String.replace` returned the directory name unchanged and the Story was
// keyed under it — recording `DBCLI-PLAT-001` as completed then failed with
// "has no specs/stories directory", about a directory that was right there.
//
// Widening the pattern buys exactly one ID family, and the next one fails the
// same silent way. So no pattern: each `story.md` declares its ID in its
// `# Story: <ID> …` heading, and that declaration is read. The gate recognises
// no ID shape, which is what makes a new family free.
//
// The one thing still compared is the ID against its directory name. Two names
// for one Story that disagree are worse than either alone: the handoff cites
// one, a reader browsing `specs/stories/` finds the other, and neither is
// wrong enough to notice.

/** The `workflow:` block's delivery claims. */
export interface Lifecycle {
  /** The Story in progress, or `null` when none is declared. */
  readonly currentStory: string | null
  readonly completedStories: readonly string[]
}

/** A Story delivered before commits carried `Story:` trailers. */
export interface Exemption {
  readonly commit: string
  readonly evidence: string
}

/** One claim in `specs/handoff.md` the repository does not back. */
export interface Failure {
  readonly story: string
  readonly reason: string
}

/** A Story directory paired with the text of its `story.md`. */
export interface StorySource {
  readonly directory: string
  readonly source: string
}

export interface ReconcileInput {
  readonly lifecycle: Lifecycle
  /** Story ID to directory name, as declared by each `story.md`. */
  readonly directories: ReadonlyMap<string, string>
  /** Story IDs carrying a `Story:` trailer somewhere in history. */
  readonly trailers: ReadonlySet<string>
  readonly exemptions: ReadonlyMap<string, Exemption>
  readonly commitExists: (commit: string) => Promise<boolean>
}

const LIFECYCLE_BLOCK = /```yaml\n([\s\S]*?)```/
const COMPLETED_LIST = /completed_stories:\n((?:[ \t]+-[ \t]+\S+\n)+)/
const LIST_ITEM = /-\s+(\S+)/g
const CURRENT_STORY = /^\s*current_story:\s*(\S+)\s*$/m
const STORY_HEADING = /^#\s*Story:\s*(\S+)/m

/** Values `current_story` may hold that name no Story. */
const NO_CURRENT_STORY = new Set(['pending', 'none', 'null', '~'])

/**
 * Read the lifecycle block's delivery claims.
 *
 * A missing block, or one recording no `completed_stories`, throws rather than
 * returning an empty result: reconciling nothing would pass, and a gate that
 * passes wherever its input has gone missing is a gate that passes everywhere
 * eventually.
 */
export function parseLifecycle(handoff: string): Lifecycle {
  const block = handoff.match(LIFECYCLE_BLOCK)
  if (!block) throw new Error('specs/handoff.md has no lifecycle block')

  const body = block[1] ?? ''
  const list = body.match(COMPLETED_LIST)
  if (!list) throw new Error('the lifecycle block records no completed_stories')

  const completedStories = [...(list[1] ?? '').matchAll(LIST_ITEM)].map(([, id]) => id as string)

  // `current_story` is optional in a way `completed_stories` is not: between
  // Stories there is genuinely none, and the protocol spells that state.
  const declared = body.match(CURRENT_STORY)?.[1]
  const currentStory =
    declared === undefined || NO_CURRENT_STORY.has(declared.toLowerCase()) ? null : declared

  return { currentStory, completedStories }
}

/**
 * Read the Story ID a `story.md` declares.
 *
 * `file` is carried only so a refusal can name the file a human has to open.
 */
export function readStoryId(source: string, file: string): string {
  const heading = source.match(STORY_HEADING)
  if (!heading) {
    throw new Error(
      `${file} has no '# Story: <ID> <Title>' heading, so nothing declares which Story it is`
    )
  }
  return heading[1] as string
}

/**
 * Index every Story directory by the ID its `story.md` declares.
 *
 * Two failures are refused outright rather than reported per-Story, because
 * both make the whole index untrustworthy: a directory whose declared ID is not
 * its own prefix gives one Story two names, and two directories declaring the
 * same ID make "the directory for X" ambiguous.
 */
export function collectStoryIds(stories: Iterable<StorySource>): Map<string, string> {
  const byId = new Map<string, string>()

  for (const { directory, source } of stories) {
    const id = readStoryId(source, `specs/stories/${directory}/story.md`)

    if (directory !== id && !directory.startsWith(`${id}-`)) {
      throw new Error(
        `specs/stories/${directory}/ declares Story ${id}, but the directory name does not start with it — ` +
          'rename the directory or correct the heading so the Story has one name'
      )
    }

    const existing = byId.get(id)
    if (existing !== undefined) {
      throw new Error(
        `Story ${id} is declared by two directories, specs/stories/${existing}/ and specs/stories/${directory}/`
      )
    }

    byId.set(id, directory)
  }

  return byId
}

/**
 * Decide whether `git rev-parse --is-shallow-repository` permits a verdict.
 *
 * `actions/checkout` fetches `--depth=1` by default, and under it `git log`
 * sees one commit, no trailers, and every Story looks unbacked — a dozen
 * confident failures with one real cause. Skipping would be worse: a gate that
 * quietly passes wherever its evidence is missing passes in CI and nowhere
 * else. So it names the condition it cannot check.
 *
 * An answer that is neither `true` nor `false` is refused for the same reason.
 * Reading it as "not shallow" would be assuming the evidence is fine because
 * the question about it went unanswered.
 */
export function shallowCloneRefusal(isShallowOutput: string): string | null {
  const answer = isShallowOutput.trim()
  if (answer === 'false') return null

  const cause =
    answer === 'true'
      ? 'this is a shallow clone'
      : `git rev-parse --is-shallow-repository answered ${JSON.stringify(answer)}`

  return (
    `ForgeFlow handoff reconciliation cannot run: ${cause}.\n\n` +
    '  Commit trailers are the evidence this gate reads, and a shallow clone has\n' +
    '  almost none of them. Fetch full history first:\n\n' +
    '    git fetch --unshallow          # locally\n' +
    '    actions/checkout with fetch-depth: 0   # in CI\n'
  )
}

/**
 * Compare every delivery claim against the repository.
 *
 * `DELIVERED_BEFORE_TRAILERS` is a ratchet, not an amnesty: it may shrink and
 * never grow. A new Story must carry a trailer, an entry whose commit stopped
 * existing fails, and so does an entry for a Story that has since acquired a
 * trailer — a stale exemption is drift of exactly the kind this gate catches.
 */
export async function reconcile({
  lifecycle,
  directories,
  trailers,
  exemptions,
  commitExists,
}: ReconcileInput): Promise<Failure[]> {
  const failures: Failure[] = []
  const { currentStory, completedStories } = lifecycle

  // A Story cannot be both in progress and delivered. Whichever is true, the
  // other is a stale line nobody deleted, and the two together say nothing.
  if (currentStory !== null && completedStories.includes(currentStory)) {
    failures.push({
      story: currentStory,
      reason:
        'is recorded in both current_story and completed_stories — a Story is in progress or delivered, not both',
    })
  }

  if (currentStory !== null && !directories.has(currentStory)) {
    failures.push({
      story: currentStory,
      reason: 'is recorded as the current Story but has no specs/stories directory',
    })
  }

  for (const story of completedStories) {
    if (!directories.has(story)) {
      failures.push({
        story,
        reason: 'is recorded as completed but has no specs/stories directory',
      })
      continue
    }

    const exemption = exemptions.get(story)

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

  for (const story of exemptions.keys()) {
    if (!completedStories.includes(story)) {
      failures.push({
        story,
        reason: 'has a DELIVERED_BEFORE_TRAILERS entry but is not recorded as completed',
      })
    }
  }

  return failures
}

/** Render the failures as a report a reader can act on without opening a diff. */
export function formatFailures(failures: readonly Failure[]): string {
  const lines = failures.map(({ story, reason }) => `  ${story} ${reason}`)
  return [
    'ForgeFlow handoff reconciliation failed:',
    '',
    ...lines,
    '',
    `${failures.length} unbacked claim(s) in specs/handoff.md.`,
  ].join('\n')
}
