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
// ## The handoff records delivery, not a work queue
//
// DBCLI-016 removed the second half of what this block used to say. Which Story
// is in progress, and which is next, are ForgePilot's answers: they are a
// function of dependency edges, gates and evidence that change between commits,
// so a copy in a committed file is stale the moment it is written — and was.
// Measured at `141cf4c3`, the block held `current_story: pending` and
// `next_story: pending`, which upstream's own checker rejects under both the
// adopted 0.3.2 and the current 0.6.0, and nothing here looked at either field.
//
// So the fields are not merely unread now: naming a Story in them is refused,
// and so is any key the adopted contract does not define. A convention would
// have to be re-argued by every agent that opens the ForgeFlow handoff template
// and finds blanks to fill; a refusal answers once. The sections themselves
// stay, holding the contract's own spellings for "no Story is stated" — this
// repository declares it adopted ForgeFlow, and deleting required keys would
// make that declaration false. The reasoning is ADR-0025.
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
  readonly completedStories: readonly string[]
}

/** One lifecycle statement the adopted handoff contract does not permit. */
export interface Violation {
  /** `section.key`, or the section alone when the section itself is unknown. */
  readonly location: string
  readonly reason: string
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
const STORY_HEADING = /^#\s*Story:\s*(\S+)/m

const SECTION_LINE = /^([a-z_]+):$/
const KEY_LINE = /^ {2}([a-z_]+):(?:[ \t]+(.*))?$/
const LIST_LINE = /^\s{3,}-\s+\S/

/**
 * The lifecycle keys the adopted ForgeFlow handoff contract defines.
 *
 * Presence is upstream `handoff-check`'s business and is not duplicated here;
 * what this gate owns is that nothing outside the contract appears. The two
 * exceptions are `current_story` and `next_story`, which are required *and*
 * pinned to one value each, because their absence and their being filled in are
 * the same failure seen from two sides.
 */
const CONTRACT_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['workflow', new Set(['current_story', 'next_story', 'completed_stories', 'status'])],
  [
    'baseline',
    new Set([
      'repository',
      'branch',
      'commit',
      'dirty_worktree',
      'story_owned_paths',
      'known_unrelated_paths',
    ]),
  ],
  ['verification', new Set(['last_command', 'result'])],
])

/** The only value each work-queue field may hold, and why it holds it. */
const PINNED_WORKFLOW_VALUES: ReadonlyMap<string, string> = new Map([
  ['current_story', 'none'],
  ['next_story', 'pending'],
])

/**
 * Return the body of the single fenced `yaml` block.
 *
 * A missing block throws rather than yielding an empty body: checking nothing
 * would pass, and a gate that passes wherever its input has gone missing is a
 * gate that passes everywhere eventually.
 */
export function lifecycleBlock(handoff: string): string {
  const block = handoff.match(LIFECYCLE_BLOCK)
  if (!block) throw new Error('specs/handoff.md has no lifecycle block')
  return block[1] ?? ''
}

/**
 * Read the delivery claims out of a lifecycle block body.
 *
 * `completed_stories` is the whole of what this reads. It is the one lifecycle
 * fact ForgePilot cannot hold — `.forgepilot/` is not committed, and most
 * delivered Stories predate the queue entirely — so it is the one this
 * repository reconciles for itself.
 */
export function parseLifecycle(body: string): Lifecycle {
  const list = body.match(COMPLETED_LIST)
  if (!list) throw new Error('the lifecycle block records no completed_stories')

  const completedStories = [...(list[1] ?? '').matchAll(LIST_ITEM)].map(([, id]) => id as string)

  return { completedStories }
}

/**
 * Report every lifecycle statement the handoff is not allowed to make.
 *
 * The scan is deliberately literal rather than a YAML parse: this file imports
 * nothing, which is what makes "the gate does not reach the network" a property
 * of the file instead of a promise in its header. The shapes it accepts are the
 * shapes the contract's own example uses — a section, a two-space key, a list
 * item — and anything else is reported rather than interpreted, because a line
 * this gate cannot read is a line whose meaning nobody has checked.
 */
export function collectLifecycleViolations(body: string): Violation[] {
  const violations: Violation[] = []
  const seen = new Map<string, string>()

  let section: string | null = null
  let known = false
  let key: string | null = null

  for (const line of body.split('\n')) {
    if (line.trim().length === 0) continue

    const sectionLine = line.match(SECTION_LINE)
    if (sectionLine) {
      section = sectionLine[1] as string
      known = CONTRACT_KEYS.has(section)
      key = null
      if (!known) {
        violations.push({
          location: section,
          reason: 'is not a section the adopted ForgeFlow handoff contract defines',
        })
      }
      continue
    }

    if (!known) continue

    const keyLine = line.match(KEY_LINE)
    if (keyLine) {
      key = keyLine[1] as string
      const location = `${section}.${key}`
      const value = (keyLine[2] ?? '').trim()

      if (!CONTRACT_KEYS.get(section as string)?.has(key)) {
        violations.push({
          location,
          reason: 'is not a key the adopted ForgeFlow handoff contract defines',
        })
        continue
      }

      seen.set(location, value)
      continue
    }

    if (LIST_LINE.test(line)) continue

    violations.push({
      location: key === null ? (section as string) : `${section}.${key}`,
      reason: `carries an unsupported lifecycle indentation: ${JSON.stringify(line)}`,
    })
  }

  for (const [field, pinned] of PINNED_WORKFLOW_VALUES) {
    const location = `workflow.${field}`
    const value = seen.get(location)

    if (value === undefined) {
      violations.push({
        location,
        reason: `is not stated; the handoff contract requires the key, and this repository requires the value \`${pinned}\``,
      })
      continue
    }

    if (value !== pinned) {
      violations.push({
        location,
        reason:
          `is \`${value}\`, but ForgePilot decides which Story is in progress and which is next — ` +
          `record it there and leave this \`${pinned}\``,
      })
    }
  }

  // Reported in the order they are found, then the pinned fields in the order
  // the contract lists them: two runs over one handoff read the same way.
  return violations
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
  const { completedStories } = lifecycle

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

/** Render the violations as a report a reader can act on without opening a diff. */
export function formatViolations(violations: readonly Violation[]): string {
  const lines = violations.map(({ location, reason }) => `  ${location} ${reason}`)
  return [
    'ForgeFlow handoff contract violations in specs/handoff.md:',
    '',
    ...lines,
    '',
    `${violations.length} lifecycle statement(s) the adopted contract does not permit.`,
  ].join('\n')
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
