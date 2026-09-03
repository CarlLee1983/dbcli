# Acceptance Criteria

## Happy Path

* [ ] With no `--context-version`, existing JSON, XML, and Markdown context output
  remains byte-compatible; `--context-version 2` emits the required version 2
  contract and preserves the existing configuration `version` value separately.
* [ ] A SQL fixture emits visible tables, safe column fields and visible
  relationships, with stable resource IDs and no defaults, counts, index names,
  comments, or relationships to filtered endpoints.
* [ ] An Elasticsearch fixture emits visible indices and the existing flattened
  field-path/type projection, with no raw mapping, `_meta`, settings, scripts,
  analyzers, documents, or counts.
* [ ] A Redis fixture emits only valid declared key families and allowed declared
  fields, with no discovered or concrete keys, live types, or values.
* [ ] A data-access operation emits its name, kind, canonical references, and
  `coverage: declared`, but no source path or source contents.

## Business Rules

* [ ] Version 2 context collection for every supported engine completes without
  constructing an adapter, opening a network connection, scanning keys, reading
  documents, or using credentials for network access.
* [ ] Capability output is a sorted `command`, `status`, and `sideEffectTier`
  projection of the existing registry for exactly `schema`, `query`, `q`,
  `queries`, `export`, and `shell`; it does not grant executable authority.
* [ ] Blacklisted identifiers may appear only in the existing `blacklist` policy
  field. Every other repository-authored string is checked for blocked terms, and
  seeded protected resources do not appear in any other version 2 section.
* [ ] Credentials, seeded database values, Redis keys and values, query results,
  column defaults, counts, raw ES metadata, query bodies and defaults, source
  paths, and seeded source contents are absent from version 2 JSON, XML, and
  Markdown.
* [ ] A Redis declaration that is concrete, malformed, or not provably disjoint
  from blacklist or `redis.mask` rules fails without emitting the family.
* [ ] A valid Redis family and an unrelated blacklist or mask glob with no common
  matching key coexist successfully, proving protection rules do not reject all
  declarations indiscriminately.
* [ ] SQL, Elasticsearch, and Redis resource and field IDs exactly follow the
  specified kind, percent-encoding, and Redis-family-name rules; SQL relationship
  endpoints and semantic links use those IDs consistently.
* [ ] Repeating JSON version 2 generation with identical inputs produces
  identical bytes, stable resource IDs, and stable code-point ordering.
* [ ] JSON, XML, and Markdown expose equivalent version, engine, permission,
  policy, capability, resource, semantic, contract, snippet, declared-coverage,
  truncation, and gap information.
* [ ] Version 2 enforces the specified numeric limits; deterministic truncation
  records emitted and omitted visible-item counts and emits `CONTEXT_TRUNCATED`.

## Failure Cases

* [ ] Missing optional evidence emits the exact applicable gap code; missing or
  fully filtered evidence never appears as a complete empty schema.
* [ ] Present invalid schema, semantic, saved-query, data-access, Redis-context,
  or resource-reference input fails with the exact applicable `INVALID_*` code
  and bounded evidence that excludes raw payloads and protected identifiers.
* [ ] MongoDB rejects explicit version 2 with `UNSUPPORTED_CONTEXT_ENGINE`, while
  its existing no-flag version 1 context remains unchanged.

## Regression Requirements

* [ ] Existing version 1 `skill context` fixtures and snapshots remain unchanged.
* [ ] Existing semantic-context, contract, saved-query, data-access, blacklist,
  Redis-mask, capability-registry, and determinism tests remain green.
* [ ] Existing SQL, MongoDB, Elasticsearch, and Redis query and permission
  behavior remains unchanged.
* [ ] English and Traditional Chinese `index.md` and `index.html` documentation
  define version selection, the external-agent workflow, the safe-field policy,
  engine differences, declaration limits, error and gap codes, and migration.
* [ ] Installed English and Traditional Chinese dbcli Skill artifacts request
  context version 2, tell the agent not to guess missing metadata, and keep source
  discovery and reading under the agent's own workspace safety checks.
* [ ] `make verify` passes.

## Verification Notes

