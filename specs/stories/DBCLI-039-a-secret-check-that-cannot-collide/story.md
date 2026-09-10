# Story: DBCLI-039 A Secret Check That Cannot Collide

## Goal

The assertion that a verification artifact leaks no connection secret gives the
same answer every time it runs against the same code.

## Context

`tests/integration/verify-rollback-command.test.ts:364-371` reads a written
artifact and asserts the document does not contain six literals: a value, two
row ids, an expect literal, the connection port and the password. Five of them
are distinctive strings. One is not: `String(CONN.port)` is `5433`.

The artifact carries a generated id. On 2026-09-10 that id was
`ver_mtvlt4v8_73543356`, whose random suffix contains `5433` at offset four.
The test failed. Nothing had leaked: the JSON holds no port field, and the same
test passed on the same commit when run again.

This is the shape DBCLI-015 and DBCLI-019 already removed twice from this
repository — GATE-002 and GATE-003 both resolved the same way, that an assertion
which can give two answers for one commit is replaced by a deterministic
measurement rather than retried. A four-digit needle searched for in a document
containing an eight-character random suffix collides often enough to be seen: it
was seen.

The other five literals are long enough that collision is not a practical
concern, and they are not what this Story changes.

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

* Impact: low

## Risk

* Level: medium
* Reason: `weakening-a-leak-check`

The failure mode of a bad repair here is a check that stops detecting a real
leak, which is silent.

## Scope

### In Scope

* Replacing the whole-document substring search for the port with a check that
  cannot collide with generated content: parse the artifact and assert no field
  carries the port, or search only the fields a leak could reach, or assert on
  a port value that cannot appear by chance.
* A regression fixture proving the replacement still catches a real port leak —
  an artifact deliberately carrying the port in a field must fail.
* A regression fixture proving a generated id containing the port's digits does
  not fail. `ver_mtvlt4v8_73543356` is the observed value; use it.

### Out of Scope

* The other five literals in the same assertion.
* Every other `not.toContain` in the test suite. Whether this shape exists
  elsewhere is worth knowing, but auditing it is its own work and this Story
  does not claim to have done it.
* How artifact ids are generated. Changing the id to avoid the collision would
  fix the symptom in the one place it was noticed.
* The redaction behaviour itself, which is correct and is what the assertion
  exists to protect.

## Inputs

* `tests/integration/verify-rollback-command.test.ts`, the artifact writer it
  exercises, and the two ForgePilot gates that decided this class before:
  GATE-002 and GATE-003.

## Outputs

* An assertion whose answer depends only on the code under test.

## Rules

* R1: The same commit gives the same verdict, whatever id is generated.
* R2: A real port leak in any artifact field fails the assertion.
* R3: The assertion still runs against the artifact as written to disk, not
  against an in-memory object the writer never serialised.
* R4: The other five literal checks are unchanged.

## Expected Errors

* An artifact carrying the port in a field fails, naming the field.

## Dependencies

* GATE-002, GATE-003 — the two prior resolutions of this class.

## Constraints

* Do not make the check pass by narrowing what counts as a leak.

## Trust Boundary Fields

* `artifact.file` — the verification artifact as written to disk, the document
  the assertion reads
