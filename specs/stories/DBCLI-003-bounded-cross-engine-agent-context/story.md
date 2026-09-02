# Story: DBCLI-003 Bounded Cross-Engine Agent Context

## Goal

Let an external AI agent answer natural-language data questions by combining its
own project-code inspection with a deterministic, permission-aware description
of the available SQL, Elasticsearch, or Redis data surface, without exposing
database values or asking dbcli to interpret natural language.

## Context

`dbcli skill context` already exposes connection, permission, visible cached SQL
schema, saved-query, and optional semantic metadata. Its unversioned output uses
`version` for dbcli configuration metadata and contains SQL metadata such as
column defaults and row counts that are unsuitable for a stricter agent-context
contract.

Elasticsearch and Redis can be queried, but their context does not yet describe
safe mapping or key-family evidence. Project code can provide missing business
meaning; the external agent reads that code directly. dbcli exposes validated
repository declarations and semantic references, but not project source paths or
contents.

## Scope

### In Scope

* Add an explicit `--context-version 2` projection to the existing
  `skill context` command for PostgreSQL, MySQL, MariaDB, Elasticsearch, and
  Redis.
* Keep the existing no-flag context output unchanged as version 1 compatibility;
  generated Agent Skill instructions use version 2.
* Emit versioned engine, configured permission, safe capabilities, visible
  resources, saved-query metadata, semantic metadata, approved contracts,
  declared data-access operations, truncation, and context gaps.
* Represent Elasticsearch only through flattened cached index fields and types.
* Represent Redis only through a bounded repository-owned
  `dbcli.redis-context.json` declaration.
* Keep JSON canonical for agents and provide semantically equivalent XML and
  Markdown projections.

### Out of Scope

* Natural-language interpretation or query generation inside dbcli.
* Reading, indexing, emitting, or transmitting project source contents or paths.
  Existing data-access manifest path metadata may still be parsed, resolved, and
  stat-validated without reading the referenced file.
* QueryDraft validation or execution for Elasticsearch or Redis.
* Database queries, key scans, document sampling, or schema inference while
  collecting context.
* A universal query language, pseudo-SQL for non-SQL engines, or cross-engine
  joins.
* Write operations, permission changes, database account or ACL management,
  provider SDKs, API keys, outbound LLM calls, or dependency upgrades.

## Public Contract

Version 1 remains the byte-compatible output produced when `--context-version`
is omitted. Version 2 adds a required integer `contextVersion: 2`; the existing
string `version` retains its configuration-metadata meaning.

Version 2 contains these required top-level fields:

* `contextVersion`, `version`, `system`, and `permission`.
* `blacklist` with the existing `tables` and `columns` policy shape.
* `capabilities`, a sorted projection of the existing engine capability registry
  for `schema`, `query`, `q`, `queries`, `export`, and `shell`. Each entry contains
  only `command`, `status`, and `sideEffectTier`.
* `resources`, one engine-discriminated object:
  * SQL: `kind: sql` and sorted `tables`; each table contains `id`, `name`, safe
    columns, and only foreign-key relationships whose endpoints remain visible.
    Columns contain `id`, `name`, `type`, `nullable`, and `primaryKey` only. Each
    relationship contains `columns` and `referencedColumns` as ordered field-ID
    arrays plus `referencedTableId`.
  * Elasticsearch: `kind: elasticsearch` and sorted `indices`; each index contains
    `id`, `name`, and flattened fields containing `id`, `path`, and `type` only.
  * Redis: `kind: redis` and sorted `keyFamilies`; each family contains `id`,
    `name`, `pattern`, `type`, optional bounded description and aliases, and
    declared fields containing `id`, `name`, `type`, optional description, and
    aliases.
* `snippets`, containing only `key`, optional bounded `description`, optional
  `intent`, engines, and parameters limited to `name`, `type`, and `required`.
  Query bodies and parameter defaults are excluded.
* `dataAccess`, containing only `name`, `kind`, `semanticReferences`, and the
  literal `coverage: declared`. `semanticReferences` retain the existing
  `model:<name>`, `field:<model>.<field>`, `relationship:<name>`, and
  `metric:<name>` forms. Source paths are excluded.
* Optional safe `semantic` and approved `contracts` projections. Semantic models,
  fields, relationships, and metrics retain their existing canonical semantic
  references and additionally link models to `tableId` and fields to `fieldId`.
  Contracts retain only name, bounded description, existing canonical semantic
  subjects, owner, aliases, and evidence policy.
* `gaps`, a sorted array of `{ code, scope }`, and `truncation`, containing emitted
  and omitted counts for resources, fields, snippets, and declarations.

SQL table IDs are `<system>/table/<UTF-8-percent-encoded-table-name>` and SQL
field IDs append `/field/<UTF-8-percent-encoded-column-name>`. Elasticsearch
index IDs are `elasticsearch/index/<UTF-8-percent-encoded-index-name>` and field
IDs append `/field/<UTF-8-percent-encoded-field-path>`. Redis family IDs are
`redis/key-family/<UTF-8-percent-encoded-family-name>` and field IDs append
`/field/<UTF-8-percent-encoded-field-name>`. Encoding uses JavaScript
`encodeURIComponent`. IDs are stable for identical inputs and never shared
between engines. Version 2 consumers must ignore unknown optional fields.
Removing a required field, changing its meaning, or changing ID encoding requires
a new `contextVersion`.

