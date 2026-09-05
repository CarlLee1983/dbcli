# DBCLI Agent Integration Contract v1 — design record

**Status**: accepted and delivered. DBCLI-PLAT-010 keeps CRUD, CQRS, and DBA
consumer requirements outside dbcli core as public-contract fixtures.
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
caller most needs. `limitedEngines` does the same job for engine support: the
matrix distinguishes `limited` from `supported`, and folding both into
`engines` would throw that away — `data.delete` works on Redis, but not the way
it works on PostgreSQL.

`minimumPermission` is derived too, wherever a derivation exists.
`minimumPermissionFor` in `permission-guard.ts` is the table the *runtime*
refusal consults; a capability that maps to a SQL statement type declares the
type and takes the level from there. Transcribing four levels into the registry
would have been a second permission ladder, and the argument against a second
engine table applies unchanged.

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
| `unavailable` | `agent-mode` | `DBCLI_AGENT_MODE=1` and the capability changes configuration. |
| `unavailable` | `context-unavailable` | No local config here. |
| `unavailable` | `context-unresolvable` | A config exists and would not resolve into an engine and a permission. |
| `unknown` | `unknown-capability` | No such id. Never guessed at. |

Blockers are checked least-fixable first — engine, then agent mode, then
permission — so the reason names the one actually in the way. Engine cannot be
changed for this connection at all; agent mode cannot be lifted from inside the
process subject to it; permission is a config edit.

### Agent mode is a context field, not an execution-time concern

`DBCLI_AGENT_MODE=1` makes `assertConfigMutationApproved()` refuse every
configuration, permission and credential change unconditionally. That is
knowable without connecting, so it belongs beside engine and permission.

The "available is not approval" disclaimer does not stretch to cover it, and
the distinction is *when the refusal is decided*: blacklist rules and human
consent are decided at execution time, which the contract cannot speak for;
agent mode is decided here. `connection.init`, `connection.select` and
`blacklist.manage` carry `mutatesConfiguration: true` — the capabilities where
changing configuration *is* the capability — and a contract test derives that
set from the command layer's real calls rather than trusting the declaration.

**The known overstatement:** `dbcli schema` persists its result into
`config.json` behind the same guard, so under agent mode `schema.read` reports
`available` while a real invocation's persistence step fails. Marking the three
`schema` capabilities would make them `unavailable` and tell an agent it cannot
read schema at all — a much larger error in the opposite direction. The real fix
is that a schema *cache* write is not a change of connection identity and should
not sit behind the identity guard: DBCLI-PLAT-012.

**Closed by DBCLI-PLAT-012.** The reasoning above is left standing because it is
why shipping the overstatement was defensible, not because it still describes
the product. `src/core/schema-cache-persistence.ts` now stores the cache
directly: it takes a schema and two timestamps, reads the config itself, and
writes back a document differing only in the cache fields, so there is nothing
for the identity guard to approve. `assertConfigMutationApproved()` is
unchanged and still refuses every connection, permission and credential change
under agent mode. The claim and the command are tied together by
`tests/integration/schema-cache-agent-mode.test.ts`, which asks
`capabilities check` and then runs `dbcli schema` in one test.

Moving it also closed a defect nobody had recorded: the v1 cache write went
through `configModule.write`, which republishes the whole document, so every
`dbcli schema` deleted `connection.password` from `config.json` and rewrote
`.env.local` — outside agent mode too, where no guard fires.

### "No config" and "config I cannot resolve" are different facts

Conflating them was a defect, not a simplification. A config whose
`{"$env": "..."}` password names an unset variable is present and readable; the
one config reader resolves credentials — which this command never needs — before
it will answer. Reporting "no configuration was found" there states something
false about the user's machine. `context-unresolvable` is therefore its own
reason, and the error's message is not surfaced because it carries filesystem
paths.

Five situations previously collapsed into one false warning: an unresolvable
env-ref, a v1 config given `--use`, a production connection needing an explicit
selector, an agent-mode integrity failure, and genuinely corrupt JSON. Only the
last is "unreadable"; none is "absent". All still fail closed.

**Duplicate ids are de-duplicated in first-seen order** and reported in
`warnings`. Refusing would punish two Skills concatenating requirement lists;
answering twice would make `results` a multiset the caller has to fold. Neither
is guessable, so it is stated here.

**`required` and `results` hold the requested ids in first-seen input order**,
so reordering the arguments reorders the answer and the two byte streams
differ. What argument order does not change is any capability's verdict or the
overall `ok`. Sorting the lists would make reordering byte-identical and cost
more than it bought: a caller would lose the correspondence between the list it
sent and the list it got back, and would have to re-index by id to read its own
answer. `results[i]` is about `required[i]`, and that is the property worth
having. (DBCLI-PLAT-013 states this here. PLAT-001's Story text had made a
stronger ordering claim, which nothing implemented and no test asserted; see
that Story's Superseded Behavior for the withdrawn wording.)

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

Task Packs stay `plan-only`. `safety.requires` is a list of capability ids;
dbcli rejects unknown and legacy command-name requirements while loading a
pack, then evaluates the requirements against the local engine, permission,
and agent-mode context before it emits a plan. It is a preflight condition,
not an execution approval: the generated commands still pass their normal
blacklist, write, confirmation, and audit gates. DBCLI-PLAT-008 owns this
validation boundary.

## Follow-up stories

| Story | Scope |
| --- | --- |
| DBCLI-PLAT-004 | Operation Envelope v1: the ten always-present keys `schemaVersion`, `ok`, `operation`, `status`, `context`, `data`, `warnings`, `evidence`, `recovery`, `error`. Additive and explicitly selected by the root `--agent-output` option; existing `--format json` output is not rewritten in place. ADR-0024 supersedes this table's preliminary shape and defines the accepted contract. |
| DBCLI-PLAT-005 | Opt-in agent JSON mode, including per-subcommand JSON granularity. |
| DBCLI-PLAT-006 | Cross-command correlation id tying commands to a Story, incident, change request, migration or backfill. Correlation metadata must not bypass audit, redaction or evidence validation. |
| DBCLI-PLAT-007 | Bounded evidence receipts for `inspect`, `report`, `schema`, `plan`, `lint`, `explain`, `impact`. Never stores raw rows, credentials, connection strings, unmasked SQL, raw error bodies or unbounded stdout/stderr. |
| DBCLI-PLAT-008 | Task Pack `safety.requires` validated against capability ids, and the `postgres`/`postgresql` reconciliation. |
| DBCLI-PLAT-009 | Skill author integration kit. |
| DBCLI-PLAT-010 | Delivered: external CRUD, CQRS, and DBA consumer contract fixtures. Their behaviour is never implemented inside dbcli. |
| DBCLI-PLAT-011 | Extend `ENGINE_CAPABILITIES` to the sixteen commands v1 could not describe. |
| DBCLI-PLAT-012 | Move schema-cache persistence out from behind the agent-mode *identity* guard, so `schema` stops being a configuration writer. |
