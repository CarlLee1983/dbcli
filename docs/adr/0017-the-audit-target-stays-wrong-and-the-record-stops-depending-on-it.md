---
status: accepted
date: 2026-08-31
---

# The audit `target` keeps its meaning, and the record says what the blacklist compared

## Context

`docs/specs/2026-08-30-cross-engine-blacklist-gaps.md` item 10 records that the
blacklist and the audit trail do not agree on which tables a statement touches.
The blacklist tokenises with `extractTableReferences`
(`src/utils/sql-tables.ts`); the audit trail derives one name with
`extractTableName`, through `getOperationTarget` in `src/utils/engine-hints.ts`.

Measured on 2026-08-31 against a local MariaDB:

| statement | audit `target` | absent from the record |
| --- | --- | --- |
| `SELECT * FROM a JOIN salaries s …` | `a` | `salaries` |
| `CREATE TABLE dump AS SELECT * FROM salaries` | `salaries` | `dump`, the table created |
| `INSERT INTO staging SELECT * FROM salaries` | `staging` | `salaries`, the table read |

The case the spec did not state is the sharpest. With `salaries` blacklisted,
the first statement is correctly refused — and the audit row for that refusal
carries `target: "a"`. Asking the record "did anyone try to reach the protected
table" by the field built for that question returns nothing. The real name
survives only inside the free text of `error`.

## Decision 1: `target` is left as it is, and `metadata.blacklist_checked` is added beside it

The identifiers the blacklist compared against — `extractTableReferences`'s
return, unmodified — go into `metadata.blacklist_checked`. `target` keeps both
its derivation and its existing values.

This deliberately leaves `target` semantically inconsistent — for
`CREATE TABLE dump AS SELECT * FROM salaries` it still names the table that was
read rather than the one that was created. That is the cost, and it is chosen
over the alternatives because `target` is a field downstream tools filter on,
and the two candidate repairs both silently change what an existing query
returns:

- **`target` as the object acted upon** (the write destination, falling back to
  the first table read) is the meaning the name promises, and changing to it
  moves every CTAS and `UPDATE … FROM` row to a different table without any
  reader being told.
- **`target` as the tokeniser's first reference** removes the second parser,
  which is the mechanical half of the defect, but "first" is a position rather
  than a meaning, and it changes existing values just as much.

Both were rejected on the same ground: this repair exists to stop a table from
being *absent* from the record, and neither absence is fixed any better by also
making the present field move. A reader who wants "every statement that touched
`salaries`" queries `metadata.blacklist_checked`, which is complete by
construction; a reader who has a query on `target` keeps it working.

## Decision 2: the field is named for what it holds, not for what it looks like

`extractTableReferences` over-collects on purpose. Measured on 2026-08-31 it
returns `["a","salaries","s","id","s.id","a.id"]` for the JOIN above and
`["dump","salaries","CREATE","TABLE"]` for the CTAS: aliases, qualified column
references, and SQL keywords. For a blacklist that is correct — an extra
identifier can only cause an over-refusal, which is the safe direction — and
the spec's proposed `metadata.tables` would therefore have filed `CREATE` and
`s.id` in the audit trail as tables.

Two repairs were rejected. Filtering the list down to plausible table names is
a third parser, and *two parsers disagreeing* is the defect this record exists
to close; it also cannot remove an alias, which is indistinguishable from a
table name by inspection. Narrowing `extractTableReferences` itself changes
what the blacklist refuses — a safety-relevant change made as a side effect of
an audit improvement, which is the wrong way round.

So the list is stored unmodified under a name that is true of it. A reader
asking "was this statement checked against `salaries`" gets a correct answer;
a reader who wanted a table list is told by the field name that this is not
one.

## Consequences

The record now answers the question it could not: `metadata.blacklist_checked`
on the refusal above contains both `a` and `salaries`, so a blacklist refusal
is findable by the table it protected.

`target` and the contents of `metadata.blacklist_checked` will disagree for
some statements, and that disagreement is intentional rather than a bug to be
tidied away. Anyone
tempted to align them is changing a published field's values and should say so
in a record of their own.

Non-SQL engines are untouched. `getOperationTarget` resolves MongoDB,
Elasticsearch and Redis from explicit options rather than by parsing, so there
is no second parser to reconcile and no table list to derive.

**Falsified if:** `writeAuditEntryResult` in
`src/core/audit/integration-helper.ts` writes a SQL entry whose
`metadata.blacklist_checked` is not exactly what `extractTableReferences` in
`src/utils/sql-tables.ts` returns for that statement — filtering it there is
the third parser this record refuses; or `getOperationTarget`
in `src/utils/engine-hints.ts` starts deriving `target` from
`extractTableReferences`, which would make this record's trade-off moot and
require its own; or `extractTableName` in the same file gains a second caller
outside `getOperationTarget`.
