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

const LIFECYCLE_FENCE = /```yaml\n([\s\S]*?)```/g
const STORY_HEADING = /^#\s*Story:\s*(\S+)/m

const SECTION_LINE = /^([a-z_]+):$/
const KEY_LINE = /^ {2}([a-z_]+):(?:[ \t]+(.*))?$/
const LIST_LINE = /^ {3,}-[ \t]+(\S+)[ \t]*$/

/**
 * The lifecycle keys the adopted ForgeFlow handoff contract defines.
 *
 * Presence is upstream `handoff-check`'s business and is not duplicated here;
 * what this gate owns is that nothing outside the contract appears. The
 * exceptions are `current_story` and `next_story`, which are required *and*
 * pinned to one value each, because their absence and their being filled in are
 * the same failure seen from two sides, and `completed_stories`, which this
 * gate reads and so must insist on being able to read.
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

/** The only value each work-queue field may hold. ForgePilot holds the rest. */
const PINNED_WORKFLOW_VALUES: ReadonlyMap<string, string> = new Map([
  ['current_story', 'none'],
  ['next_story', 'pending'],
])

const COMPLETED = 'workflow.completed_stories'

/**
 * The keys the contract writes as a list of `- item` lines.
 *
 * A list item under a scalar key is neither read nor reported without this: a
 * `- DBCLI-999` slipped under `status:` was silently nothing, which is the one
 * outcome the scan promises never to produce.
 */
const LIST_KEYS: ReadonlySet<string> = new Set([
  COMPLETED,
  'baseline.story_owned_paths',
  'baseline.known_unrelated_paths',
])

/**
 * Return the body of the one fenced `yaml` block.
 *
 * Exactly one, not the first one. The handoff is five hundred lines of prose
 * that quotes this block's own contents, and a non-greedy match for the first
 * fence would read whichever example a later narrative section happened to put
 * above the real block — a gate reconciling a quotation of itself, passing
 * whatever the block below actually says. Nothing else in `specs/handoff.md`
 * may be fenced as `yaml`; other examples are fenced as `text`.
 *
 * A missing block throws rather than yielding an empty body: checking nothing
 * would pass, and a gate that passes wherever its input has gone missing is a
 * gate that passes everywhere eventually.
 */
export function lifecycleBlock(handoff: string): string {
  const blocks = [...handoff.matchAll(LIFECYCLE_FENCE)]

  if (blocks.length === 0) throw new Error('specs/handoff.md has no lifecycle block')
  if (blocks.length > 1) {
    throw new Error(
      `specs/handoff.md has ${blocks.length} fenced yaml blocks, so which one is the lifecycle ` +
        'block is ambiguous — fence narrative examples as `text`'
    )
  }

  return blocks[0]?.[1] ?? ''
}

/**
 * The value a lifecycle line states, with YAML's decoration removed.
 *
 * `"none"` and `none # ForgePilot owns this` say what `none` says. Comparing
 * the raw text told a reader who had quoted or annotated the value that
 * ForgePilot owns the state they had just deferred to ForgePilot — a refusal
 * whose message is about the wrong thing is worse than no refusal, because it
 * sends the reader to change something that was already right.
 */
