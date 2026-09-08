// Reconciliation rules for running upstream ForgeFlow's own checkers.
//
// The gate is `scripts/check-forgeflow-contract.ts`; everything decidable
// without a filesystem or a subprocess lives here, next to the reasoning for
// why each rule is drawn where it is — the same split, and for the same
// reasons, as `forgeflow-handoff.ts`.
//
// ## Why this exists at all
//
// DBCLI-018 upgraded the adopted contract from 0.3.2 to 0.6.0, which brings
// Authority, Risk, Task mode and an Acceptance Evidence map. Each is enforced
// by an upstream checker and by nothing else, and those checkers live in a
// ForgeFlow checkout this repository does not contain. So a version bump on its
// own would have changed what a Story is permitted to say and nothing about
// what is checked — the shape of adoption that produced the two drifts
// DBCLI-013 and DBCLI-016 already had to close.
//
// Three of the four are closed by this gate. Authority, Risk and Task mode are
// checked in `story-check`'s default mode, which is what runs here. The
// Acceptance Evidence map is a `--ready` check, and this gate does not pass
// `--ready`, so it is expressible and unenforced — including in DBCLI-018's own
// Story. Adopting `--ready` needs its own exemption set for the twenty-five
// Stories that predate it, so it is out of scope rather than quietly missing.
//
// The alternative was to reimplement the rules here. That was refused: the
// sibling gate's header states outright that it "deliberately does not overlap
// upstream's story-check", and two implementations of one contract diverge on a
// schedule nobody controls. So CI fetches the adopted revision and runs
// upstream's own checkers against this repository's Stories.
//
// ## The revision is part of the check
//
// A checkout of some other ForgeFlow enforces some other contract. The gate
// refuses unless the checkout's revision is the one `specs/.forgeflow-adoption`
// records, so "these are the rules we said we adopted" is verified rather than
// assumed — and an upgrade cannot be half-done, with the marker moved and the
// rules still the old ones.
//
// ## The exemptions are a ratchet
//
// Five delivered Stories fail upstream `story-check` today, on twenty-one
// findings that have nothing to do with the upgrade: they failed identically
// under 0.3.2, and nothing ran the checker, so nobody knew. Rewriting the
// acceptance text of Stories a human has already accepted is a change to the
// record, not a formatting fix — sixteen of the findings are matrix cells whose
// real values have to be re-derived from the code. That is its own Story.
//
// Until then the findings are listed, exactly, so that they are bounded rather
// than tolerated: a new finding in an exempt Story fails, a finding that has
// been fixed fails as a stale entry, and any Story not on the list must pass.
// The list may shrink and never grow.

/**
 * What one run of an upstream checker actually said.
 *
 * The exit code is part of the reading, not a detail. Upstream reports
 * operational failures — a missing, empty, unreadable or symlinked `story.md`
 * or `acceptance.md` — on stderr with an `ERROR` prefix and exit 2, printing no
 * `FAIL` lines at all. A reader that only looks for `FAIL` sees nothing wrong
 * and counts the Story as clean, so a Story upstream *refused to read* was
 * reported as satisfying the contract. That is the exact false PASS this gate
 * exists to make impossible, and it was reproduced before this function
 * existed.
 *
 * So the three outcomes are named. Anything that is not one of them — exit 0
 * with findings, exit 1 without them, a checker that could not be spawned at
 * all — is a failure of the gate rather than a verdict about a Story.
 */
export interface CheckerRun {
  readonly exitCode: number
  readonly output: string
}

/**
 * Read a checker run, refusing to turn an unreadable result into a clean one.
 *
 * Returns the findings when the run is one this gate understands, or a string
 * naming why the run itself cannot be trusted.
 */
export function readCheckerRun(subject: string, run: CheckerRun): Finding[] | string {
  const findings = run.output
    .split('\n')
    .filter((line) => line.startsWith('FAIL'))
    .map((line) => line.trim())

  if (run.exitCode === 0 && findings.length === 0) return []
  if (run.exitCode === 1 && findings.length > 0) return findings

  const detail = run.output.trim() === '' ? '(no output)' : run.output.trim()
  return (
    `${subject}: the checker exited ${run.exitCode} with ${findings.length} FAIL line(s), ` +
    `which is neither a clean run nor a set of findings — the gate cannot say whether ` +
    `the contract is satisfied:\n\n${detail}`
  )
}

/** One upstream finding, as the checker stated it, minus the path prefix. */
export type Finding = string

/** What `story-check` said about one Story directory. */
export interface StoryResult {
  readonly story: string
  readonly findings: readonly Finding[]
}

/** One reason this repository does not satisfy the contract it adopted. */
export interface ContractFailure {
  readonly subject: string
  readonly reason: string
}

/**
 * Findings that predate the gate, per Story, exactly as upstream states them.
 *
 * A ratchet, not an amnesty. Entries may be deleted and never added: adding one
 * is how a gate becomes a list of things it has agreed not to check.
 */
export type Exemptions = ReadonlyMap<string, readonly Finding[]>

/**
 * Decide whether the checkout CI fetched is the contract this repository
 * adopted.
 *
 * Both halves matter. A mismatched revision enforces rules nobody agreed to,
 * and an absent checkout is refused rather than skipped, because a gate that
 * passes wherever its evidence is missing passes in CI and nowhere else.
 */
