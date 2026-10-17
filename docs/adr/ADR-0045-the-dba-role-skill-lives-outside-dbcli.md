# The DBA Role Skill lives outside dbcli

* Status: accepted
* Date: 2026-10-17

## Context

Stage B of issue #222 adds a DBA Role Skill — backup and recovery,
replication and HA, native grants and production change governance — on top
of dbcli. `CONTEXT.md` (Skill layering) already keeps Role knowledge out of
dbcli core, but the repository also ships the Tool Skill (`skills/dbcli/`) and
the `dbcli-agent` plugin, so a `skills/dba/` beside them looks like the
obvious home. Decided in the wayfinder ticket "DBA Role Skill 的家與形態"
(issue #233).

## Decision

The DBA Role Skill lives in its own public repository, `dba-skill`, as one
Agent Skills folder (`dba`) with the three workflows as reference files. It is
not added under `skills/` or `plugins/` here, and dbcli does not release it.

Its dependency on dbcli is declared as capability ids plus the capability
contract version, never as an npm version range. Each workflow first runs
`dbcli capabilities check --require … --format json`; anything other than
`available` is blocked, and a `schemaVersion` it does not declare stops the
workflow. A capability still on the dbcli gap list is declared by the id its
dbcli Story fixes; until it ships, `unknown` blocks that step and hands it to
a human.

Rejected alternative: ship it from this repository next to the Tool Skill.
Installation would be one step, but Role Skill changes would ride dbcli's
release cadence, and the Role Skill also orchestrates AWS APIs and native
tools that are not dbcli's concern.

## Consequences

dbcli owes the Role Skill only a stable capability catalog: a new capability
needs no coordinated release, and a catalog shape change is visible to it
through `CAPABILITY_CONTRACT_SCHEMA_VERSION`.

**Falsified if:** a DBA workflow (backup, replication, grants or change
governance) appears under `skills/`, `plugins/` or `assets/tasks/`; or
`CAPABILITY_CONTRACT_SCHEMA_VERSION` in `src/core/capabilities/types.ts`
changes without the `capabilities check` output in
`src/commands/capabilities.ts` carrying it as `schemaVersion`.
