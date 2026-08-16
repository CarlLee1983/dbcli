---
status: accepted
date: 2026-08-16
dogfooded: 2026-08-16
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

## The trigger fired on 2026-08-16

`dbcli verify safe-backfill --after-write` ran against a PostgreSQL instance
after an externally applied backfill, wrote a verification artifact and an
evidence receipt, and `dbcli evidence compose` built a pack from both.
`validate` reported `integrity: valid, references: valid, expired: []` and the
Markdown render was read. **The freeze does not happen.** Repair of the
deviations below is authorized from here, so each one now needs a reason to be
worth doing rather than a reason to wait.

The workflow held end to end. Claims rendered as
`External claim — not a dbcli verification verdict.`, the receipt's `command`
was redacted to `--table <redacted> --query <redacted>`, and no SQL or row
reached either artifact.

## What the first real use found

The first run reported `not_verified` on data that was correct. Two assertions
were tried and both failed for reasons unrelated to the database:

- `rows == 0` counts rows in the result set. Against
  `SELECT count(*) AS rows …` it reads as a column reference and is neither —
  legal syntax, different meaning.
- `value == 0` compared a PostgreSQL `bigint`, which arrives as a JavaScript
  string, against a number under `===`. Every `value == <count>` assertion
  failed on PostgreSQL, and because ordering operators coerce, `value > 5`
  worked while `value == 6` did not. Fixed in `src/core/assert/evaluator.ts`;
  the same command now reports `verified` against the same data.

None of the four known deviations below was reached by this run, so none is
repaired and none has yet cost anything. The finding that mattered was in the
verification path, not the evidence path.

The pack itself was honest but thin: every useful sentence in it was one a human
wrote. The generated half recorded `not_verified` without recording why, and
"why" was the only thing worth reading. That is the gap worth closing if this
subsystem gets more investment.

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
saving without the breaking change, which is why the fallback was a freeze
rather than a removal. The trigger fired first, so neither was needed.

## Consequences

- A reader who finds these defects should not assume they are undiscovered;
  this record is the reason they are still there. Repairing one is now allowed,
  but it should carry a use that reached it.
- The affected tickets in
  `docs/plans/2026-08-08-agent-data-evidence-and-change-intelligence-ticket-backlog.md`
  are marked delivered with named known deviations rather than completed. A
  repair updates that annotation in the same change.
- The freeze path is spent and will not be taken.
- What the first use actually proved is narrow: the workflow runs and the
  output is safe. It did not prove anyone wants the output.

**Falsified if:** a deviation listed above is repaired while
`docs/plans/2026-08-08-agent-data-evidence-and-change-intelligence-ticket-backlog.md`
still annotates it as a known deviation, or `src/core/evidence-pack/index.ts`
stops hard-coding `gaps: []` without that annotation being removed in the same
change.
