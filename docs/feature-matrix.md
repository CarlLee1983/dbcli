# dbcli Feature Matrix

This matrix summarizes the current command support by database engine. It is intended for maintainers and AI agents choosing a safe command path.

Legend:

- ✅ Supported
- ⚠️ Supported with limitations or engine-specific behavior
- ❌ Not supported / exits with an error
- N/A Not database-engine-specific

| Command / area | PostgreSQL | MySQL | MariaDB | MongoDB | Notes |
| --- | --- | --- | --- | --- | --- |
| `init` | ✅ | ✅ | ✅ | ✅ | MongoDB supports `mongodb://` and `mongodb+srv://` via `--uri`, or host/port fields. |
| Multi-connection `use` / `--use` | ✅ | ✅ | ✅ | ✅ | v2 config isolates active/default connection; schema caches are per connection. |
| `list` | ✅ | ✅ | ✅ | ✅ | SQL engines list tables/views; MongoDB lists collections with estimated document counts. |
| `schema [table]` | ✅ | ✅ | ✅ | ⚠️ | SQL engines return relational metadata. MongoDB samples collection documents to infer field names/types; no PK/FK/index relational guarantees. |
| `schema` full scan / `--refresh` / `--reset` | ✅ | ✅ | ✅ | ⚠️ | MongoDB scan stores inferred collection schemas from document samples. Refresh/diff semantics are less precise for schemaless data. |
| `query` | ✅ | ✅ | ✅ | ⚠️ | SQL engines accept SQL. MongoDB accepts JSON object filters or aggregation pipeline arrays and requires `--collection <name>`. |
| Query output `table` / `json` / `csv` | ✅ | ✅ | ✅ | ✅ | MongoDB documents are formatted through the shared result formatter. |
| Query auto-limit / size guard | ✅ | ✅ | ✅ | ⚠️ | SQL query-only mode adds a result limit. MongoDB query accepts `--limit`, but JSON filters/pipelines are not rewritten like SQL. |
| `q` saved query execution | ✅ | ✅ | ✅ | ❌ | Saved snippets are SQL-only `SELECT`/`WITH` statements; MongoDB connections are rejected. MariaDB uses MySQL snippet variants. |
| `queries` snippet management | ✅ | ✅ | ✅ | ⚠️ | File management works for all projects, but execution through `q` is SQL-only. |
| `insert` | ✅ | ✅ | ✅ | ⚠️ | SQL engines validate table schema and support dry-run. MongoDB inserts one JSON document into the named collection; no SQL-style dry-run/schema validation. |
| `update` | ✅ | ✅ | ✅ | ⚠️ | SQL engines parse simple `--where` clauses and support dry-run. MongoDB accepts JSON filter in `--where` or simple `key=value`; non-operator `--set` is wrapped in `$set`; no dry-run. |
| `delete` | ✅ | ✅ | ✅ | ⚠️ | SQL engines require data-admin/admin plus safety guards. MongoDB deletes many documents matching JSON/simple filter; no dry-run. |
| `export` | ✅ | ✅ | ✅ | ❌ | SQL-only; MongoDB exits with “currently not supported”. Use `query --format json/csv` and shell redirection for MongoDB exports. |
| `blacklist` config management | ✅ | ✅ | ✅ | ⚠️ | Rule CRUD is engine-independent. SQL paths enforce table/column rules broadly; MongoDB write paths do not perform the same schema-aware column filtering. |
| `check` data health | ⚠️ | ✅ | ✅ | ❌ | Health checks emit SQL with backtick quoting. Best coverage is MySQL/MariaDB; PostgreSQL should be treated as limited until dialect-specific SQL generation is added; MongoDB is not a supported target. |
| `diff` snapshots | ✅ | ✅ | ✅ | ❌ | Relational schema snapshots only; MongoDB exits with “currently not supported”. |
| `migrate` DDL | ✅ | ✅ | ✅ | ❌ | PostgreSQL has table/index/constraint/enum DDL. MySQL/MariaDB share MySQL DDL; standalone enum commands are no-ops with warnings. MongoDB is unsupported. |
| `shell` | ✅ | ✅ | ✅ | ⚠️ | SQL engines run raw SQL and dbcli commands. MongoDB shell can list collections, but raw SQL execution is blocked; use `query <json> --collection <name>`. |
| `status` | ✅ | ✅ | ✅ | ✅ | Safe non-credential config summary. |
| `doctor` | ✅ | ✅ | ✅ | ✅ | MongoDB includes SRV diagnostics for `mongodb+srv://` connections. |
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

MongoDB support is intentionally narrower than SQL support:

- Queries are JSON filters or aggregation pipeline arrays, not SQL.
- `query` requires `--collection <name>`.
- Saved snippets (`q`) are SQL-only and do not run on MongoDB connections.
- Schema output is inferred from sampled documents and should not be treated as a relational contract.
- MongoDB write commands do not currently provide the same dry-run/schema-validation behavior as SQL writes.
- `export`, `diff`, and `migrate` are unsupported for MongoDB.
