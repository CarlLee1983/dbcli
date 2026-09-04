# Story: DBCLI-PLAT-012 Schema Cache Write Boundary

## Goal

Under `DBCLI_AGENT_MODE=1`, an agent that asks `dbcli capabilities check
--require schema.read` and is told `available` can then run `dbcli schema` and
have it finish — while agent mode keeps refusing every change to connection
identity, permission and credentials, exactly as it does today.

## Context

DBCLI-PLAT-001 shipped one known overstatement and named this Story as the fix.
`schema.read` reports `available` under agent mode, and `dbcli schema` fails
there. Reproduced on `c3e701a1` against the repository's own PostgreSQL test
service:

```
$ DBCLI_AGENT_MODE=1 dbcli capabilities check --require schema.read --format json
  "results": [ { "id": "schema.read", "status": "available", "reason": null } ]

$ DBCLI_AGENT_MODE=1 dbcli schema
🔍 Scanning database schema...
📍 Found 1 table(s). Fetching schema details...
   Processed 1/1 table(s)
✅ Schema persisted to layered storage (.dbcli/schemas/)
Agent mode blocks configuration, permission, and credential changes. …
  exit 1
```

Three separate problems are visible in that transcript.

**The capability claim is false.** It is the only promise in the contract an
agent would act on and find broken, which is the failure PLAT-001 exists to
prevent — it shipped with it recorded rather than fixed because marking
`schema.read` unavailable would tell an agent schema cannot be read at all, a
larger error in the other direction.

**The guard is being asked the wrong question.** `assertConfigMutationApproved()`
protects connection identity, permission and credentials: things an untrusted
automation context must not change, where an environment variable supplied by
that same process is not an approval. A schema cache is none of those. It is
derived data, re-derivable at any time by reading the database the config
already points at, and an agent that can read the schema can already see
everything the cache would hold. The guard sits where it does only because the
cache happens to live inside `config.json`, next to the credentials — storage
adjacency, not a shared trust decision.

The write actually goes through `configModule.write` (v1) or `writeV2Config`
(v2), and the v1 path does more than store a cache. Measured on `c3e701a1`
against a config holding `connection.password: "testpass"` and an `.env.local`
reading `DB_PASSWORD=untouched`, a schema cache write **deleted
`connection.password` from `config.json` and overwrote `.env.local`** with a
freshly generated `DBCLI_PASSWORD=testpass`, destroying the file that was
there. Updating a derived cache moves a credential between files today. That is
the conflation, and it is worse than "the guard is in the wrong place": outside
agent mode, where no guard fires at all, the credential move happens silently on
every `dbcli schema`.

**The failure is reported as the wrong thing, twice.** The message names
"configuration, permission, and credential changes" for what was a cache write,
and nothing in the output says the schema was read successfully — an agent
reading only the exit code concludes the database read failed. It also leaves
the two caches disagreeing: the layered store under `.dbcli/schemas/` was
written before the refusal, so it holds the new schema while `config.json` still
holds the old one, silently.

The fix is not to widen the guard's exemptions. A boolean "this write is fine"
argument would be a flag any future caller can pass, and the guard would then be
protecting whatever callers remembered to be honest about. The fix is a seam
narrow enough that it cannot express a credential change: a function whose
parameters are a schema and two cache timestamps, which reads the config from
disk itself and writes back a document differing only in the cache fields.

## Classification

* Security sensitive: yes
* Baseline conformance: yes

## Scope

### In Scope

* `src/core/schema-cache-persistence.ts`: one named seam that persists a schema
  cache and nothing else, for both v1 and v2 configs.
* `src/commands/schema.ts`: the three `writeSchema` call sites move onto it.
* Reporting: a cache-write failure names the cache write, states that the schema
  was read, and does not read as a database failure.
* Removing the PLAT-001 known deviation from `acceptance.md`, the design record,
  `assets/reference.md` and both user-doc locales in both formats.
* A contract test tying the capability verdict to the command's real behaviour
  under agent mode.

### Out of Scope

* Any change to `assertConfigMutationApproved()`, or to which of
  `configModule.write`, `writeV2Config`, `writeBindingWithIntegrity` and the
  credential writers it guards.
* `SchemaUpdater.refreshSchema` (`src/core/schema-updater.ts`). It is exported
  from `@carllee1983/dbcli/core` but no command reaches it, so no CLI behaviour
  and no capability claim depends on it; and it writes `metadata.version =
  '2.0'` alongside the cache, which is outside the cache projection and is its
  own question. Recorded rather than swept in.
* The layered store's own write path. It is already outside the guard and stays
  there.
* Making `dbcli schema` succeed at anything it fails at today for a reason other
  than the cache write.
* Every later platform capability.

## Inputs

* The on-disk config at the resolved storage path — read by the seam itself,
  never supplied by the caller.
* `schema`: the table map just read from the database.
* `connectionName`: the v2 connection slot, or `undefined` for v1.
* `schemaLastUpdated`, `schemaTableCount`.
* `DBCLI_AGENT_MODE`.

