# Acceptance Criteria

## Happy Path

* [x] Under `DBCLI_AGENT_MODE=1`, `dbcli schema` completes against a v1 config
      and the table appears in `config.json`'s `schema` —
      `tests/integration/schema-cache-agent-mode.test.ts`
* [x] Under `DBCLI_AGENT_MODE=1`, `dbcli schema` completes against a v2 config
      and the table appears in `schemas[<connection>]` — same file
* [x] Outside agent mode, a cache write leaves `connection`, `permission`,
      `blacklist` and `audit` deep-equal to what was on disk, and leaves
      `.env.local` byte-identical — `tests/unit/core/schema-cache-persistence.test.ts`
* [x] `metadata.schemaLastUpdated` and `metadata.schemaTableCount` are updated
      by the seam — `tests/unit/core/schema-cache-persistence.test.ts`

## Business Rules

* [x] The seam's signature admits only a schema, a connection name and the two
      cache timestamps — no config document, connection, permission or
      credential — `tests/unit/core/schema-cache-persistence.test.ts`
* [x] Applied to a config on disk, the seam changes exactly the cache fields:
      every other byte of the parsed document is deep-equal before and after —
      same file
* [x] `assertOnlyCacheFieldsChanged` refuses a candidate that differs outside
      the cache projection, naming the offending top-level field and nothing
      else — same file
* [x] The seam writes an integrity record, and the written config passes
      `assertConfigIntegrity` — same file
* [x] `.env.local` is byte-identical before and after a v1 cache write, and is
      not opened for writing — same file
* [x] `assertConfigMutationApproved()` is unchanged, and the set of modules
      calling it is unchanged except that `src/commands/schema.ts`'s cache path
      no longer reaches it —
      `tests/contract/config-mutation-boundary.test.ts`
* [x] `schema.read` is `available` under agent mode *and* the command it names
      succeeds there — `tests/contract/config-mutation-boundary.test.ts`

## Failure Cases

* [x] Under `DBCLI_AGENT_MODE=1`, `dbcli init`, `dbcli use <name>`,
      `dbcli blacklist add`, and the credential commands are still refused with
      the unchanged guard message —
      `tests/contract/config-mutation-boundary.test.ts`
* [x] A v2 config whose named connection slot is absent is refused, naming the
      connection and not the storage path —
      `tests/unit/core/schema-cache-persistence.test.ts`
* [x] A tampered `config.json` is refused before the seam writes anything —
      same file
* [x] A cache write that fails states the schema was read successfully and
      names the cache write as the failing step; the message is not a database
      or connection error — `tests/integration/schema-cache-agent-mode.test.ts`
* [x] A cache-write failure leaves the on-disk config unchanged rather than
      half-written — `tests/unit/core/schema-cache-persistence.test.ts`

## Regression Requirements

* [x] No output from the seam or its failure path contains a password, host,
      port, connection string, env-var value or absolute path —
      `tests/unit/core/schema-cache-persistence.test.ts`,
      `tests/integration/schema-cache-agent-mode.test.ts`
* [x] The PLAT-001 known deviation is gone from `acceptance.md`, the design
      record, `assets/reference.md` with its five mirrors, and both user-doc
      locales in both formats — `tests/docs/schema-cache-deviation-closed.test.ts`
* [x] `agent-core` purity, core no-stdout, CLI contract, skill parity, platform
      parity, plugin sync, docs, plan and forgeflow gates all still pass —
      `make verify`
* [x] `make verify` passes in full

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `schema` | `{"plat012_demo":{"name":"plat012_demo","columns":[{"name":"id","type":"integer"}]}}` | preserve | `config.json` `schema.plat012_demo` | `tests/unit/core/schema-cache-persistence.test.ts` |
| `connectionName` | `"no-such-connection"` | reject | `config.json` unchanged | `tests/unit/core/schema-cache-persistence.test.ts` |
| `candidate.connection.password` | `"attacker-supplied"` | reject | `config.json` unchanged | `tests/unit/core/schema-cache-persistence.test.ts` |
| `candidate.permission` | `"admin"` | reject | `config.json` unchanged | `tests/unit/core/schema-cache-persistence.test.ts` |
| `candidate.blacklist.tables` | `[]` | reject | `config.json` unchanged | `tests/unit/core/schema-cache-persistence.test.ts` |
| `candidate.metadata.version` | `"2.0"` | reject | `config.json` unchanged | `tests/unit/core/schema-cache-persistence.test.ts` |
| `schema` table name | `"users; DROP TABLE x"` | preserve | `config.json` `schema` key | `tests/unit/core/schema-cache-persistence.test.ts` |
| `.env.local` on disk | `DB_PASSWORD=untouched` | preserve | `.env.local` | `tests/unit/core/schema-cache-persistence.test.ts` |
| `connection.password` on disk | `"testpass"` | preserve | `config.json` `connection.password` | `tests/unit/core/schema-cache-persistence.test.ts` |
| cache-write failure message | `"EACCES: permission denied, open '/Users/someone/.config/dbcli/config.json'"` | redact | stderr, audit entry | `tests/integration/schema-cache-agent-mode.test.ts` |

`preserve` on the `schema` table-name row is deliberate: a table name is data read
back from the database the config already points at, and rewriting it would make
the cache disagree with the server. The injection surface it would matter for is
SQL construction, which the cache is not.

## Verification Notes

The agent-mode integration tests need the `docker-compose.test.yml` PostgreSQL
service; `bun run services:check` refuses to run `make verify` without it.

Two `preserve` rows record behaviour this Story **changes**, and they are the
reason the criterion above is not "byte-identical to what the old path wrote".
Measured on `c3e701a1` against a v1 fixture holding
`connection.password: "testpass"` and an `.env.local` reading
`DB_PASSWORD=untouched`, a schema cache write through `configModule.write`
deleted `connection.password` from `config.json` and overwrote `.env.local`
with a freshly generated `DBCLI_PASSWORD=testpass`, destroying the existing
file. A cache update moving a credential between files is the conflation this
Story exists to end, so the fixtures assert the new behaviour and
`story.md`'s Superseded Behavior names the old one.
