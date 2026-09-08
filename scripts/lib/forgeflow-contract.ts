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
// Authority, Risk, Task mode and an Acceptance Evidence map. Every one of them
// is enforced by an upstream checker and by nothing else, and those checkers
// live in a ForgeFlow checkout this repository does not contain. So a version
// bump on its own would have changed what a Story is permitted to say and
// nothing about what is checked — the shape of adoption that produced the two
// drifts DBCLI-013 and DBCLI-016 already had to close.
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