## Outputs

* An updated `config.json` plus its integrity record.
* On failure, a bounded message naming the cache write as the failing step.

## Rules

* R1: The seam takes a schema and cache metadata. It accepts no connection,
  permission, credential or arbitrary config document, so it cannot express a
  change to any of them.
* R2: Before writing, the seam compares the candidate document against the one
  on disk with the cache fields projected out, and refuses if anything else
  differs. Structural narrowness is the guarantee; this is the check that says
  so out loud.
* R3: The cache fields are exactly `schema` (v1), `schemas[<connection>]` (v2),
  `metadata.schemaLastUpdated` and `metadata.schemaTableCount`. Nothing else.
* R4: The seam never writes `.env.local` and never moves a credential between
  files.
* R5: `assertConfigMutationApproved()` is unchanged, and every writer that
  guards it today still guards it.
* R6: Under agent mode, `dbcli schema` persists its cache; `dbcli init`,
  `dbcli use`, `dbcli blacklist add/remove` and every credential command are
  still refused.
* R7: A cache-write failure states that the schema was read successfully and
  names the cache write as what failed. It never presents itself as a database
  or connection error.
* R8: Integrity records are written for every seam write, and a tampered config
  is still refused before the seam reads it.
* R9: No output from the seam or its failure path contains a password, host,
  port, connection string, env-var value or absolute filesystem path.
* R10: `schema.read` / `schema.read-object` / `schema.scan` reporting
  `available` under agent mode is now true, and a test asserts the command
  agrees rather than the docs asserting it.

## Expected Errors

* A config that is absent, unreadable, or fails its integrity check: refused
  before any write, with the existing error, unchanged.
* A v2 config whose named connection slot does not exist: refused, naming the
  connection, not the storage path.
* A candidate document differing outside the cache projection: refused as an
  internal invariant violation, naming the offending top-level field only.

## Dependencies

* `src/core/config-mutation-guard.ts` — the guard this Story deliberately does
  not touch.
* `src/core/config-integrity.ts` — `writeConfigWithIntegrity`,
  `assertConfigIntegrity`.
* `src/core/config-v2.ts` — `patchConnectionSchema`, `readV2Config`.
* `src/core/capabilities/` — the contract whose claim this makes true.

## Constraints

* No second config writer: the seam composes the existing integrity writer
  rather than reimplementing atomic write or hashing.
* No weakening of permission, blacklist, write gate, audit, redaction or
  deny-by-default behaviour.
* No new environment variable, flag or config key that relaxes a boundary.

## Trust Boundary Fields

* `schema` — table and column names read from the database, written into the
  cache.
* `connectionName` — from the v2 config's resolved connection, echoed in
  refusals.
* `schemaLastUpdated`, `schemaTableCount` — derived locally from the read.
* `DBCLI_AGENT_MODE` — process environment, read by the guard only.
* The cache-write failure message — derived from a caught error, which may
  carry a filesystem path from the runtime.

## Superseded Behavior

* `specs/stories/DBCLI-PLAT-001-capability-contract/acceptance.md`, "Known
  deviation" — marked closed, not deleted. It was a true statement about what
  was accepted at delivery, and removing it would rewrite that.
* `docs/specs/2026-09-04-agent-integration-contract-v1.md`, "The known
  overstatement", and `docs/adr/0022-…`, "The one place the contract knowingly
  overstates availability" — both keep their reasoning and gain a closing note.
  Design records are appended to, not rewritten (ADR-0001).
* `docs/plans/2026-09-04-agent-integration-contract-v1.md`, criterion 16 — its
  `— known deviation:` annotation becomes `— covered by:` naming the test that
  now proves the claim.
* `tests/contract/capability-contract.test.ts`, `INCIDENTAL_CONFIG_WRITERS` —
  `schema` was its only entry and the exemption's cause is gone; the set becomes
  empty and the comment records why.
* `tests/unit/commands/schema-refresh-bootstrap.test.ts` — its fixture had no
  configuration on disk, relying on the cache write to publish one. The seam
  refuses to create a configuration, so the fixture gains the config it always
  implied. What the tests assert — whether `--force` is required — is unchanged.
* `assets/reference.md`, "One known overstatement: `dbcli schema` persists its
  result into `config.json`…" — removed, along with its five synced mirrors.
  User-facing reference states what is true now; the history lives in the design
  records. (Neither user-doc locale carried the sentence.)
* `src/commands/schema.ts`'s v1 cache path, via `configModule.write` — a cache
  update no longer normalises the config document, no longer removes
  `connection.password` from `config.json`, and no longer writes `.env.local`.
  Any test asserting the password move as the expected outcome of a *schema*
  write changes; tests asserting it for `init` or a credential command do not.
* `tests/integration/capabilities-command.test.ts` and
  `tests/unit/core/capabilities/check.test.ts` — any assertion that documents
  the deviation changes to assert the command now succeeds. An assertion that
  merely checks `schema.read` is `available` under agent mode is unchanged; it
  was always the right answer, for a reason that is now true.
