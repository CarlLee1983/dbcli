# dbcli Feature Matrix

This matrix summarizes the current command support by database engine. It is intended for maintainers and AI agents choosing a safe command path.

Legend:

- ✅ Supported
- ⚠️ Supported with limitations or engine-specific behavior
- ❌ Not supported / exits with an error
- N/A Not database-engine-specific

| Command / area | PostgreSQL | MySQL | MariaDB | MongoDB | Notes |
| --- | --- | --- | --- | --- | --- |
| `init` | ✅ | ✅ | ✅ | ✅ | MongoDB accepts `mongodb://` or `mongodb+srv://` via `--uri`, or `host`/`port`/`user`/`password` fields. `authSource` defaults to `admin` when credentials are present. SRV URIs are resolved at connect time (with Google DNS-over-HTTPS fallback) and `tls=true` is auto-enabled. |
| Multi-connection `use` / `--use` | ✅ | ✅ | ✅ | ✅ | v2 config isolates active/default connection; schema caches are per connection. MongoDB connections coexist with SQL connections in the same `.dbcli` profile. |
| `list` | ✅ | ✅ | ✅ | ✅ | SQL engines list tables/views; MongoDB lists collections with `estimatedDocumentCount`. JSON output for MongoDB is `{ name, documentCount }`; the `--format table` view labels output as `Collections in <db> (mongodb)`. |
| `schema [table]` | ✅ | ✅ | ✅ | ⚠️ | SQL engines return relational metadata. MongoDB infers field names/types from a sampled set of documents (default 50, override with `--sample-size <n>`, capped at 1000); types are JS `typeof` strings (so nested documents and arrays both surface as `object`). All fields are reported as nullable, and there is no PK / FK / index information. |
| `schema` full scan / `--refresh` / `--reset` | ✅ | ✅ | ✅ | ⚠️ | MongoDB scan stores inferred collection schemas from the same sampled documents (default 50, override with `--sample-size`). Refresh/diff semantics are best-effort for schemaless data — newly added fields only appear once they show up in the sample window. `schemaLastUpdated` is written for MongoDB the same way as for SQL engines; `doctor` uses the standard schema-cache freshness check. |
| `query` | ✅ | ✅ | ✅ | ⚠️ | SQL engines accept SQL. MongoDB requires `--collection <name>` and accepts either a JSON object filter (→ `find`) or a JSON array (→ `aggregate` pipeline). Anything that looks like SQL (`SELECT`/`INSERT`/…) is rejected with a hint to use JSON. |
| Query output `table` / `json` / `csv` | ✅ | ✅ | ✅ | ✅ | MongoDB documents flow through the shared result formatter. Nested fields and arrays are stringified by the formatter — prefer `--format json` for fidelity. |
| Query auto-limit / size guard | ✅ | ✅ | ✅ | ⚠️ | SQL query-only mode rewrites missing `LIMIT` clauses. MongoDB applies `--limit` directly: `find` uses `.limit(N)`, and aggregation pipelines that don't already end with `$limit` get `{ $limit: N }` appended. Query-only mode applies a default cap (currently 1000) when neither `--limit` nor `--no-limit` is supplied. The shared size guard still applies: an empty/very small filter on a `huge` collection is blocked unless `--no-limit` is passed. |
| `q` saved query execution | ✅ | ✅ | ✅ | ❌ | Saved snippets are SQL-only `SELECT`/`WITH` statements; MongoDB connections are rejected with “Saved queries do not support MongoDB connections”. MariaDB reuses MySQL snippet variants. |
| `queries` snippet management | ✅ | ✅ | ✅ | ⚠️ | File management (`list` / `new` / `edit` / `check` / `copy` / `rename` / `import` / `export`) works regardless of active connection. `queries list` defaults to `postgres` when the active connection is MongoDB, since execution through `q` is SQL-only. |
| `insert` | ✅ | ✅ | ✅ | ⚠️ | SQL engines validate against `getTableSchema`, run blacklist column rules, and support `--dry-run` / `--force`. MongoDB calls `insertOne` with the supplied JSON object: **no schema validation**, but the **table-level and column-level blacklist are enforced before the connection opens** and `--dry-run` renders a `db.<col>.insertOne(...)` preview without opening the connection. Permission gate runs against the synthetic statement `INSERT INTO dummy`, so `read-write` (or higher) is required. |
| `update` | ✅ | ✅ | ✅ | ⚠️ | SQL engines parse simple `--where` clauses and support `--dry-run`. MongoDB accepts a full JSON filter in `--where`, or falls back to `key=value [AND …]` parsing for convenience. The `--set` payload is wrapped in `$set` automatically unless it already contains an operator (any top-level key starting with `$`, e.g. `$inc`, `$push`). The **table-level blacklist** and the **column-level blacklist** (against `$set` / `$unset` keys, or top-level keys for replacement-style payloads) are enforced before the connection opens. `--dry-run` renders a `db.<col>.updateMany(filter, updateDoc)` preview without opening the connection. MongoDB calls `updateMany` — **all matching documents** are updated. |
| `delete` | ✅ | ✅ | ✅ | ⚠️ | All engines require `data-admin` or `admin` permission. SQL engines run safety guards and support `--dry-run`. MongoDB calls `deleteMany` against a JSON or `key=value` filter; the **table-level blacklist is enforced before the connection opens** and `--dry-run` renders a `db.<col>.deleteMany(filter)` preview without opening the connection. There is no "limit to one" option, so a filter that matches multiple documents will delete all of them. |
| `export` | ✅ | ✅ | ✅ | ⚠️ | SQL engines run through the shared formatter (`json` / `csv`). MongoDB requires `--collection <name>` and accepts a JSON filter or aggregation pipeline (SQL strings are rejected). Supported formats: `json`, `jsonl` (newline-delimited; the recommended default for mongo), and `csv`. `csv` JSON-stringifies nested objects/arrays and emits a stderr warning. Blacklist rules apply: blacklisted tables are rejected; blacklisted columns are stripped from the output with the standard "columns omitted" notification. |
| `blacklist` config management | ✅ | ✅ | ✅ | ⚠️ | Rule CRUD is engine-independent. MongoDB **read** paths (`query`) enforce the table-level blacklist and apply column filtering on returned documents, with the standard "columns omitted" notification. MongoDB **write** paths now also enforce the blacklist: `insert` / `update` reject blacklisted tables and reject payloads that touch blacklisted columns; `delete` rejects blacklisted tables. `DBCLI_OVERRIDE_BLACKLIST=true` still bypasses with a console warning. |
| `check` data health | ⚠️ | ✅ | ✅ | ❌ | Health checks emit SQL with backtick quoting and run through the shared `execute()` path. Best coverage is MySQL/MariaDB; PostgreSQL is limited until dialect-specific SQL generation is added; MongoDB is not a supported target — the SQL emitted by `HealthChecker` cannot be parsed as JSON by the MongoDB adapter, so the command will error out. |
| `diff` snapshots | ✅ | ✅ | ✅ | ❌ | Relational schema snapshots only; MongoDB exits with “此命令目前不支援 MongoDB”. |
| `migrate` DDL | ✅ | ✅ | ✅ | ❌ | PostgreSQL has table/index/constraint/enum DDL. MySQL/MariaDB share MySQL DDL; standalone enum commands are no-ops with warnings. MongoDB is unsupported (no equivalent DDL surface in this CLI). |
| `shell` | ✅ | ✅ | ✅ | ⚠️ | SQL engines run raw SQL plus dbcli sub-commands. The MongoDB shell wraps the adapter in `MongoShellAdapter`: it can list collections and run dbcli commands, but raw SQL is rejected with “MongoDB shell does not support raw SQL.” Reads should be issued through `query <json> --collection <name>` from inside the shell. Tab completion includes collection names always; field completion is eagerly populated when the database has ≤ 20 collections, otherwise tab completion stays at collection level to keep shell startup fast. |
| `status` | ✅ | ✅ | ✅ | ✅ | Safe non-credential config summary. |
| `doctor` | ✅ | ✅ | ✅ | ✅ | MongoDB includes SRV diagnostics for `mongodb+srv://` connections (local DNS first, Google DoH fallback), reports server version via `serverInfo()`, runs the large-table heuristic against estimated document counts, and uses the standard schema-cache freshness check. |
| `completion` | N/A | N/A | N/A | N/A | Shell completion generation is engine-independent. |
| `upgrade` | N/A | N/A | N/A | N/A | Package/skill update checks are engine-independent. |
| `skill` | N/A | N/A | N/A | N/A | Generates the bundled AI skill/reference files; runtime permissions still control actual access. |

