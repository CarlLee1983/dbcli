# Story: DBCLI-PLAT-011 Complete Capability Matrix

## Goal

An external Skill asking `dbcli capabilities` gets an answer about every public
command, not two thirds of them — and every engine claim in that answer is one
somebody read out of the code, not one somebody assumed.

## Context

`ENGINE_CAPABILITIES` covers 34 command keys. dbcli has 43 top-level commands.
Sixteen are absent from the catalog entirely: `assert`, `backfill`,
`capabilities`, `contract`, `design`, `evidence`, `explain`, `impact`,
`password`, `plan`, `proxy`, `recovery`, `semantic`, `snapshot`, `verification`
and `verify`. Ask about one and the answer is `unknown`, which fails closed and
is honest, but it means the contract's main consumers — Role and Method Skills
that compose dbcli — cannot preflight a third of the tool.

PLAT-001 left them out deliberately, and its reasoning is the constraint this
Story works under: writing engine support for a command nobody has audited is
fabricating exactly the kind of claim the contract exists to prevent. That
Story's own record is five contract lies caught by tests and review, none by
reading code. So the rule here is not "fill in the matrix"; it is "fill in what
the code settles, and say `unsupported` where it does not."

`unsupported` rather than a third status. The catalog already has four —
`supported`, `limited`, `unsupported`, `not-applicable` — and adding "we did not
check" would give a caller a value it cannot act on, while inviting the entry to
sit unchecked forever. A capability the code does not clearly support is one an
external Skill should not build on, and `unsupported` says that in the
vocabulary the caller already parses. What the audit could not settle is
recorded in this Story and in the matrix note, where a human reads it.

Two boundaries carry over unchanged. There is exactly one engine support table
and this Story does not create a second — `src/core/capabilities/registry.ts`
still derives every engine and risk value from the matrix (ADR-0022). And the
catalog and the live Commander tree must agree in both directions: a capability
naming a path that does not exist, or a `supportsJson` claim the tree does not
offer, is the failure `tests/contract/capability-contract.test.ts` exists to
catch, and it now has sixteen more commands to catch it on.

One question this Story has to answer rather than assume: whether `capabilities`
itself belongs in the catalog. It is a public command like the others, and a
Skill discovering dbcli through it might reasonably expect to find it there. It
is also the thing doing the answering, which makes a self-entry either
load-bearing or circular depending on what a caller would do with it. The
decision goes in an ADR either way, because it is exactly the kind of choice a
later reader would otherwise "fix".

## Audit evidence

Every row was read out of the code at the cited line. `SQL` means
postgresql/mysql/mariadb `supported` and mongodb/redis/elasticsearch
`unsupported`; `all` means every engine `not-applicable` — the command never
opens a database and its behaviour does not vary by engine. `conn` is whether
the command constructs a database adapter.

