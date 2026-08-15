---
status: accepted
date: 2026-08-14
---

# Unattended callers are refused full-table writes

dbcli is an agent-first tool. Every other decision in this product resolves towards
"answer the machine": stdout is a parseable envelope, failures carry structured reasons,
and prompts are suppressed the moment nobody is watching. This decision goes the other
way, and does so deliberately, which is why it is written down.

Before 2.0.0, `dbcli query "UPDATE users SET banned = 1"` executed against any read-write
connection without asking anything. The structured `update` and `delete` commands were
safer only by accident: their `WHERE` is mandatory, and an empty one produces SQL the
database rejects. So the product's protection lived on the path that could not be misused
and was absent from the one that could — and the caller most likely to generate an
unqualified `UPDATE` is precisely the agent the design otherwise optimises for.

## Decision

A statement that is not limited to particular rows — `UPDATE` / `DELETE` with no `WHERE`,
`DROP`, `TRUNCATE`, a statement the SQL parser cannot read, and a structured
`update` / `delete` whose `--where` matches on no primary key and no unique index — is
refused when no terminal is attached to both stdout and stdin, or when `--format json` says
a machine is asking. Both streams, because the report goes to one and the question is read
from the other: a terminal on stdout alone — an agent harness with a pty on the output side
— would otherwise be prompted, and would either answer with an empty line that reads as a
decline and exits zero, or block forever. The process exits non-zero with a reason a caller
can branch on (`reason=no_where`, `ddl_destruction`, `unparseable`, `multiple_statements`,
`multi_table`, `nested_write`, `non_unique_where`).

Refused means the statement is never sent. On the raw-SQL path the gate runs before the
connection is opened; on the structured `update` / `delete` path it runs after `connect()`
and the schema read, because the uniqueness facts it judges by come from that schema — the
statement itself is still never issued.

**Scope.** SQL only, and four entry points: the three #70 named — `query`, `update`,
`delete` — and `shell`, added in #78 because leaving it out made the protection depend on
which entry point the operator picked, which is the thing this decision exists to remove.
The shell wires tier two alone: every line there is typed by a person, so a tier-one y/N
would fire on each one and become reflex, and tier one was designed for a batch of
generated writes, which a shell is not. A mistyped confirmation returns to the prompt
instead of ending the session, and piped input (`dbcli shell < script.sql`) is the
unattended case — the tier-two statement is refused and the remaining lines still run.
MongoDB and Redis writes keep the confirmation they gained in 1.58.0 rather than a second
tier, and their shells are untouched for the same reason; `q` needs no gate because a
saved snippet is refused at parse time unless it is a single read-only statement. A write performed inside a stored procedure is invisible to
this classification, and deliberately so: refusing every statement dbcli cannot recognise
would refuse `SET`, `BEGIN` and `VACUUM` along with it.

At a terminal, the same statements require the operator to type the target table name. No
flag skips this tier — not `--yes`, which skips the ordinary tier-one confirmation, and not
`--force`, which never bypassed the blacklist or the permission check either.

