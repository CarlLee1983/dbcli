# DBCLI Agent Integration Contract v1 — design record

**Status**: accepted for the capability slice; the remaining stories are planned, not built.
**Decision record**: [ADR-0022](../adr/0022-the-capability-catalog-is-derived-from-the-engine-matrix.md)

## The problem

An external Skill cannot currently find out what dbcli can do. `--help` is
prose, `status` describes one connection rather than the tool, and nothing
gives an ability a stable name a Skill can pin.

## Product layering

```
Story + Project AGENTS.md + Role Skill + Method Skill + Tool Skill + dbcli
```

| Layer | Answers | Example |
| --- | --- | --- |
| dbcli | What can be done at all | `schema.read`, `data.delete` |
| dbcli Skill (Tool Skill) | How to operate dbcli safely | confirm the blacklist, never guess a column |
| Method Skill | How this method works | CQRS: verify write model, read model, projection |
| Role Skill | How this job works | DBA: gather diagnostics, assess risk, verify |
| AGENTS.md | Project governance, routing, boundaries | which Skills apply here |

Consequence: **CRUD, CQRS and DBA knowledge never enters dbcli core.** A
capability id that names a job (`dba.tune-production`) belongs to a Skill, and
a unit test rejects such ids.

## Capability contract v1

A **capability** is an atomic tool ability with a stable dotted id.

Fields: `id`, `description`, `command`, `risk`, `sideEffect`, `engines`,
`engineIndependent`, `minimumPermission`, `requiresConnection`, `supportsJson`,
`supportsEvidence`.

### Single authority

`ENGINE_CAPABILITIES` (`src/adapters/capabilities.ts`) is the authority for
every engine and risk claim. `src/core/capabilities/registry.ts` declares only
identity, command path, minimum permission and `requiresConnection`, and
derives the rest. `risk` folds the existing six-value `SideEffectTier` into the
four-value Task Pack risk vocabulary (`readonly`, `dry-run`, `write`,
`unknown`); `sideEffect` carries the unfolded tier alongside, because
collapsing `local-write` and `db-write` into `write` hides the distinction a
caller most needs.

### Scope of v1, and why it stops there

The matrix governs thirty-four command keys. dbcli registers fifty top-level
commands. The sixteen without a matrix row — `explain`, `plan`, `impact`,
`assert`, `verify`, `verification`, `evidence`, `contract`, `semantic`,
`design`, `snapshot`, `backfill`, `proxy`, `recovery`, `password`, and the
newer `use` subcommands — are **absent from v1**. Writing rows for them would
mean minting per-engine support claims from a reading of the code rather than
from the prior audit the matrix represents. A discovery contract that carries
unaudited claims is worse than one that admits a boundary: asking for
`query.explain` returns `unknown`, which fails closed. Extending the matrix is
DBCLI-PLAT-011.

A contract test enforces the boundary both ways: every matrix key has a
capability, and every capability names a live Commander command path.

### `supportsJson` is narrower than it looks

`blacklist`, `migrate` and `queries` are absent from the JSON surface even
though `blacklist list --format json` works. JSON lives on their *subcommands*,
and a capability may only claim what the path it names offers. Per-subcommand
granularity is DBCLI-PLAT-005's problem, not v1's.

### Engine vocabulary

`DatabaseSystem` (`postgresql`) is canonical. `AgentTaskEngine`
(`src/core/agent-tasks/types.ts`) says `postgres`. The fork is left in place
and reconciled by DBCLI-PLAT-008; no third spelling is introduced.

### Where it lives

`src/core/capabilities/`, exported through `@carllee1983/dbcli/core`. Not
`src/agent-core/`: `scripts/check-agent-core-purity.ts` fails any file there
containing `postgresql`, and a catalog naming engines cannot satisfy that. The
gate is left as strict as it was.

## `capabilities check`

Evaluates a requirement list against the **local config only**. No connection
is opened; `src/core/capabilities/check.ts` is a pure function handed a context
or `null`.

