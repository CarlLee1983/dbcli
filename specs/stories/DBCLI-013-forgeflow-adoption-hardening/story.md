# Story: DBCLI-013 ForgeFlow adoption hardening

## Goal

The repository gives one checkable answer to "which ForgeFlow is this on", and
gives it wrong loudly rather than quietly. Today it gives three, and the two
that disagree were both written by hand and read by nobody.

## Context

DBCLI-001 to DBCLI-012 are delivered and `bun run forgeflow:check` already
reconciles the handoff's `completed_stories` against the repository. That gate
was built after a delivery claim survived ten handoff revisions unchecked.

The same failure then recurred one level up, on the process version rather than
the delivery claims. `specs/.forgeflow-adoption` and `specs/stories/README.md`
were advanced to 0.3.2 in `049d7d55`; `specs/handoff.md` kept saying
`採用 ForgeFlow 0.3.1` through `0c04d091`, `88ec1ad9` and `7f534be5`. Nothing
compared them, because nothing was asked to. The version was never load-bearing
for behavior, which is precisely why it drifted: an unread field records
nothing, and a field nothing checks is an unread field with extra steps.

The adoption record is also the only pointer back to the upstream revision the
Story contract, the template and the local `story-development` Skill were
derived from. When it is wrong, the next person reconstructing why the template
looks the way it does starts from the wrong upstream commit.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: no

## Scope

### In Scope

* A repository-local gate that reconciles every adoption surface against
  `specs/.forgeflow-adoption`, run inside the existing `forgeflow:check` and so
  inside `make verify`.
* Correcting the ForgeFlow version drift already present in `specs/handoff.md`.
* Automated tests for the gate, over fixtures rather than the working tree.
* Recording the `loadSemanticContext` `version: 2` question in a tracker issue
  rather than leaving it in handoff prose.
* A release-readiness assessment of DBCLI-001..012 against Semantic Versioning,
  and the CHANGELOG entries that assessment shows are missing.
* A branch-protection recommendation for `main`, written against the CI job
  names that actually exist.

### Out of Scope

* Any change to dbcli product behavior, CLI surface, or JSON artifacts.
* Any change to the ForgeFlowV2 upstream repository.
* Bumping `package.json`, tagging, publishing, or creating a GitHub Release.
* Applying branch protection or a repository ruleset.
* Changing the intent or acceptance criteria of DBCLI-001..012.

## Inputs

* `specs/.forgeflow-adoption` — `key=value`, the authoritative record.
* `specs/stories/README.md` — the canonical human-readable declaration.
* `specs/handoff.md`, `specs/stories/_template/*.md`,
  `.agents/skills/story-development/SKILL.md` — surfaces that may mention a
  ForgeFlow version.

## Outputs

* `scripts/check-forgeflow-adoption.ts` — the executable gate.
* `scripts/lib/forgeflow-adoption.ts` — its rules, as pure functions.
* Exit code 0 with a one-line summary naming what agreed, or exit code 1 with
  one line per disagreement.

## Rules

* R1: `specs/.forgeflow-adoption` is the single source of truth. Every other
  surface is measured against it; it is measured against nothing.
* R2: The marker must declare exactly `version` (MAJOR.MINOR.PATCH) and
  `revision` (40 lowercase hex). An unknown key, a repeated key, or a line that
  is not `key=value` fails — an unread field is the failure being prevented, so
  the gate must not add one.
* R3: `specs/stories/README.md` must carry the canonical declaration naming
  both values, and both must equal the marker's.
* R4: Every other adoption surface may mention a ForgeFlow version but must not
  name a different one as the adopted release.
* R5: R4 matches only a version written immediately after the word `ForgeFlow`.
  These documents legitimately discuss earlier releases by number, and a gate
  that reports true prose is a gate that gets switched off.
* R6: The gate does not distinguish declaring an old version from quoting a
  sentence that declared one. Prose that must quote drift writes the version
  away from the word `ForgeFlow`. Telling the two apart requires reading intent,
  and a gate that guesses intent is worse than one that occasionally asks for a
  rephrase.
* R7: The gate performs no network access. Whether the recorded revision exists
  upstream is not checkable offline and is not claimed.
* R8: Every failure names the file, a locator within it, the expected value and
  the found value.
* R9: The existing handoff reconciliation is preserved unchanged and neither
  gate subsumes the other.

## Expected Errors

* Marker absent, unparseable, missing `version`, missing `revision`, carrying a
  malformed value, an unknown key, or a duplicate key.
* README missing the declaration, or declaring a different version or revision.
* Handoff, template, or Skill naming a different adopted release.
* An adoption surface that has been deleted.

## Dependencies

* `scripts/check-forgeflow-handoff.ts` — the sibling gate, unchanged.
* `make verify` via `bun run forgeflow:check`.

## Constraints

* Tests must not mutate the tracked files the gate protects; drift cases are
  built in a temporary tree.
* No existing verification gate may be weakened, skipped, or removed.
* The delivering commit carries the `Story: DBCLI-013` trailer.
