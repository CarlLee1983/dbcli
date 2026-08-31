---
status: accepted
date: 2026-08-29
amends: 0012
---

# Evidence artifact format versions are independent of the package version

`EVIDENCE_PACK_VERSION` and `EVIDENCE_RECEIPT_VERSION` were both `1` from the
subsystem's first release until this record. In between, v3.0.0 changed what
those numbers describe:

- the pack digest stopped covering `id` and `createdAt`, started being taken over
  sorted keys instead of insertion order, and lost the `coverage` block;
- the pack `id` stopped being a random UUID and became content-addressed;
- the receipt's `observation` stopped being an unsalted SHA-256 and became the
  observation stated plainly.

Every one of those is a breaking change to a file format, and none of them moved
the constant. The result is on disk in `tests/fixtures/evidence-legacy/`: two
mutually incompatible layouts that both declare `version: 1`. Handing either to
the v3.0.0 parser produced `evidence pack digest mismatch` — the message a
reader gets for a *tampered* artifact.

## Decision

**The artifact format version is its own number.** It moves when the bytes
change and never because the npm package's major moved; the npm major moves for
CLI contract changes and never because an artifact format did. Both pack and
receipt formats go to `version: 2`, which is what the current builder writes.

**A reader names the format before it trusts anything.**
`classifyEvidencePackArtifact` and `classifyEvidenceReceiptArtifact` are total
functions from raw JSON to exactly one of `current`, `legacy`, or `unsupported`,
computed from version *and* structure, before any digest is taken.

**Unknown fails closed.** A version this reader does not know is `unsupported`.
It is never parsed optimistically, and there is no "try the current algorithm and
see".

### Telling the two version-1 layouts apart

Structure decides, because the version number cannot:

| Artifact | Legacy format | Recognised by | Produced by |
| --- | --- | --- | --- |
| pack | `v1-coverage` | a `coverage` block is present | 2.1.0 and earlier |
| pack | `v1-untagged-v3` | `version: 1` with no `coverage` | 3.0.0 |
| receipt | `v1-observation-fingerprint` | `observation.fingerprint` is a string | 2.1.0 and earlier |
| receipt | `v1-untagged-v3` | `version: 1` with a stated observation | 3.0.0 |

A `version: 2` artifact carrying an old structural marker is neither: it is
`unsupported` with reason `version-structure-mismatch`, because a current version
number over an old layout is a relabelled file, not a current file with a stray
field.

### What legacy artifacts get, and what they never get

Both legacy formats are **read-only verifiable**. `src/core/evidence-pack/legacy.ts`
carries a frozen reimplementation of each old digest, so a legacy pack reports
`legacy-verified`, `legacy-digest-mismatch`, or `legacy-unverifiable`; a legacy
receipt gets the same treatment over `provenance.commandHash`, which is the only
self-check a receipt has ever had.

They are **never current-valid**. `evidence validate --format json` reports
`trust: "not-current-valid"` and leaves `references: "not-evaluated"` — resolving
a legacy pack's references would let `references: valid` read as an endorsement
of the pack. The trust level of an old artifact is not raised by this record; it
is only made legible.

### Why there is no migration

A migration would have to produce a v2 artifact from a v1 one, and cannot:

- **Packs.** The version is inside the digest, and the id is derived from the
  digest. A migrated pack has a different digest and therefore a different
  identity from the artifact someone recorded. Rewriting it would mint a new
  artifact wearing an old one's provenance, which is the opposite of what a
  provenance format is for.
- **v2.1.0 receipts.** `observation.fingerprint` is a hash. Recovering
  `checksPassed`/`checksTotal` from it means inverting it — feasible for these
  low-entropy inputs, which is exactly the defect that got the field removed, and
  an inverted value is a guess, not a record.

So legacy artifacts are readable, nameable, and integrity-checkable, and they
stay in the format they were written in. Anyone who needs a current pack composes
a new one from current evidence.

## Relationship to ADR-0012

[ADR-0012](0012-known-defects-get-fixed-whether-or-not-anyone-is-using-the-code.md)
decided that the pack format would be "amended in place rather than versioned
forward", on the grounds that it had no stored artifacts to keep compatible.

That decision holds for the repairs it authorised, and its core principle — a
known defect gets fixed regardless of usage — is untouched and reaffirmed here.
What it got wrong is narrower: "no users" is a claim about who exists, and the
format's own version number is a claim about what the bytes are. Amending in
place while leaving the number at `1` did not skip a compatibility layer; it
produced a false statement inside every file v3.0.0 wrote. The cost landed on
v3.0.0's own artifacts first.

This record supersedes only ADR-0012's clause "The evidence-pack schema changes
without a version bump" and its consequence "Any pack written before this change
fails validation, which is correct". Failing is right; failing with
`digest mismatch` is not.

## Consequences

- `EVIDENCE_PACK_VERSION` and `EVIDENCE_RECEIPT_VERSION` are aliases of
  `EVIDENCE_PACK_CURRENT_VERSION` / `EVIDENCE_RECEIPT_CURRENT_VERSION` in the
  legacy modules, so the format version has exactly one definition.
- The frozen digest reimplementations in `src/core/evidence-pack/legacy.ts`
  describe bytes that already exist and may not be refactored to share code with
  the current `canonicalize`. Sharing is how the v1 digest changed silently the
  first time.
- Legacy fixtures under `tests/fixtures/evidence-legacy/` are fixed files, never
  regenerated. A test that builds its own "legacy" input proves only that the
  builder agrees with itself.
- The next format change bumps to `3` and adds a row to the table above. It does
  not wait for, or coincide with, an npm major.

**Falsified if:** `EVIDENCE_PACK_VERSION` in `src/core/evidence-pack/index.ts` or
`EVIDENCE_RECEIPT_VERSION` in `src/core/evidence-receipt/index.ts` is changed in
the same commit that changes `version` in `package.json`, or either constant is
left unchanged by a commit that alters the digest input, the id derivation, or a
required field in those files or in `src/core/evidence-pack/legacy.ts` /
`src/core/evidence-receipt/legacy.ts`, or any artifact under
`tests/fixtures/evidence-legacy/` is rewritten rather than added to.
