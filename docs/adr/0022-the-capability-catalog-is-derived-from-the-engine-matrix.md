---
status: accepted
date: 2026-09-03
---

# The capability catalog is derived from the engine matrix, not declared beside it

An external Skill — a CRUD Skill, a CQRS Skill, a DBA Operator Skill — needs to
ask dbcli what it can do *before* it starts working, and get an answer it can
parse. Today it cannot: the only machine-readable description of dbcli's
abilities is `--help`, which is prose, and `dbcli status`, which describes one
connection rather than the tool.

The obvious shape for that answer is a versioned capability catalog. The
dangerous shape is a *second* hand-written table of what each command supports
per engine, sitting next to the one that already exists.

`src/adapters/capabilities.ts` already holds `ENGINE_CAPABILITIES`: six engines
× thirty-four command keys, each carrying `{status, tier, note}`. It is read by
`doctor`, by the engine-support documentation, and by its own tests. A parallel
catalog listing engines per capability would be the same claim written twice,
and the two copies would disagree the first time an engine gained support for
something — silently, because nothing would compare them.

## Decision

**`ENGINE_CAPABILITIES` is the authority for every engine and risk claim in the
capability catalog.** `src/core/capabilities/registry.ts` declares only what the
matrix does not know — the capability's id, its human description, its CLI
command path, and its minimum permission — and *derives* the rest:

| Catalog field | Derived from |
| --- | --- |
| `engines` | matrix entries whose status is `supported` or `limited` |
| `engineIndependent` | every engine's status is `not-applicable` |
| `risk` | the matrix `tier`, folded into the Task Pack risk vocabulary |
| `sideEffect` | the matrix `tier`, verbatim |
| `supportsJson` | the live Commander tree: the command has a JSON output option |
| `supportsEvidence` | the command's static import graph reaches `src/core/evidence-receipt` |

A capability therefore cannot claim engine support the matrix does not grant,
and cannot be added without a matrix key to derive from.

**v1 enumerates exactly the thirty-four capabilities the matrix backs.** dbcli
registers fifty top-level commands; sixteen of them — `explain`, `plan`,
`impact`, `assert`, `verify`, `verification`, `evidence`, `contract`,
`semantic`, `design`, `snapshot`, `backfill`, `proxy`, `recovery`, `password`,
`use`'s newer subcommands — have no matrix row. Writing rows for them here
would mean minting engine-support claims from a reading of the code rather than
from the prior audit the matrix represents, which is precisely the kind of
plausible-but-unchecked assertion a discovery contract must not carry. They are
absent from v1 and named as such in the spec; extending the matrix to cover
them is its own Story.

A contract test enforces the boundary in both directions: every
`COMMAND_CAPABILITY_KEYS` entry has at least one capability, and every
capability names a live Commander command path.

**`postgresql` is the engine vocabulary.** `DatabaseSystem` says `postgresql`;
the Task Pack `AgentTaskEngine` says `postgres`. The catalog uses
`DatabaseSystem` because that is the name the config file, the adapters and the
matrix all use. The Task Pack fork is left untouched — reconciling it is
DBCLI-PLAT-008 — and no third spelling is introduced.

**The contract lives in `src/core`, not `src/agent-core`.** This is forced, not
chosen: `scripts/check-agent-core-purity.ts` fails any file under
`src/agent-core/` containing the word `postgresql`, and a catalog that names
engines cannot satisfy that. It is exported through
`@carllee1983/dbcli/core` — which already carries `Permission` and
`DatabaseSystem` — and the purity gate is left exactly as strict as it was.

**`capabilities` and `capabilities check` never open a connection.** Discovery
answers from the static catalog; the check reads the local config through the
one existing config reader and evaluates engine and permission against it. A
contract test asserts the capability modules' import graph never reaches
`src/adapters`' connection factories, so this is a structural property rather
than a habit.

## What the catalog deliberately does not mean

- **`capabilities` is discovery, not a grant.** Listing `data.delete` says the
  binary can delete; it says nothing about whether this config, this engine, or
  this human permits it.
- **`available` is not approval.** `capabilities check` reports that the
  configured permission and engine would not refuse the operation. Blacklist,
  write gate, confirmation and audit all still run at execution time, and a
  human's consent is not modelled here at all.
- **`admin` is a config value, not a DBA sign-off.** The permission ladder
  describes what SQL the tool will pass through; it does not describe who agreed
  to it.
- **Unknown fails closed.** A requirement naming an id the catalog does not hold
  is `unknown`, never `available`, and never guessed at by spelling proximity. A
  typo that silently resolved to a neighbouring capability would be worse than a
  refusal.
- **Missing config is `unavailable`, not `unknown`.** With no config there is no
  engine and no permission to evaluate, so the capability is known but its
  availability is not established. Reporting that as `unknown` would blur a
  question about the *requirement* with a question about the *environment*.

## Consequences

- Adding a capability without a `COMMAND_CAPABILITY_KEYS` entry fails the
  contract test. Support for a new command is declared in the matrix first.
- Changing a matrix `tier` changes a published capability's `risk`. That is the
  intent — one edit, one truth — but it makes the matrix a contract surface, so
  a tier change is now a contract change.
- `CAPABILITY_CONTRACT_SCHEMA_VERSION` moves when the catalog's shape changes and
  never because the npm version moved, following ADR-0013.
- Catalog output is sorted by id and contains no host, port, connection string,
  credential or data row. A test asserts the serialized output against a
  credential-shaped fixture.

**Falsified if:** a capability in `src/core/capabilities/registry.ts` declares an
`engines` or `risk` value literally instead of deriving it from
`ENGINE_CAPABILITIES` in `src/adapters/capabilities.ts`, or a
`COMMAND_CAPABILITY_KEYS` entry gains no corresponding capability, or
`src/core/capabilities/` acquires an import of `@/adapters/index` or a database
adapter module, or `src/commands/capabilities.ts` reads config through anything
other than `src/core/config.ts`, or `postgres` appears as an engine name in
`src/core/capabilities/`.
