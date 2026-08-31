---
status: accepted
date: 2026-08-31
---

# The SQL shell audits every statement, in the same two rows the Elasticsearch shell writes

## Context

`docs/specs/2026-08-30-cross-engine-blacklist-gaps.md` item 11 said the SQL
shell records only tier-two write-gate decisions, and marked itself as a
read-code conclusion worth confirming before acting on. It was confirmed on
2026-08-31 against a local MariaDB 10.11 on a `read-write` connection, with the
audit file emptied before each run:

| path | effect | audit rows |
| --- | --- | --- |
| `dbcli query "SELECT …"` | returned 2 rows | 1 |
| shell `SELECT …` | returned 2 rows | **0** |
| shell `UPDATE … WHERE id=2` | **changed the data** | **0** |
| shell `DELETE FROM …` (no WHERE) | refused by permission | **0** |
| shell `UPDATE …` (no WHERE) | refused by the write gate | 1 |

A statement that ran to completion and modified a row left no record. The one
row that does get written comes from `createShellWriteGate` in
`src/commands/shell-write-gate.ts`, which returns early on anything that is not
tier two; `src/core/repl/repl-engine.ts` contains no audit call of its own.

The measurement also showed the tier-two coverage to be narrower than the spec
credited. A full-table `DELETE` at `read-write` is stopped by the permission
check in `repl-engine.ts` *before* the write gate is consulted, so the one
decision that would have been recorded never happens. Tier two is audited only
in the single combination where permission allows and the gate refuses.

The Elasticsearch shell already settled the same question in the other
direction. `EsShellAuditSink` in `src/commands/es-shell.ts` writes `attempt`
before the request and `outcome` after it, and its own documentation gives the
reason — *one row written only on the way back cannot describe a request that
never came back* — and then points at the SQL path as recording its gate
decision before executing "for the same reason". That cross-reference is true
of one statement class out of all of them.

So the question is not whether the SQL shell is inconsistent with something.
It is inconsistent with `dbcli query` on the same connection, with the
Elasticsearch shell in the same binary, and with the rationale written into its
own sibling.

## Decision 1: the shell audits every statement, reads included

Every statement submitted to the SQL shell is audited: reads, writes, and
anything refused by permission, the blacklist, or the write gate.

The alternative considered was to audit effects and refusals but not ordinary
reads, on the grounds that an interactive session generates far more SELECTs
than writes. It was rejected because it makes the record's coverage depend on
which entry point the operator reached the connection through. `dbcli query`
audits a SELECT today. A user who types the same SELECT at the `dbcli>` prompt
is doing the same thing to the same data under the same credentials, and a log
that answers "what was read from this connection" for one and not the other
answers it for neither — the absence of a row stops meaning anything once
absence has a second explanation.

The narrower variants (writes plus refusals; or writes, refusals and reads that
a control actually ruled on) both buy their volume saving by making the rule
harder to state than "everything". A record whose coverage cannot be described
in one sentence is one whose gaps are found by accident, which is how item 11
was found.

## Decision 2: two rows, `attempt` before and `outcome` after

The shell writes the same pair the Elasticsearch shell writes. `attempt` goes
out before the statement is sent; `outcome` after it returns or throws. A
statement refused before execution writes only `outcome`, because it was never
attempted.

The single post-hoc row that `dbcli query` writes was considered and rejected
for the shell. The Elasticsearch reasoning transfers without modification: a
long `UPDATE` interrupted at the client, a `SIGTERM` mid-statement, or a
connection dropped while the server keeps working all produce a completed
effect and no record. That is precisely the case an audit exists for, and it is
the case a return-path-only row cannot cover.

This is a new output format for the SQL shell, and it doubles the row count for
statements that execute. Both are accepted deliberately: an operator reading
audit output should not have to know which engine produced a line in order to
know how to read it.

## Decision 3: the rotation default rises to 10,000 entries

`AuditRotationConfigSchema` in `src/utils/validation.ts` defaults to 1,000
entries / 10 MiB. Under Decisions 1 and 2 a working interactive session can
reach 1,000 rows on its own, and rotation would then discard the writes to keep
the reads — exactly inverting the value of the file.

The entry ceiling rises to 10,000; the byte ceiling is unchanged, since it is
the one that bounds disk use and nothing here makes an individual row larger.
This is the cheapest decision here to reverse — it is a config value, and an
operator who wants the old behaviour sets `audit.rotation.max_entries` — which
is why it is settled here rather than asked about separately.

## Consequences

The shell gains an audit dependency it did not have. `repl-engine.ts` currently
has no audit call, and adding one puts a failure mode on the read path that was
not there: `audit.strict: true` (ADR-0014) refuses an operation whose pre-flight
row cannot be written, and under Decision 1 that now includes a `SELECT`. This
is consistent with what `strict` already means for `dbcli query` and for the
Elasticsearch shell, and an operator who does not want reads to be refusable on
audit failure has the same lever they always had: leave `strict` off, where a
failed write is a warning and the statement proceeds.

Item 11's permission-ordering gap is closed as a side effect rather than as its
own decision: once the shell audits at the statement boundary, a refusal is
recorded wherever it came from, and it stops mattering that the permission
check runs before the write gate.

**Falsified if:** `ReplEngine.processInput` in `src/core/repl/repl-engine.ts`
reaches an adapter without writing an `attempt` row, or returns a refusal
without writing an `outcome` row; or the shell's audit sink stops accepting the
`phase` field that `EsShellAuditSink` in `src/commands/es-shell.ts` defines; or
`createShellWriteGate` in `src/commands/shell-write-gate.ts` becomes the only
audit call on the SQL shell path again; or `AuditRotationConfigSchema` in
`src/utils/validation.ts` returns `max_entries` to a value a single interactive
session can exhaust.