Use filesystem-only fixtures and adapter-construction tripwires. Seed canary
credentials, database values, Redis keys, protected identifiers, raw ES metadata,
query bodies, parameter defaults, source paths, and source contents, then assert
the version 2 allowlist and version 1 compatibility in every serializer. No
database service should be required for focused Story tests; if `make verify`
requires unavailable repository services, report the blocker and do not claim
complete PASS.

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| SQL column `comment` on a non-blacklisted table | `CANARY_VALUE` | omit | `payload.resources` SQL column projection | `tests/unit/core/context/context-v2.test.ts::projects bounded SQL context and excludes protected or value-bearing fields` |
| SQL index `name` metadata | `CANARY_INDEX` | omit | `payload.resources` SQL table projection | `tests/unit/core/context/context-v2.test.ts::projects bounded SQL context and excludes protected or value-bearing fields` |
| SQL foreign-key `name` metadata | `CANARY_FK_NAME` | omit | `payload.resources` SQL relationship projection | `tests/unit/core/context/context-v2.test.ts::projects bounded SQL context and excludes protected or value-bearing fields` |
| Blacklisted table `secrets` and blacklisted column `users.password` | `secrets` table and `password` column declared in `blacklist` | reject | `payload.resources`, `payload.semantic`, `payload.contracts`, `payload.snippets`, `payload.dataAccess` | `tests/unit/core/context/context-v2.test.ts::projects bounded SQL context and excludes protected or value-bearing fields` |
| `.dbcli/queries/*.sql` saved-query body text | `SELECT 'CANARY_QUERY_BODY' FROM users WHERE id >= :min_id` | omit | `payload.snippets` | `tests/unit/core/context/context-v2.test.ts::projects bounded SQL context and excludes protected or value-bearing fields` |
| Redis key-family `description` and `aliases` on a valid declaration | `Current session metadata.` and `sessions` | preserve | `payload.resources` Redis `keyFamilies[].description` and `keyFamilies[].aliases` | `tests/unit/core/context/context-v2.test.ts::loads only valid Redis declarations and allows provably unrelated protection globs` |
| Redis key-family `pattern` overlapping a `blacklist.tables` glob | `session:{scope}:{id}` against `session:admin:*` | reject | `INVALID_REDIS_CONTEXT` thrown error, no `keyFamilies` entry emitted | `tests/unit/core/context/context-v2.test.ts::rejects Redis declarations that overlap protection or contain invalid patterns` |
| Redis key-family `pattern` with an escaped placeholder brace | `session:\{id}` | reject | `ContextV2Error` thrown, no `keyFamilies` entry emitted | `tests/unit/core/context/context-v2.test.ts::rejects Redis declarations that overlap protection or contain invalid patterns` |
| Saved-query `description` naming a blacklisted table by exact name | `References audit_logs` against `blacklist.tables: ['audit*']` | reject | `INVALID_SAVED_QUERY` thrown error | `tests/unit/core/context/context-v2.test.ts::rejects wildcard-protected identifiers in every non-policy metadata string` |
| Saved-query `description` naming a blacklisted table with a space-glob match | `References audit logs today` against `blacklist.tables: ['audit *']` | reject | `INVALID_SAVED_QUERY` thrown error | `tests/unit/core/context/context-v2.test.ts::rejects wildcard-protected identifiers in every non-policy metadata string` |
| Configuration `metadata.version` string colliding with a blacklist glob | `audit_logs` against `blacklist.tables: ['audit*']` | reject | `INVALID_SCHEMA_CACHE` thrown error | `tests/unit/core/context/context-v2.test.ts::rejects wildcard-protected identifiers in every non-policy metadata string` |
| `payload.resources` and `payload.truncation` limits under `gatherContextV2` | `501` seeded SQL tables of `11` columns each | omit | `payload.truncation.resources` and `payload.truncation.fields` and `payload.gaps` containing `CONTEXT_TRUNCATED` | `tests/unit/core/context/context-v2.test.ts::sorts before applying resource and field limits and reports exact omissions` |
| `globsOverlap()` Redis glob-language intersection | `session:*:*` against `session:admin:*` | reject | `globsOverlap()` boolean result | `tests/unit/utils/glob-overlap.test.ts::decides Redis glob-language intersection instead of sampling one expansion` |
| CLI `--context-version` value outside the supported contract | `--context-version 3` | reject | CLI stderr `UNSUPPORTED_CONTEXT_VERSION` | `tests/unit/commands/skill-context.test.ts::rejects context versions other than 2` |
| Configuration `system` requesting version 2 for an unsupported engine | `mongodb` | reject | `UNSUPPORTED_CONTEXT_ENGINE` thrown error | `tests/unit/core/context/context-v2.test.ts::rejects unsupported engines and invalid cache shapes with bounded stable codes` |
| CLI `skill context --format json` blacklist enforcement | seeded blacklisted table `audit_logs` and column `users.password` | reject | `parsed.schema.audit_logs` and `parsed.blacklist.tables` in `skill context` CLI stdout JSON payload | `tests/unit/commands/skill-context.test.ts::blacklisted table/column never leak into the payload` |
