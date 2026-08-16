---
status: accepted
date: 2026-08-16
review_by: 2026-09-16
---

# The evidence subsystem waits for a user before it is repaired

The Agent Data Evidence and Change Intelligence subsystem shipped in v1.53.0 on
2026-08-09: `src/core/evidence-pack`, `src/core/evidence-receipt`,
`src/core/contracts`, `src/core/impact`, `src/core/data-access`, and
`src/core/workload-impact`, with their commands, tests, and four-language user
documentation. As of this record nobody has composed an evidence pack outside
the test suite. A review of the shipped code found four defects, two of which
contradict acceptance criteria the tickets were closed against.

## Decision

Do not change the behavior of those modules until a real evidence pack has been
composed and read. The known defects listed below stay as they are, recorded
rather than repaired.

The trigger is deliberately attached to work that already happens: the next time
`dbcli verify` or `dbcli assert` runs against a real database, compose a pack
from it and read the result. If that has not happened by **2026-09-16**, the
subsystem is frozen — marked experimental in the user documentation, removed
from the recommended workflow, and given no further investment.

## Known deviations

These are deliberate, not undiscovered:

- `coverage.gaps` is a dead schema surface. Both writers hard-code an empty
  array (`src/core/evidence-pack/index.ts:363,399`) and the parser rejects a
  non-empty one (`:380-388`), so the expired-reference gap that EVD-01 promised
  can only appear in the transient `validate` output.
- Pack digests are not reproducible. The digest covers a random UUID id and a
  millisecond `createdAt` (`:302-308,357-364`), so equivalent claim and
  reference sets cannot produce an identical digest, which EVD-01 required.
  `canonicalizeWithoutDigest` is also a bare `JSON.stringify` with no key
  sorting; canonical ordering is maintained by hand across the build and parse
  paths.
- Blacklist matching over claim prose is unbounded case-insensitive substring
  matching with no minimum term length (`src/commands/evidence.ts:57-72`), and
  the keys of `blacklist.columns` are never added to the term list. Short
  column names block ordinary prose; `validate` and `render` re-check against
  current settings, so a stored pack can become unrenderable later.
- `observation.fingerprint` is an unsalted SHA-256 over a low-entropy value
  (`src/core/evidence-receipt/index.ts:154-187`); the verify variant has eight
  possible preimages. The values it covers already appear in plaintext in
  `outcome`, so the only additional exposure is the per-check pass bit pattern.

## Why not repair them now

An unused subsystem cannot tell us which of its defects matter. Reproducible
digests are worth real effort if someone diffs packs across runs and worthless
if nobody composes a second one; the blacklist false-positive rate is a bug or
a non-event depending entirely on which identifiers a real user has blacklisted.
Repairing all four now spends effort at the moment we know least, and produces
a subsystem whose acceptance criteria finally hold and that still has no users.

## Why not delete it instead

The code is written, tested, and published. Deleting it costs a major version
bump and breaks an API surface whose consumers we cannot enumerate, and buys
back only maintenance we are choosing not to spend. Freezing achieves the same
saving without the breaking change, which is why the 2026-09-16 fallback is a
freeze rather than a removal.

## Consequences

- A reader who finds these defects should not fix them; this record is the
  reason they are still there.
- The affected tickets in
  `docs/plans/2026-08-08-agent-data-evidence-and-change-intelligence-ticket-backlog.md`
  are marked delivered with named known deviations rather than completed.
- Repair work becomes authorized by evidence of use, not by the defect list.
- The freeze path, if taken, changes documentation and recommendation only. It
  removes no command and breaks no published interface.

**Falsified if:** `src/core/evidence-pack/index.ts`,
`src/core/evidence-receipt/index.ts`, `src/core/contracts/index.ts`,
`src/core/impact/index.ts`, `src/core/data-access/index.ts`, or
`src/core/workload-impact/index.ts` gains a behavioral change before a real
evidence pack has been composed and read, or 2026-09-16 passes with neither
that record nor the freeze.
