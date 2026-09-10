# Story: DBCLI-035 Statements Only SQLite Can Say

## Goal

The permission ladder gives a verdict on every SQLite statement it can meet,
and `insert`, `update` and `delete` work against a SQLite file under the same
tiers as the other SQL engines.

## Context

DBCLI-034 makes dbcli read a SQLite file, and closes the one statement that is
a connection-boundary problem rather than a permission one. What it leaves is a
classifier that has never seen SQLite's vocabulary.

`classifyStatement` (`src/core/permission-guard.ts:98-135`) maps a leading
keyword onto twelve `StatementType` members (`:27-40`). Four SQLite statements
have no member to land on, and each fails differently:

`PRAGMA` is both a read and a write depending on whether the statement carries
an `=`. `PRAGMA table_info(users)` reads; `PRAGMA journal_mode=WAL` rewrites how
the database stores everything. That is the exact shape `escalateHiddenWrite`
(`:222-256`) exists to catch for the other engines — a statement whose type
cannot be read off its first keyword.

`VACUUM` and `REINDEX` rewrite the whole database file and are unrecognised, so
they classify `UNKNOWN` and are refused for everything below `admin` by
`TIER_GRANTS` (`:283-288`). That is the correct verdict reached by accident,
and an accident is not a rule.

`REPLACE INTO` and `INSERT OR REPLACE` are the dangerous ones.
`SQL_WRITE_OR_DDL_KEYWORDS` (`:153-154`) is the regex `findWriteKeyword` scans
with, and `REPLACE` is not in it. `INSERT OR REPLACE` survives on its `INSERT`
prefix; a statement beginning `REPLACE INTO` does not, and a delete-then-insert
would classify as `UNKNOWN` — refused below `admin`, but for the wrong reason,
and mapped to no statement type at all where the audit log and the risk
analyser read one.

The classifier is hand-written throughout — `stripCommentsAndStrings` in
`src/core/permission/sql-analysis.ts` is a per-dialect state machine, and no
AST parser is on this path. SQLite's lexical rules are close to PostgreSQL's
for the parts that matter: `--` comments, `/* */` blocks, single-quoted strings
with doubled escapes, double-quoted identifiers. It has no dollar-quoting and
no backtick identifiers by default, though it accepts both for compatibility.

## Classification

* Security sensitive: yes
* Baseline conformance: no
* Task mode: execution

## Authority

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: yes
* push: no
* deploy: no

## Architecture

* Impact: medium
* Decision: `ADR-0037`
* Boundary: `SqlDialectRoster`
* Contract: `every SQLite statement the ladder can meet has a declared type, and no statement is refused only by falling through`
* Owner: `SqlDialectRoster = sql-safety`

## Risk

* Level: high
* Reason: `write-keyword-omission`

A write keyword the scanner does not know is a write dbcli believes is a read.

## Scope

### In Scope

* `REPLACE` added to `SQL_WRITE_OR_DDL_KEYWORDS`, classified as a write for
  every dialect that has it, and `INSERT OR REPLACE` asserted to keep its
  existing verdict.
* `PRAGMA` classified as `UNKNOWN` and `isDangerous`, for every form, without
  inspecting whether it carries a value — admin-only.
* `VACUUM` and `REINDEX` classified explicitly as admin-only rather than
  arriving there as unrecognised keywords.
* SQLite's lexical rules in `stripCommentsAndStrings`: no dollar-quoting,
  double-quoted identifiers, and the compatibility forms it accepts.
* `insert`, `update` and `delete` against SQLite, through the existing
  `data-executor` path.
* `ENGINE_CAPABILITIES` rows for `insert`, `update`, `delete` and `q` write
  paths.
* Documentation parity for what this Story delivers.

### Out of Scope

* Splitting `PRAGMA` into read and write forms. Deciding which side a `PRAGMA`
  falls on requires reading its argument, which is the analysis
  `escalateHiddenWrite` exists because dbcli does not trust. `dbcli schema` is
  the supported way to read table structure.
* Any change to how the other engines classify their own statements. This Story
  adds keywords; it does not re-tier existing ones.
* `migrate` and `diff` for SQLite. SQLite's `ALTER TABLE` supports a small
  subset of operations and a column change is a twelve-step table rebuild;
  that is its own Story or none.
* `init` / `use` / `export` — DBCLI-036.

## Inputs

* `src/core/permission-guard.ts`, `src/core/permission/sql-analysis.ts`,
  `src/core/data-executor.ts`, `src/adapters/capabilities.ts`.
* DBCLI-034's delivered adapter and dialect rosters.

## Outputs

* A ladder with no SQLite statement falling through it.
* Write commands against a SQLite file.

## Rules

* R1: `REPLACE INTO` is classified as a write and refused for `query-only`,
  with a statement type — not `UNKNOWN`.
* R2: `INSERT OR REPLACE` keeps the verdict it has today.
* R3: Every `PRAGMA`, with or without a value, is admin-only.
* R4: `VACUUM` and `REINDEX` are admin-only by declaration, and a test asserts
  the reason is the declaration rather than the fallthrough.
* R5: Adding `REPLACE` changes no existing verdict for PostgreSQL, MySQL or
  MariaDB. Their fixtures are unchanged.
* R6: `insert` / `update` / `delete` against SQLite obey the same tiers as
  PostgreSQL, and `--dry-run` prints SQLite-quoted SQL without executing.
* R7: A write attempted on a `query-only` connection still fails at the handle,
  as DBCLI-034 established.

## Expected Errors

* `REPLACE INTO` under `query-only` — a permission error naming the required
  tier.
* Any `PRAGMA` under anything below `admin` — a permission error.
* A write under `query-only` — SQLite's read-only refusal, unchanged.

## Dependencies

* DBCLI-034 — the adapter, the dialect rosters and the read path.
* ADR-0037 — the handle-level guarantee this Story must not weaken.

## Constraints

* No AST parser on the permission path.
* The classifier stays engine-parameterised, not engine-branched.

## Trust Boundary Fields

* `query.sql` — the statement text, from the command line, from stdin, or from
  a saved snippet
* `data.values` — the column values `insert` and `update` write, from command
  line arguments or a JSON payload
