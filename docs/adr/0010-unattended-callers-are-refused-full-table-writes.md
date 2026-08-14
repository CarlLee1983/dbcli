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
`non_unique_where`).

Refused means the statement is never sent. On the raw-SQL path the gate runs before the
connection is opened; on the structured `update` / `delete` path it runs after `connect()`
and the schema read, because the uniqueness facts it judges by come from that schema — the
statement itself is still never issued.

**Scope.** SQL only, and the three entry points #70 named: `query`, `update`, `delete`.
MongoDB and Redis writes keep the confirmation they gained in 1.58.0 rather than a second
tier; `q` needs no gate because a saved snippet is refused at parse time unless it is a
single read-only statement. A write performed inside a stored procedure is invisible to
this classification, and deliberately so: refusing every statement dbcli cannot recognise
would refuse `SET`, `BEGIN` and `VACUUM` along with it.

At a terminal, the same statements require the operator to type the target table name. No
flag skips this tier — not `--yes`, which skips the ordinary tier-one confirmation, and not
`--force`, which never bypassed the blacklist or the permission check either.

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
gate unnecessary.

**Falsified if:** `src/commands/write-gate.ts` stops classifying an unqualified
`UPDATE` / `DELETE`, `DROP`, `TRUNCATE` or unparseable statement as tier two, or
`src/commands/write-gate-prompt.ts` stops throwing `WriteGateRefusal` for a tier-two
statement when either stdout or stdin is not a terminal, or a flag is added that skips tier
two, or
`src/commands/write-gate-guard.ts` stops recording an allowed tier-two decision to the
audit log.