| Command path | Engines | Evidence | conn | json | tier |
| --- | --- | --- | --- | --- | --- |
| `explain` | SQL | `src/commands/explain.ts:43-46` rejects any system outside `['postgresql','mysql','mariadb']` | yes | yes | readonly |
| `plan` | SQL | `src/commands/plan.ts:42` passes `toSqlDialect(system)`, which returns `undefined` for non-SQL (`src/core/permission-guard.ts:149-151`), so the risk analysis has no dialect to work in | no | yes | readonly |
| `impact assess` | SQL `supported`, others `limited` | `src/commands/impact.ts:186-195` gates only `loadCacheBaseline`, reached solely via `--against-cache` (`impact.ts:95-108`); `--against-orm` never reads the connection | no | yes | local-write (`impact.ts:500-533` writes the output path) |
| `assert` | SQL | `src/commands/assert.ts:41-46` `SQL_SYSTEMS` gate | yes | yes | local-write (`assert.ts:172-181` optional verification artifact) |
| `snapshot` | SQL | `src/commands/snapshot.ts:30-34` `SQL_SYSTEMS` gate | yes | yes | local-write (`snapshot.ts:46,120` writes `.dbcli/snapshots/`) |
| `verify` | SQL | `src/commands/verify.ts:75-83` `SQL_SYSTEMS` gate | yes | no — JSON is on the four scenario subcommands | local-write (`verify.ts:1252` writes a verification artifact) |
| `semantic` | SQL `supported`, others `limited` | `src/commands/semantic.ts:104` gates `collectDraftValidationContext`, whose only caller is `semantic draft validate` (`semantic.ts:311`); every other subcommand goes through `collectSemanticInputs` (`:54`), which has no engine branch | no | no — JSON is on the subcommands | readonly |
| `design` | SQL `supported`, others `limited` | `src/commands/design.ts:236` gates only `compareAgainstCache`, reached solely via `--against-cache` (`design.ts:147,211`); the `:83-84` check is on `--dialect`, the SQL flavour being authored, not on the connection | no | no — JSON is on the subcommands | local-write (`design.ts:89` `design init` writes a template) |
| `proxy` | mysql, mariadb, postgresql | `src/commands/proxy.ts:15,62` `SUPPORTED` proxy engines | yes — `ProxyServer` (`proxy.ts:7`) fronts the upstream engine | yes | interactive |
| `proxy analyze` | all | `src/commands/proxy.ts:9-13` reads local event files only | no | yes | readonly |
| `verification` | all | `src/commands/verification.ts` has no engine reference and constructs no adapter | no | no — JSON is on the subcommands | readonly |
| `verification prune` | all | `src/commands/verification.ts:330,382` deletes local artifacts | no | yes | local-write |
| `evidence` | all | `src/commands/evidence.ts` has no engine reference and constructs no adapter | no | no — JSON is on the subcommands | local-write (`evidence.ts:446,466` `compose --output`) |
| `contract` | all | `src/commands/contracts.ts` has no engine reference and constructs no adapter | no | no — JSON is on the subcommands | readonly |
| `recovery` | all | `src/commands/recovery.ts` renders recovery codes from `@/core/recovery`; no engine reference, no adapter | no | yes | readonly |
| `backfill artifact` | all | `src/commands/backfill.ts` reads v2 connection identity metadata only; no adapter | no | no | local-write |
| `password` | every engine | `src/commands/credential.ts:9,82-83` builds an adapter from whatever the config names, with no engine gate | yes | yes | interactive |

### Three rows the first pass got wrong, and what caught them

`impact assess`, `semantic` and `design` were first written `unsupported` off
SQL. All three were found by grepping each command module for an engine check
and reading the check — which is true as far as it goes, and stops one step too
early. Reading the *callers* showed each check guards a mode, not the command:
`--against-cache` for `impact assess`, `design diff` and `design propose`, and
`draft validate` for `semantic`. The `--against-orm` paths, `design init`,
`design render` and the rest of `semantic` never look at the connection.

They are `limited` off SQL, with the lost mode named in the matrix note.
`unsupported` would have told an agent on MongoDB that a command it can in fact
run is closed to it — fail-closed, so it would never have looked wrong, and it
would have made the contract quietly less useful than the tool.

Four subagents were dispatched at the start of this Story to audit these
commands and returned nothing usable in time, so the matrix was built by hand.
Their reports arrived after the first commit, and two of them carried exactly
this correction. The lesson is not about delegation: it is that "grep for the
engine check" is a weaker method than it feels like, and the thing that closed
the gap was a second reader, not a better grep.

### What the audit could not settle, and what was done about it