**What counts as "limited to particular rows" was measured, and it turned out to be two
different questions.** The first version of this decision asked whether the statement had a
`WHERE` at all. It does not follow: a `WHERE` naming only a joined table restricts the far
side of the join and removes nothing from the target. Against a 2000-row table,
`UPDATE p SET … FROM o WHERE o.id = 1` overwrote all 2000 and
`DELETE FROM p USING o WHERE o.ref > 0` deleted all 2000, both admitted as tier one, both
executed to confirm the count rather than inferred from a plan (#80).

Five rounds of adversarial review, each executing its findings against a real PostgreSQL and
MySQL, then established that the follow-up question — *does this `WHERE` narrow the write* —
is only answerable for one of the two cases:

**A single-table write** is decidable, and the criterion is positive evidence: the `WHERE`
must name a column of the table being written. A condition naming no column at all
(`WHERE 1=1`) still qualifies, because that is the escape route below and it is a statement
of intent rather than a claim about rows. A `WHERE` inside a subquery does not, because it
restricts the subquery — but a correlated reference back to the target does, provided the
name is not one the subquery binds itself. It is a lower bound: `WHERE id IS NOT NULL` names
the target and touches every row, and no static check settles that.

**A multi-table write is not decidable at all**, and this is the finding that shaped the
rule. `DELETE p FROM p JOIN o ON p.id = o.ref WHERE o.x > 0` deleted 2 of 5 rows against one
dataset and all 2000 against another: the same statement, a different answer. A join's `ON`
necessarily names the target, so reading it as evidence admitted the entire class this ADR
exists to refuse — including `UPDATE p SET … FROM o WHERE p.id = o.ref`, the standard
spelling. Four successive criteria were tried and each was defeated by the next ordinary
statement. So the tier is decided by what the statement *is*, which is knowable: a write that
brings in a second table is tier two, reason `multi_table`.

Where the parser cannot read the statement there is no tree to judge, so the same rule is
applied to the text as an allowlist — one named table, a `WHERE` or `LIMIT`, and none of
`SELECT` / `TABLE` / `VALUES` / `JOIN` / `USING`, no statement-level `WITH`, no
`UPDATE … FROM`. Written that way because the denylist it replaced was defeated once per
round: `USING`, then `JOIN`, then a CTE, then a subquery, then `TABLE` as a subquery. A
denylist can only ever rule out the second tables someone remembered.

**The cost, measured rather than estimated.** `DELETE … USING`, `UPDATE … FROM`,
`UPDATE … JOIN … SET`, multi-table `DELETE` and CTE-wrapped writes are refused for unattended
callers that used to be served, as is any statement the parser cannot read that carries a
subquery. The remedy is in the statement: move the second table into a subquery in the
`WHERE`, or run it where someone can confirm. Across five rounds the reviews found 15
full-table writes admitted as tier one and 8 statements wrongly refused; every one of them is
pinned in `tests/unit/commands/write-gate.test.ts` by the statement rather than by the rule,
so a future simplification has to argue with the measurement instead of with the code.

**The statement type is not the leading keyword**, which took its own round of measurement
(#94, #95). Two shapes put a write in front of, or instead of, the statement the first
keyword names, and each emptied or rewrote all 2000 rows of the fixture as tier one.

A **data-modifying CTE** carries an arbitrary write in its body:
`WITH moved AS (DELETE FROM p RETURNING *) INSERT INTO archive …` read as an `INSERT`, and
the same CTE under a `CREATE TABLE … AS` head read as a `CREATE` — so the rule is attached
to the shape rather than to `INSERT`. The shape is "a write keyword anywhere inside
parentheses". It was first written as "a group that *opens* with a write", and measurement
defeated that in one step: PostgreSQL lets a CTE body open a CTE of its own, so
`WITH m AS (WITH i AS (SELECT 1) DELETE FROM p RETURNING *) MERGE INTO archive …` puts a
`WITH` in the opening position and emptied the fixture as tier one. Where the write sits
inside the group is not something the grammar bounds; that it is inside one is.

What bounds the criterion is the other direction — parentheses that are not a statement body
cannot contain a write at all. A column list, a `VALUES` row, a conflict target, a function
argument and a subquery admit expressions and queries, and none of them admits an `INSERT`,
`UPDATE` or `DELETE`: those three are reserved in every supported dialect, so a column named
after one must be quoted, and quoting removes it from the text before it is read. `MERGE` is
the exception that proves the rule, being reserved nowhere, so it counts only as
`MERGE INTO` — `UPDATE t SET total = (merge + 1) WHERE id = 1` is a one-row write, measured,
and stays tier one. Two keywords do appear inside parentheses without writing anything, and
both are dropped before the scan: the lock clause `SELECT … FOR UPDATE`, as
`findWriteKeyword` already dropped it, and a foreign key's referential action —
`CREATE TABLE child (… REFERENCES parent(id) ON DELETE CASCADE)` was refused outright while
the same constraint added through `ALTER TABLE … ADD CONSTRAINT` sat outside any parenthesis
and passed. One meaning and two answers is how a criterion reports that it is matching the
wrong thing; MySQL's `ON UPDATE CURRENT_TIMESTAMP` is on most tables, and tier two has no
flag, so this was refusing ordinary migrations outright.

Such a statement is tier two, reason `nested_write`, whatever the nested write is qualified
by — for the reason `multiple_statements` gives, that two writes in one statement have no
single tier and the head cannot be read for the tail.

The check runs before every branch that can end the classification. That ordering is
load-bearing rather than incidental, and it was measured twice: placed after the `MERGE`
classification it was skipped for an insert-only `MERGE` head, and left in the tier-one
branch it was never reached for an `UPDATE` or `DELETE` head —
`WITH moved AS (DELETE FROM p RETURNING *) MERGE INTO archive …` and
`WITH m AS (UPDATE p SET c = 99 RETURNING *) UPDATE q SET c = 1 WHERE q.id = 1` each emptied
or rewrote all 2000 rows as tier one. The second is not an ordering slip but a wrong
assumption: a CTE-wrapped `DELETE` defeats the parser and resolves upwards through
`unparseable`, while a CTE-wrapped `UPDATE` or `INSERT` parses cleanly and its `with` clause
was never read. That backstop is not a second line of defence to lean on either — it exists
only for `UPDATE` and `DELETE` heads, the ones that reach the parser at all. A `MERGE`,
`CREATE` or `ALTER` head never does, so the criterion has to hold on its own.

`MERGE` is classified by its `WHEN … THEN` action list, not by a keyword substitution: a
destructive action (`THEN DELETE`, `THEN UPDATE`) makes it tier two, an insert-only or
`DO NOTHING` one leaves it tier one. That distinction is what keeps this a classification
rather than a blanket refusal that would have taken every ordinary upsert with it. The tier
comes from the rule already covering the shape — a `MERGE` reads its rows from `USING`, so
it is a multi-table write, and its `ON` is a join condition and evidence of nothing — so the
reason is `multi_table`. Reading `MERGE` off the leading keyword was the first spelling of
this fix and a CTE walked past it in measurement, so it is read at statement level instead.

The cost, measured: a CTE deleting one row by primary key and the ordinary
`WHEN MATCHED THEN UPDATE … WHEN NOT MATCHED THEN INSERT` upsert are both refused, one row
each. Both are accepted on the same terms as the multi-table rule above. `ON CONFLICT … DO
UPDATE`, `ON DUPLICATE KEY UPDATE`, `INSERT … SELECT`, a read-only CTE feeding an `INSERT`
and a scalar subquery in a `VALUES` row were each measured before and after and stayed tier
one.

**Known residuals.** PostgreSQL's `WITH (option = value)` admits a reserved word as a bare
value, and logical replication's options are those words:
`CREATE PUBLICATION pub FOR TABLE t WITH (publish = delete)` is refused as `nested_write`,
though the quoted spelling `WITH (publish = 'insert, update, delete')` is not. Recorded
rather than fixed, deliberately. Each of the three removals above rests on a fact about the
grammar — reserved words must be quoted to be identifiers, a lock is not a write, `ON` is
never followed by a statement — and a fourth would rest on recognising one particular clause
shape, which is the "rule out the spellings someone remembered" failure this criterion was
built to avoid. Logical replication is a rare administrative operation rather than a write
path, and at a terminal the cost is one typed table name.

`ALTER TABLE … DROP COLUMN` is tier one, which is consistent with
`ALTER` being an ordinary write but is unarguably destructive; it is recorded here rather
than decided. And
`UPDATE ONLY p AS x` is indistinguishable in the parse tree from `UPDATE "only" AS x`, so a
table genuinely named `only` and given an alias is named by its alias in the confirmation
phrase.

The escape route for anything that accepts a `WHERE` is the statement itself: `WHERE 1=1`
or a `LIMIT`. This is not chosen for being harder to type. It is chosen because it cannot
be composed — appending `WHERE 1=1` to a statement that already has a `WHERE` is a syntax
error, so the habit of adding it everywhere breaks on the first ordinary statement and
never survives. A flag has the opposite property: harmless on every statement, therefore
certain to be set once and forgotten. Any future proposal to "simplify" this into a flag
should be weighed against that property rather than against convenience. `DROP` and
`TRUNCATE` have no clause to add, so their authorisation stays on the per-connection
`permission` axis, where the decision is made once per environment and lives in version
control.

## Consequences

The result contract changed with it. `status` gained `cancelled` and `dry_run` in the
preceding change, and the gate produces a fourth outcome an agent must be able to see: a
non-zero exit that is not a connection failure and not a permission denial. Hence the
stable `code` and `reason` on `WriteGateRefusal` rather than prose alone.

This is a breaking change under semantic versioning with no ambiguity: automation that
performed unguarded full-table writes stops working. It shipped as 2.0.0, alone, with a
migration note naming the invocations that will now be refused. There is no
environment-variable opt-in period — a flag that makes the same version behave differently
on different machines makes every subsequent bug report ambiguous, and never gets removed.

## Why record this

Because it contradicts the product's own orientation, and a future contributor who does not
know why will read the refusal as a bug and fix it back. "The tool refuses to serve an
unattended caller" is a defect in almost every other part of dbcli. Here it is the feature.

Its effect is a measurement, not an assumption. Every tier-two evaluation is written to the
audit log — allowed, declined and refused alike — because a log that kept only refusals
could not tell "nobody writes like that" apart from "everyone found a way around it". If
the records show tier two is almost never reached, the criterion is wrong rather than the
gate unnecessary. Every such entry is filed under `side_effect_tier: db-write` whatever
entry point produced it, so filtering the log for destructive operations by tier — the
first filter anyone reaches for — returns all of them and not the third that happened to
come from a command whose own capability is a write (#83).

**Falsified if:** `src/commands/write-gate.ts` stops classifying an unqualified
`UPDATE` / `DELETE`, `DROP`, `TRUNCATE` or unparseable statement as tier two, or
`src/commands/write-gate-prompt.ts` stops throwing `WriteGateRefusal` for a tier-two
statement when either stdout or stdin is not a terminal, or a flag is added that skips tier
two, or
`src/commands/write-gate-guard.ts` stops recording an allowed tier-two decision to the
audit log, or `src/commands/shell-write-gate.ts` stops being handed to `ReplEngine` for a
SQL connection in `src/commands/shell.ts`, or
`src/core/audit/write-gate-summary.ts` stops counting those recorded decisions — that
summary is what makes the measurement above something anyone will actually take, so
losing it leaves the rest of this condition true and unverified — or if `nestedWrite` or
`classifyMerge` in `src/commands/write-gate.ts` stop resolving a statement that carries a
write inside a parenthesised group, or a `MERGE` with a `THEN DELETE` / `THEN UPDATE` action,
to tier two — without those two the statement type falls back to the leading keyword, which
is the state #94 and #95 were — or if `narrowsTarget` /
`writeTargets` in `src/commands/write-gate.ts` stop requiring a condition that names the
table being written before granting tier one, or if `unparseable` in the same file stops
resolving a statement that carries a join, a CTE or a subquery to tier two. Without that last clause the positive-evidence
criterion contributes no boundary and could be reverted to "is there a WHERE at all"
silently, which is the state three rounds of measurement were spent leaving.