## Required CI validation

The required CI validation gate runs both commands below without `continue-on-error`:

```bash
bun run typecheck
bun test
```

Additional CI steps may run lint, build, executable smoke checks, and benchmarks. Lint and benchmark steps are advisory when marked `continue-on-error`; typecheck and test are the hard pass/fail gate.

## MongoDB limitations summary

MongoDB support is intentionally narrower than SQL support. The list below is the canonical reference for AI agents and humans deciding what is safe to run.

### Connection and configuration

- Both `mongodb://` and `mongodb+srv://` URIs are accepted via `--uri`. Without a URI, dbcli builds one from `host` / `port` / `user` / `password` / `database`, defaulting `authSource` to `admin` when credentials are present.
- For SRV URIs, dbcli resolves SRV and TXT records itself: it tries the local resolver first, and falls back to `https://dns.google/resolve` if the resolver is unreachable. `tls=true` is forced on, and `authSource=admin` is added when credentials exist and no `authSource` is in the URI/TXT options.
- `database` is required even in URI mode — it is used to label the schema cache slot, not to override the URI's own path.
- `serverSelectionTimeoutMS` is set from `connection.timeout` (default 5000 ms).

### Query semantics

- `query` requires `--collection <name>` and a JSON payload — an object filter (executed as `find`) or an array (executed as `aggregate`). Anything matching the SQL keyword pattern (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`CREATE`/`DROP`/`ALTER`/`SHOW`/`DESCRIBE`) is rejected up front.
- `--limit` is honored at execution time: `find` calls `.limit(N)`, and aggregation pipelines that don't already end with `$limit` get `{ $limit: N }` appended. Pipelines that already specify `$limit` keep their existing cap.
- Query-only mode applies the same default cap as the SQL path (currently 1000) when neither `--limit` nor `--no-limit` is given.
- The size guard still runs: an unfiltered/empty filter on a `huge` collection (per cached row counts) is blocked unless `--no-limit` is supplied. This guard uses a synthetic SQL string for the decision; it does not modify the actual MongoDB query.
- Saved snippets (`q @name`) are SQL-only and explicitly reject MongoDB connections.