* **`plan` on a non-SQL engine, and why it is not `limited` like the three
  above.** It does not refuse either, and it does not even degrade quietly into
  doing nothing. `plan`'s only connection guard checks that a connection is
  *configured*, not what it is (`plan.ts:33-35`). `toSqlDialect` returns
  `undefined` off SQL (`permission-guard.ts:150`), and an undefined dialect does
  not narrow the analysis — it *widens* it, because `findWriteKeyword` falls
  back to every SQL dialect when given none (`permission-guard.ts:179`). So on a
  Redis connection the command SQL-parses whatever you passed it, prints a
  verdict, and exits `0`.

  That is worse than an error, because it looks authoritative, and it is why
  `plan` is `unsupported` where the other three are `limited`. The distinction
  is not "refuses" versus "does not refuse" — none of the four refuses. It is
  what survives: `design` off SQL still has `--against-orm`, `semantic` still
  has context, search and drift, and a caller can use those. `plan` has one mode
  and one input, a SQL string, and every factor it can report comes from SQL
  keyword analysis. `limited` would promise a mode that does not exist.

  Recorded at this length because the asymmetry is the kind a later reader
  "fixes" for consistency. The code fact is "runs without refusing"; that it
  produces a meaningless verdict is a judgement, and it is stated as one. No
  test covers `plan` on a non-SQL connection.
* **`verify` on MySQL and MariaDB.** The code permits all three SQL engines
  (`verify.ts:75-83`), and all four `verify` integration suites pin
  `system: 'postgresql'`. So the claim is "the command does not refuse this
  engine", which is what the matrix means — not "this has been exercised
  there". The same holds for `password` below.
* **`password` per engine.** No gate exists, so every engine is claimed; what is
  not established is that a credential rotation has been exercised against each
  of the six. The claim is "the command does not refuse this engine", which is
  what the matrix means, and no stronger.
* **Subcommand granularity.** Where a top-level command's subcommands differ
  only in output format, one capability names the top-level path and
  `supportsJson` follows that path — the precedent `blacklist`, `migrate` and
  `queries` already set. `proxy analyze` and `verification prune` get their own
  keys because they differ in engine coupling and in side-effect tier, which the
  precedent `audit tail` / `audit clear` already covers.



## Classification

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* `src/adapters/capabilities.ts`: `CommandCapabilityKey`,
  `COMMAND_CAPABILITY_KEYS` and every engine's entry extended to cover the
  sixteen commands, each claim backed by a cited `file:line` or a test.
* `src/core/capabilities/registry.ts`: capability declarations for the new keys,
  with `requiresConnection`, `mutatesConfiguration`, `supportsJson` and
  `supportsEvidence` matching real behaviour.
* `COMMAND_SURFACE.evidenceCommands`, currently empty, populated from what the
  commands actually write.
* An ADR recording the `capability.discover` / `capability.check` decision.
* Contract tests extended so the new entries are held to the same bidirectional
  parity as the existing ones.
* Documentation: the reference's "Scope of v1" paragraph, which enumerates the
  absent commands and becomes false the moment this lands, plus its five
  mirrors and both user-doc locales in both formats.

### Out of Scope

* Changing what any of the sixteen commands *does*. This Story describes
  behaviour; it does not adjust it. A command whose engine support is narrower
  than a reader would like is recorded as narrow, not widened.
* A second engine support table, a second permission ladder, or a second risk
  vocabulary.
* Adding a status value beyond the four the matrix already has.
* An Operation Envelope, correlation id, or evidence expansion
  (DBCLI-PLAT-004/006/007).
* Task Pack `safety.requires` validation (DBCLI-PLAT-008).
* Subcommand-level capability ids for commands whose subcommands differ, beyond
  what the existing `audit tail` / `audit show` pattern already establishes.

## Inputs

* `src/commands/*.ts` — the implementations, read for what they actually do.
* The live Commander tree, for command paths and `--format` values.
* `tests/` — existing tests that demonstrate per-engine behaviour.

## Outputs

* A capability catalog covering every public command, or explicitly recording
  why one is absent.
* An ADR on capability self-description.

## Rules

* R1: Every `supported` or `limited` claim cites code or a test. An engine the
  audit could not settle is `unsupported`, and the uncertainty is written down.
* R2: Engine and risk values stay derived from `ENGINE_CAPABILITIES`; the
  registry hard-codes no engine list.
* R3: Catalog and Commander tree agree in both directions — every catalogued
  path exists, and no `supportsJson` claim exceeds what the path offers.