| Status | Reason | Meaning |
| --- | --- | --- |
| `available` | `null` | Engine and permission would not refuse. |
| `unavailable` | `engine` | The configured engine does not support it. |
| `unavailable` | `permission` | Below the capability's minimum level. |
| `unavailable` | `context-unavailable` | No readable local config. |
| `unknown` | `unknown-capability` | No such id. Never guessed at. |

Engine is checked before permission, so the reason names the blocker that
raising a level would not fix.

**Duplicate ids are de-duplicated in first-seen order** and reported in
`warnings`. Refusing would punish two Skills concatenating requirement lists;
answering twice would make `results` a multiset the caller has to fold. Neither
is guessable, so it is stated here.

**An empty list is refused**, exit `2`. A requirement list that accidentally
evaluated to "nothing required" would report `ok: true` and read as a green
light.

Exit codes: `0` all available · `1` any unavailable or unknown · `2` invalid
input.

### `connectionName` names what was resolved

`context.connectionName` carries `effectiveConnectionName` from the config
reader, not the value of `--use`. On a v2 config with no selector those differ:
a named default connection is in effect while `--use` is unset, and reporting
`null` there would leave the verdict unattributable to the connection that
produced it. A v1 single-connection config has no name and correctly reports
`null`. The name is a label the user chose; the endpoint behind it never
appears.

### Config absence is not a default

`configModule.read` answers a missing config with `DEFAULT_CONFIG` — a
localhost PostgreSQL at query-only — so `init` has something to start from.
The command establishes existence first, against the same storage path the
reader resolves. Without that, this command would state in JSON that a
database nobody configured supports the requested capability.

## What the contract deliberately does not mean

* `capabilities` is discovery, not a permission grant.
* `available` is not approval. Blacklist, write gate, confirmation and audit
  all still run at execution time; human consent is not modelled at all.
* `admin` is a config value, not a DBA sign-off.
* A Task Pack plan (`status: "planned"`) is not a verification result.
* `CAPABILITY_CONTRACT_SCHEMA_VERSION` is not the npm package version.

## Task Pack boundary

Task Packs stay `plan-only`. `safety.requires` remains an unvalidated
`string[]` (`src/core/agent-tasks/parser.ts:156`). Migrating it to capability
ids is **not** done here: builtin, shared and local packs in the field carry
free-form strings, and validating them now would break packs this Story has no
mandate to change. The migration direction is: accept both forms, warn on a
non-capability string, then require ids at a future contract version.
DBCLI-PLAT-008 owns it.

## Follow-up stories

| Story | Scope |
| --- | --- |
| DBCLI-PLAT-004 | Operation Envelope v1: `schemaVersion`, `ok`, `operation`, `status`, `context`, `data`, `warnings`, `evidence`, `recovery`. Additive and opt-in; existing `--format json` output is not rewritten in place. The opt-in mechanism needs its own ADR. |
| DBCLI-PLAT-005 | Opt-in agent JSON mode, including per-subcommand JSON granularity. |
| DBCLI-PLAT-006 | Cross-command correlation id tying commands to a Story, incident, change request, migration or backfill. Correlation metadata must not bypass audit, redaction or evidence validation. |
| DBCLI-PLAT-007 | Bounded evidence receipts for `inspect`, `report`, `schema`, `plan`, `lint`, `explain`, `impact`. Never stores raw rows, credentials, connection strings, unmasked SQL, raw error bodies or unbounded stdout/stderr. |
| DBCLI-PLAT-008 | Task Pack `safety.requires` validated against capability ids, and the `postgres`/`postgresql` reconciliation. |
| DBCLI-PLAT-009 | Skill author integration kit. |
| DBCLI-PLAT-010 | External consumer contract tests: a CRUD Skill, a CQRS Skill and a DBA Operator Skill as out-of-repo consumers. Their behaviour is never implemented inside dbcli. |
| DBCLI-PLAT-011 | Extend `ENGINE_CAPABILITIES` to the sixteen commands v1 could not describe. |