export function checkoutRefusal(
  adoptedRevision: string,
  checkoutRevision: string | undefined
): string | null {
  if (checkoutRevision === undefined) {
    return (
      'ForgeFlow contract check cannot run: no ForgeFlow checkout was provided.\n\n' +
      '  Set FORGEFLOW_ROOT to a checkout of the adopted revision:\n\n' +
      `    git clone https://github.com/CarlLee1983/ForgeFlowV2 forgeflow\n` +
      `    git -C forgeflow checkout ${adoptedRevision}\n` +
      '    FORGEFLOW_ROOT=forgeflow bun run forgeflow:contract\n'
    )
  }

  if (checkoutRevision !== adoptedRevision) {
    return (
      `ForgeFlow contract check cannot run: the checkout is at ${checkoutRevision}, ` +
      `but specs/.forgeflow-adoption records ${adoptedRevision}.\n\n` +
      '  A checkout of some other ForgeFlow enforces some other contract. Check\n' +
      '  out the adopted revision, or upgrade the adoption first.\n'
    )
  }

  return null
}

/**
 * Compare what upstream found against what this repository has admitted to.
 *
 * Findings are compared as sets rather than counted: a Story that traded one
 * finding for another would keep its total and change its meaning.
 */
export function reconcileFindings(
  results: readonly StoryResult[],
  exemptions: Exemptions
): ContractFailure[] {
  const failures: ContractFailure[] = []
  const seen = new Set<string>()

  for (const { story, findings } of results) {
    seen.add(story)
    const admitted = exemptions.get(story)

    if (admitted === undefined) {
      for (const finding of findings) {
        failures.push({ subject: story, reason: finding })
      }
      continue
    }

    for (const finding of findings) {
      if (!admitted.includes(finding)) {
        failures.push({ subject: story, reason: `${finding} — this finding is new` })
      }
    }

    for (const finding of admitted) {
      if (!findings.includes(finding)) {
        failures.push({
          subject: story,
          reason: `no longer reports "${finding}" — delete the exemption entry`,
        })
      }
    }
  }

  for (const story of exemptions.keys()) {
    if (!seen.has(story)) {
      failures.push({ subject: story, reason: 'has exemptions but no Story directory' })
    }
  }

  return failures
}

/** Render the failures as a report a reader can act on without opening a diff. */
export function formatContractFailures(failures: readonly ContractFailure[]): string {
  return [
    'ForgeFlow contract check failed:',
    '',
    ...failures.map(({ subject, reason }) => `  ${subject}: ${reason}`),
    '',
    `${failures.length} finding(s) upstream ForgeFlow reports that this repository has not admitted to.`,
  ].join('\n')
}

/**
 * Findings that predate this gate, exactly as upstream `story-check` states
 * them.
 *
 * All twenty-one failed identically under 0.3.2; the upgrade did not cause one
 * of them. They are three kinds of wording — a trust-boundary field written as
 * prose, a security fixture cell written as prose instead of an exact value in
 * backticks, and one Story whose Classification contradicts its own Superseded
 * Behavior section. Fixing them means re-deriving sixteen matrix cells from the
 * code they describe and editing acceptance text a human already accepted, so
 * it is its own Story rather than a paragraph of DBCLI-018.
 *
 * The ratchet's two directions are enforced differently, and the difference is
 * worth knowing. Shrinking is mechanical: a finding that has been fixed makes
 * the gate fail as a stale entry. Growing is caught by the counts below, which
 * a test compares this map against — adding an entry fails until someone
 * lowers, never raises, those numbers, which is the deliberate act the rule is
 * asking for. Neither direction is left to a reviewer noticing.
 */
export const PREDATING_FINDINGS: Exemptions = new Map([
  [
    'DBCLI-PLAT-004-operation-envelope-v1',
    ['every trust-boundary field must name an exact field, not prose'],
  ],
  [
    'DBCLI-PLAT-005-agent-json-mode',
    [
      'every trust-boundary field must name an exact field, not prose',
      'Story declares Baseline conformance: no but declares superseded behavior',
    ],
  ],
  [
    'DBCLI-PLAT-006-correlation-id',
    [
      'security fixture row 1 states verification as prose instead of an exact value',
      'security fixture row 2 states verification as prose instead of an exact value',
      'security fixture row 3 states verification as prose instead of an exact value',
      'security fixture row 4 states verification as prose instead of an exact value',
      'security fixture row 5 states verification as prose instead of an exact value',
      'security fixture row 6 states verification as prose instead of an exact value',
    ],
  ],
  [
    'DBCLI-PLAT-007-bounded-evidence-receipts',
    [
      'security fixture row 1 states source field as prose instead of an exact value',
      'security fixture row 2 states source field as prose instead of an exact value',
      'security fixture row 3 states source field as prose instead of an exact value',
      'security fixture row 4 states source field as prose instead of an exact value',
      'security fixture row 5 states source field as prose instead of an exact value',
      'security fixture row 6 states source field as prose instead of an exact value',
      'security fixture row 7 states source field as prose instead of an exact value',
      'security fixture row 8 states source field as prose instead of an exact value',
      'every trust-boundary field must name an exact field, not prose',
    ],
  ],
  [
    'DBCLI-PLAT-012-schema-cache-write-boundary',
    [
      'security fixture row 10 states source field as prose instead of an exact value',
      'security fixture row 10 states persisted locations as prose instead of an exact value',
      'every trust-boundary field must name an exact field, not prose',
    ],
  ],
])

/**
 * How many findings this repository has admitted to, and across how many
 * Stories.
 *
 * These numbers may be lowered and never raised. They exist so that "the list
 * may shrink and never grow" is a check rather than a sentence in a header.
 */
export const ADMITTED_FINDINGS = 21
export const ADMITTED_STORIES = 5
