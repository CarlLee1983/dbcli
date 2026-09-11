# Story: DBCLI-037 A Refusal That Names A Tier That Works

## Goal

A refusal names a permission level that would actually permit the statement, or
names none at all — never one that refuses it again.

## Context

An unrecognised statement classifies `UNKNOWN`, which only `admin` permits.
Measured against the current binary, for every engine:

| Permission | Verdict on `REPLACE INTO users VALUES (1)` |
| --- | --- |
| `query-only` | refused, `required: read-write` |
| `read-write` | refused, `required: admin` |
| `data-admin` | refused, `required: admin` |
| `admin` | allowed |

A `query-only` user is told to obtain `read-write`, obtains it, and is refused
again. `PRAGMA`, `VACUUM` and `REINDEX` behave the same way, as does any
statement dbcli cannot name.

This is the failure `src/core/permission-guard.ts:443-449` records as already
fixed — for `enforcePermissionForType`, which passes `minimumPermissionFor(type)`
precisely so a refusal names the tier that would work. `checkPermissionForClassification`
takes the other path: below `admin` it falls through to the generic tier
messages, which name the next level up rather than the level that grants the
type. The comment states the rule; one of the two paths implements it.

DBCLI-034 surfaced this while measuring SQLite statements. It is not a SQLite
question — the engine never enters it — which is why it is here rather than in
DBCLI-035.

## Classification

* Security sensitive: no
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

* Impact: low

## Risk

* Level: medium
* Reason: `refusal-message-surface`

Every engine's refusal text is in scope, and refusal text is what agents parse.

## Scope

### In Scope

* `checkPermissionForClassification` names the lowest tier that grants the
  classified type, using the same `minimumPermissionFor` the type-based path
  already uses.
* Where no tier grants the type, the refusal says `admin` — which is true —
  rather than the next level up.
* Regression coverage for each tier of each statement type, so a refusal that
  names an unhelpful tier fails a test rather than a user.

### Out of Scope

* Which tier grants which statement type. `TIER_GRANTS` is unchanged; this is
  about what a refusal *says*, not what it decides.
* The Redis and Elasticsearch enforcers, which already pass the level that
  would work.
* Any change to `PermissionError`'s shape or to the commands that catch it.

## Inputs

* `src/core/permission-guard.ts`, `tests/unit/core/permission-guard*`.

## Outputs

* A refusal a reader can act on.

## Rules

* R1: For every statement type and every permission below the one that grants
  it, the refusal names the tier that grants it.
* R2: For a type no tier grants, the refusal names `admin`.
* R3: No verdict changes. Only the named tier and the message change.
* R4: The existing allowed/refused fixtures are unchanged.

## Expected Errors

* Refusals only; this Story adds none.

## Dependencies

* DBCLI-034 — where the behaviour was measured.

## Constraints

* One source of truth for "the tier that would work": the helper the type-based
  path already uses.