### Schema inference

- `schema <collection>` and full schema scans both sample 50 documents per collection by default and union their top-level keys. Override the sample window with `dbcli schema --sample-size <n>` (capped at 1000); the flag is silently ignored on SQL connections.
- Field types are JS `typeof` strings (`string` / `number` / `object` / `boolean` / etc.) — nested documents and arrays both appear as `object`. There is no introspection of nested structure, primary keys, foreign keys, indexes, or required fields.
- Newly-introduced fields only enter the inferred schema once they appear in the sample window. Treat the schema cache as a hint, not a contract.
- `schemaLastUpdated` is written for MongoDB the same way as for SQL engines, so `dbcli doctor` reports the standard schema-cache freshness for mongo connections.

### Write commands

- `insert` calls `insertOne` with the JSON payload. The table-level blacklist and the column-level blacklist are checked before the connection opens — payloads touching blacklisted fields exit with `BlacklistError` and emit a JSON error. `--dry-run` renders a `db.<col>.insertOne(<doc>)` preview and exits without opening the connection. There is still **no** schema validation. Permission is gated through the synthetic statement `INSERT INTO dummy`, so the connection must have at least `read-write`.
- `update` accepts a JSON document or `key=value [AND key=value …]` in `--where`. The `--set` payload is automatically wrapped in `$set` unless any top-level key starts with `$` (e.g. `$inc`, `$push`, `$unset`). The table-level blacklist runs first, then the column-level blacklist runs against the keys inside `$set` / `$unset` (or the top-level keys for replacement-style payloads). `--dry-run` renders a `db.<col>.updateMany(filter, updateDoc)` preview and exits without opening the connection. Execution uses `updateMany`, so every matching document is updated.
- `delete` requires `data-admin` or `admin` permission and runs `deleteMany`. The table-level blacklist is enforced before the connection opens. `--dry-run` renders a `db.<col>.deleteMany(filter)` preview without opening the connection. There is no equivalent of "limit to one" — design filters carefully.
- Set `DBCLI_OVERRIDE_BLACKLIST=true` to bypass blacklist enforcement temporarily (a warning is printed to stderr).

### Export

- `export` accepts a JSON filter or aggregation pipeline (SQL strings are rejected with a hint). `--collection <name>` is required.
- Supported `--format` values: `json` (single array), `jsonl` (one document per line — the recommended default for mongo), and `csv`. `csv` JSON-stringifies nested objects/arrays and emits a stderr warning so the caller knows lossy flattening occurred.
- Blacklisted tables are rejected before the connection opens; blacklisted columns are stripped from each emitted document and surfaced via the standard "columns omitted" notification.
- `--limit` and `--no-limit` follow the same semantics as `query`; query-only mode applies the default cap when neither flag is supplied.

### Unsupported commands

`check`, `diff`, `migrate`, and `q` are not supported on MongoDB connections — they exit with an error rather than running a partial implementation.

### Recommended `query` patterns

```bash
# Simple equality filter
dbcli query '{"status": "active"}' --collection users --format json

# Operators
dbcli query '{"createdAt": {"$gte": "2024-01-01"}, "status": {"$ne": "deleted"}}' \
  --collection orders --format json

# Aggregation pipeline (use $limit/$project to control output volume)
dbcli query '[
  {"$match": {"status": "paid"}},
  {"$group": {"_id": "$customerId", "total": {"$sum": "$amount"}}},
  {"$sort": {"total": -1}},
  {"$limit": 50}
]' --collection orders --format json

# Update many — non-operator $set is added automatically
dbcli update users --where '{"status": "pending"}' --set '{"status": "active"}'

# Delete many (admin permission required)
dbcli delete sessions --where '{"expiresAt": {"$lt": "2026-01-01"}}'
```
