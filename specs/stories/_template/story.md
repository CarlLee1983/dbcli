# Story: <ID> <Title>

## Goal

Describe the user or business outcome.

## Context

Relevant background necessary to understand the change.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: no
* Task mode: execution

`Task mode` is optional and defaults to `execution`. Use `architecture` for a
boundary, ownership, contract, or migration decision; `evidence` for inspection,
review, or diagnosis that must not change the repository; and `mixed` when the
Story contains both.

## Authority

Optional. Delete this section to accept the documented defaults for the task
mode. Every operation is declared as `yes` or `no`, and being able to perform an
operation is never authorization to perform it.

* plan: yes
* modify: yes
* add_dependency: no
* migration: no
* commit: no
* push: no
* deploy: no

## Architecture

Optional. `Impact` defaults to `low`; delete this section for a Story that
carries no architecture weight. `Impact: medium` or `high` must name at least
one decision or contract. Each `Decision` resolves to a record under
`specs/decisions/`.

* Impact: low
* Decision: `ADR-001`
* Boundary: `BoundaryName`
* Contract: `BoundaryName public interface remains compatible`
* Owner: `BoundaryName = owning-domain`

## Risk

Optional. `Level` defaults to `low`; `medium` and `high` must name at least one
reason. Risk raises inspection and verification depth. It never widens scope.

* Level: low
* Reason: `signal`

## Scope

### In Scope

*

### Out of Scope

*

## Inputs

*

## Outputs

*

## Rules

* R1:
* R2:

## Expected Errors

*

## Dependencies

*

## Constraints

*

## Guidance

<!-- Optional. Reference relevant engineering principles, decisions, or
practices. Do not place product requirements here. Omit this section when no
guidance is relevant. -->

Relevant:

* principle: <id>

Not applicable:

*

## Trust Boundary Fields

Required when `Security sensitive: yes`; otherwise delete this section. Name
every user-controlled or externally derived field the requirement covers,
including custom metadata, derived summaries, evidence labels, error details,
and external references.

* `field.name` — where the value enters the system

## Superseded Behavior

Required when `Baseline conformance: yes`; otherwise delete this section. Name
each existing test or documented behavior this Story intentionally replaces.

* `path/to/test` — the behavior that must change and why