function bareValue(value: string): string {
  const uncommented = value.replace(/\s+#.*$/, '').trim()
  return uncommented.replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
}

/**
 * Name the place a line the scanner cannot read belongs to.
 *
 * Indentation decides, not whichever key happened to be seen last: four spaces
 * or more continues the key above it, less than that does not, and a line at
 * the margin belongs to the block rather than to any section. A `---` after the
 * block's final key used to be reported against that key, which named a
 * statement the writer never made.
 */
function locate(section: string | null, key: string | null, line: string): string {
  const indent = line.length - line.trimStart().length
  if (indent >= 4 && section !== null && key !== null) return `${section}.${key}`
  if (indent >= 1 && section !== null) return section
  return 'lifecycle block'
}

const unreadable = (line: string) =>
  `carries an unsupported lifecycle indentation: ${JSON.stringify(line)}`

/** What one pass over a lifecycle block body found. */
export interface Reading {
  readonly lifecycle: Lifecycle
  readonly violations: readonly Violation[]
}

/**
 * Read a lifecycle block body once: what it claims, and what it may not claim.
 *
 * One reader, deliberately. The delivery list and the contract check used to be
 * two independent regexes over the same text, and they disagreed: a blank line
 * inside `completed_stories` ended the list for one and meant nothing to the
 * other, so a Story recorded below the gap was never reconciled against
 * anything and never reported missing either. Two readers of one document is
 * the same failure this gate exists to catch, one level down.
 *
 * The scan is literal rather than a YAML parse because this file imports
 * nothing, which is what makes "the gate does not reach the network" a property
 * of the file instead of a promise in its header. It accepts the shapes the
 * contract's own example uses — a section, a two-space key, a list item — and
 * reports anything else rather than interpreting it, because a line this gate
 * cannot read is a line whose meaning nobody has checked.
 */
export function readLifecycle(body: string): Reading {
  const violations: Violation[] = []
  const values = new Map<string, string>()
  const completedStories: string[] = []
  const sections = new Set<string>()

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
      } else if (sections.has(section)) {
        violations.push({ location: section, reason: 'is declared twice' })
      }

      sections.add(section)
      continue
    }

    const keyLine = line.match(KEY_LINE)
    const listLine = line.match(LIST_LINE)

    // An unrecognised section is reported once, not once per line beneath it;
    // one mistake deserves one message. Lines that parse as nothing at all are
    // still reported, because that is a different mistake — a capitalised
    // `Workflow:` used to be swallowed here and surfaced three rules later as
    // `workflow.current_story is not stated`, sending the reader to add a key
    // that was already in front of them.
    if (!known) {
      if (keyLine || listLine) continue
      violations.push({ location: locate(section, key, line), reason: unreadable(line) })
      continue
    }

    if (keyLine) {
      key = keyLine[1] as string
      const location = `${section}.${key}`
      const value = (keyLine[2] ?? '').trim()

      if (!CONTRACT_KEYS.get(section as string)?.has(key)) {
        violations.push({
          location,
          reason: 'is not a key the adopted ForgeFlow handoff contract defines',
        })
        // The key is not one this gate knows, so nothing below it continues
        // anything it can name: attributing those lines here would report one
        // mistake twice under a location that does not exist in the contract.
        key = null
        continue
      }

      // Last-wins would make the verdict depend on line order: the same two
      // lines in the other order refuse the handoff, and neither order says
      // which value the writer meant.
      if (values.has(location)) {
        violations.push({ location, reason: 'is stated twice' })
        continue
      }

      if (location === COMPLETED && value.length > 0) {
        violations.push({
          location,
          reason: `is written inline as ${JSON.stringify(value)}; this gate reads it as a list of \`- <Story ID>\` items`,
        })
        continue
      }

      values.set(location, value)
      continue
    }

    if (listLine) {
      const location = `${section}.${key}`

      if (!LIST_KEYS.has(location)) {
        violations.push({
          location: locate(section, key, line),
          reason: `is a list item under a key the contract does not write as a list: ${JSON.stringify(line)}`,
        })
        continue
      }

      if (location === COMPLETED) completedStories.push(listLine[1] as string)
      continue
    }

    violations.push({ location: locate(section, key, line), reason: unreadable(line) })
  }

  for (const [field, pinned] of PINNED_WORKFLOW_VALUES) {
    const location = `workflow.${field}`
    const stated = values.get(location)
    const value = stated === undefined ? undefined : bareValue(stated)

    // `current_story:` with nothing after it states no Story either. Reporting
    // it as the wrong value printed an empty pair of backticks at the reader.
    if (value === undefined || value.length === 0) {
      if (!violations.some((violation) => violation.location === location)) {
        violations.push({
          location,
          reason: `is not stated; the handoff contract requires the key, and this repository requires the value \`${pinned}\``,
        })
      }
      continue
    }

    if (value !== pinned) {
      violations.push({
        location,
        reason:
          `is \`${stated}\`, but ForgePilot decides which Story is in progress and which is next — ` +
          `record it there and leave this \`${pinned}\``,
      })
    }
  }

  // The delivery list is what this gate reconciles; an empty one would
  // reconcile nothing and pass.
  if (completedStories.length === 0 && !violations.some((v) => v.location === COMPLETED)) {
    violations.push({ location: COMPLETED, reason: 'records no Story' })
  }

  // Found order first, then the pinned fields in contract order, then the
  // delivery list: two runs over one handoff read the same way.
  return { lifecycle: { completedStories }, violations }
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
 * Why nothing here reads a Story's `## Authority`.
 *
 * DBCLI-027 added a rule that failed any Story in `completed_stories` declaring
 * `commit: no` or `push: no`, reasoning that reaching `main` requires commits on
 * a pushed branch. The reasoning is sound about the operations and wrong about
 * who performed them. `completed_stories` records that the Story was delivered;
 * it records nothing about which hands did what. The ordinary division of labour
 * in this repository is the counterexample: an agent is granted `modify` and at
 * most a local `commit`, and a human commits, pushes, opens the pull request and
 * merges it. Delivery is complete and the agent's `push: no` was true throughout
 * — and the rule refused exactly that flow.
 *
 * It also split one claim into two verdicts. Upstream's Execution Contract
 * defaults every operation but `plan` and `modify` to `no`, so an omitted
 * `push:` says what an explicit `push: no` says; the rule failed the explicit
 * spelling and passed the blank, which made deleting a line the way through.
 *
 * So this gate answers one question — does the repository back the delivery
 * claim — and derives no permission from the answer. Authority's format, its
 * defaults and which combinations are legal are upstream's checker's business,
 * run by `bun run forgeflow:contract`; whether a declaration is true is Human
 * Review's. ADR-0031 supersedes ADR-0030.
 */

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