* R4: `requiresConnection: false` is proven against the command's import graph,
  as it already is for the existing entries.
* R5: `mutatesConfiguration` is claimed only where the command's import graph
  reaches a configuration writer.
* R6: `supportsEvidence` is claimed only where the command writes an evidence
  artifact.
* R7: No status value outside `supported` / `limited` / `unsupported` /
  `not-applicable` is introduced.
* R8: `CAPABILITY_CONTRACT_SCHEMA_VERSION` moves if and only if the catalog's
  *shape* changes. Adding entries is not a shape change.

## Expected Errors

* An unknown capability id still reports `unknown` with reason
  `unknown-capability`. The set of ids that produce it shrinks; the behaviour
  does not change.

## Dependencies

* `src/adapters/capabilities.ts` — the one engine support table.
* `src/core/capabilities/registry.ts` — the catalog derived from it.
* `docs/adr/0022-the-capability-catalog-is-derived-from-the-engine-matrix.md`.

## Constraints

* No weakening of permission, blacklist, write gate, audit, redaction or
  deny-by-default behaviour.
* No CRUD, CQRS or DBA job knowledge in dbcli core: a capability names an atomic
  ability, never a job or a method.
* The audit's uncertainty is disclosed, not smoothed over. A matrix that reads
  cleanly because the unclear cases were guessed is worse than one with recorded
  gaps.

## Superseded Behavior

* `assets/reference.md`, "Scope of v1: the catalog covers the commands the
  engine capability matrix governs… `explain`, `plan`, `impact`, `assert`,
  `verify`, `evidence`, `contract`, `semantic`, `design`, `snapshot`,
  `backfill`, `proxy` — are absent" — that list becomes wrong on delivery and is
  replaced by what is true then. Its five synced mirrors follow.
* `docs/plans/2026-09-04-agent-integration-contract-v1.md`, "Not done,
  deliberately": "`ENGINE_CAPABILITIES` was not extended, so sixteen commands
  are absent from the catalog and return `unknown`" — annotated as closed by
  this Story, not deleted; it was true of that slice.
* `specs/handoff.md`, the PLAT-001 section's "已知邊界" paragraph — same
  treatment.
* `tests/unit/core/capabilities/registry.test.ts`, "mutatesConfiguration marks
  the capabilities agent mode refuses" — the roster gains
  `connection.rotate-credential`. `dbcli password` is the most literal member of
  that set and was simply not catalogued before.
* `tests/unit/core/capabilities/registry.test.ts` and
  `tests/integration/capabilities-command.test.ts`, the credential-leakage
  checks — both matched the bare word `password`, which is now a command path.
  The unit check exempts the `command` field only, and the integration check
  matches `"password":` as a JSON key. Neither is loosened for any other field.
* `tests/contract/capability-contract.test.ts`, "no v1 capability claims
  evidence support" and "no catalogued command reaches the evidence receipt
  subsystem" — both encoded the v1 boundary. Replaced by the parity they stood
  in for: the declared evidence surface equals what the command layer's writer
  calls reach, in both directions.
* `tests/contract/capability-contract.test.ts`, `commandWritesConfig` — it
  resolved `commands/<name>.ts` and **skipped on a miss**, so `password`
  (`credential.ts`) and `contract` (`contracts.ts`) were never checked and
  "writes no configuration" came back true for the credential command. The
  mapping now comes from `program-lazy.ts`, and a miss is a failure.
* `src/commands/diff.ts` — `loadOrmSchema` and its helpers move to
  `src/core/orm-drift/input.ts`, re-exported unchanged. No behaviour changes;
  the point is that `impact assess` and `design` stop pulling `diff`'s adapter
  imports into their static graph, so their offline claim is provable rather
  than exempted.
* `docs/plans/2026-09-04-agent-integration-contract-v1.md` and
  `specs/handoff.md` — the "sixteen commands are absent" boundary is marked
  closed, not deleted.