`dbcli.redis-context.json` version 1 contains at most 500 `keyFamilies`. Each has
a unique `name` matching `[a-z][a-z0-9-]{0,99}`, a `pattern` containing at least
one placeholder matching `\{[A-Za-z_][A-Za-z0-9_]{0,63}\}`, and a core Redis
`type` of `string`, `hash`, `list`, `set`, `zset`, or `stream`. Every brace pair
must be a valid placeholder, and placeholder names must be unique within the
pattern. Patterns are at most 200 characters and may not contain whitespace,
control characters, backslashes, or glob tokens `*`, `?`, `[` and `]`.

A family may have one description of at most 1,000 characters and at most 20
aliases of 100 characters each. `hash` and `stream` families may declare at most
100 fields; other types must not declare fields. A field name is 1–200 UTF-8
characters without control characters, its declared value type is `string`,
`number`, `boolean`, `json`, `timestamp`, or `binary`, and it may have one
1,000-character description and at most 20 aliases of 100 characters each. The
file is at most 512 KiB.

## Inputs

* Existing dbcli configuration and cached, blacklist-filtered SQL schema or
  Elasticsearch mapping metadata.
* Existing saved queries, semantic metadata, approved contracts, and data-access
  declarations.
* Optional repository-owned `dbcli.redis-context.json`.

## Outputs

* A version 2 deterministic, bounded agent-context payload from
  `dbcli skill context --context-version 2`.
* Stable context gaps for optional evidence that is unavailable or filtered.

## Rules

* R1: Version 2 collection remains offline and must not construct a database
  adapter, open a connection, scan keys, read documents, or use credentials for
  network access.
* R2: Blacklist policy names remain visible only in the existing `blacklist`
  policy field. Matching resources must not appear in resources, semantic,
  contracts, snippets, or data-access output.
* R3: Version 2 must not emit credentials, query results, column defaults, row or
  document counts, raw Elasticsearch mappings, `_meta`, settings, scripts,
  analyzers, Redis keys or values, saved-query bodies or parameter defaults,
  project source paths, or project source contents.
* R4: Except for values intentionally emitted in `blacklist`, every
  repository-authored output string is checked for unsafe text and blocked terms,
  including names, aliases, descriptions, intents, owners, parameters, patterns,
  and semantic, contract, snippet, data-access, resource, and field identifiers.
* R5: Redis placeholders are converted to `*` solely for comparison under the
  existing Redis glob semantics. A family is invalid when its resulting glob and
  a `blacklist.tables` or `redis.mask[].keyPattern` glob can match any common key;
  when an overlapping mask declares fields, the family remains invalid rather
  than exposing a partial field model. An unrelated protection glob with no
  possible common key does not block the family. Concrete key names are invalid
  because every family pattern requires a placeholder.
* R6: Capabilities come only from the existing engine capability registry and are
  descriptive; they never widen the configured permission.
* R7: Missing optional evidence emits one of
  `SQL_SCHEMA_UNAVAILABLE`, `ELASTICSEARCH_MAPPING_UNAVAILABLE`,
  `REDIS_KEY_FAMILIES_UNAVAILABLE`, `SEMANTIC_CONTEXT_UNAVAILABLE`,
  `SAVED_QUERIES_UNAVAILABLE`, `DATA_ACCESS_UNAVAILABLE`, or
  `ALL_RESOURCES_FILTERED`. Truncation additionally emits `CONTEXT_TRUNCATED`.
* R8: Present but invalid metadata fails the command with one of
  `INVALID_SCHEMA_CACHE`, `INVALID_SEMANTIC_CONTEXT`, `INVALID_SAVED_QUERY`,
  `INVALID_DATA_ACCESS_MANIFEST`, `INVALID_REDIS_CONTEXT`, or
  `INVALID_RESOURCE_REFERENCE`; invalid content is not downgraded to a gap.
* R9: Version 2 emits at most 500 resources, 5,000 fields, 500 snippets, and 500
  declarations after stable code-point sorting. Omitted visible items are counted
  in `truncation` without counting filtered resources.
* R10: MongoDB behavior and version 1 context output remain unchanged.

## Expected Errors

* Invalid, duplicate, oversized, unsafe, escaping, unknown, blacklisted, or
  ambiguously protected declarations fail with a stable code and bounded evidence
  that does not reproduce the raw declaration or protected identifier.
* Optional metadata is absent: emit the matching structured gap rather than
  inventing resources, fields, relationships, key families, or types.
* `--context-version 2` is requested for MongoDB or an unknown engine: return a
  bounded `UNSUPPORTED_CONTEXT_ENGINE` error without changing version 1 behavior.

## Dependencies

* Existing `skill context`, schema cache, flattened Elasticsearch schema,
  semantic context, approved contracts, saved queries, data-access declarations,
  blacklist and Redis mask rules, engine capability registry, and serializers.

## Constraints

* Preserve the external-agent boundary and ADR-0005.
* Do not emit credentials or use them to connect during context collection.
* Do not add or upgrade dependencies.
* Keep English and Traditional Chinese Markdown and HTML documentation aligned.
* Preserve existing CI checks and use `make verify` as the completion gate.
