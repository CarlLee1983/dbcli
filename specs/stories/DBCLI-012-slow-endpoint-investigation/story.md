# Story: DBCLI-012 Slow Endpoint Investigation Plan

## Goal

Give an operator one deterministic, plan-only workflow that moves from local
slow-query observations through confirmed table schema to read-only plan and
index guidance, without executing the suggested commands or claiming causation.

## Context

The Pages guide requires the operator to confirm the selected table's live shape
before explain or index guidance. The existing `slow-endpoint-investigation`
task pack connects proxy, explain, and missing-index evidence but has no table
parameter or schema step, so it does not yet encode the published sequence.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: no

## Scope

### In Scope

* Extend the existing `slow-endpoint-investigation` task pack with one required
  table parameter and a schema-inspection step.
* Produce the ordered plan: blacklist review, local proxy analysis, schema
  inspection, explain, then missing-index guidance.
* Keep every step plan-only and preserve advisory language about observations
  and index candidates.
* Add focused task-pack tests and aligned English and Traditional Chinese user
  documentation.

### Out of Scope

* Executing any planned command or automatically selecting a proxy finding.
* Creating, applying, or scheduling an index, migration, or DDL.
* Declaring a fingerprint, plan, or observation to be the cause of endpoint
  latency.
* Changing the behavior of `proxy analyze`, `schema`, `explain`, or
  `guide missing-index-for` themselves.

## Inputs

* Required `query`: the operator-selected SQL statement to investigate.
* Required `table`: the exact table selected from the local observation.

## Outputs

* A deterministic `skill tasks plan slow-endpoint-investigation` result whose
  resolved commands put `schema <table> --format json` before `explain <query>`
  and `guide missing-index-for <query> --format json`.
* Bounded reasons and read-only risk metadata for every planned step.

## Rules

* R1: The task pack remains `plan-only`; planning must not construct an adapter,
  connect, inspect schema, execute SQL, or invoke any resolved command.
* R2: The plan order is blacklist, proxy analysis, schema, explain, and
  missing-index guidance.
* R3: `table` and `query` are explicit required parameters. Missing parameters
  fail before a plan is emitted; their existing planner substitution semantics
  are unchanged by this Story.
* R4: Observation findings and suggested commands remain leads only. The plan
  must not claim endpoint causation or that an index will solve the problem.
* R5: Index guidance remains review material and the workflow never creates or
  applies DDL.

## Expected Errors

* Missing `table` or `query` input returns a bounded planning error and no
  partial plan.

## Dependencies

* Existing task-pack parser/planner and the `slow-endpoint-investigation` pack.
* Existing proxy, schema, explain, and missing-index commands remain independent
  execution surfaces.

## Constraints

* Do not execute commands, connect to a database, or add dependencies while
  planning.
* Preserve existing parameter substitution, redaction, and permission
  boundaries; generic planner escaping or validation is outside this Story.
* Keep English and Traditional Chinese Markdown and HTML documentation aligned.
* Use focused Bun tests and `make verify` as the completion gate.
