# dbcli Requirements

## v1 Requirements

All requirements map to specific phases in ROADMAP.md.

### Initialization & Configuration

- [ ] **INIT-01**: `dbcli init` command with hybrid mode (read .env first, prompt for missing values)
- [ ] **INIT-02**: Support PostgreSQL, MySQL, MariaDB database systems
- [ ] **INIT-03**: Automatic .env file parsing (common formats: DATABASE_URL, DB_HOST/PORT/USER/PASSWORD/NAME)
- [ ] **INIT-04**: `.dbcli` JSON configuration file generation (DB-system-aware parameters)
- [ ] **INIT-05**: Coarse-grained permission model (Query-only / Read-Write / Admin)

### Schema Discovery & Storage

- [ ] **SCHEMA-01**: `dbcli schema [table]` command to retrieve single table structure
- [ ] **SCHEMA-02**: `dbcli list` command to show all tables with metadata
- [ ] **SCHEMA-03**: Auto-generate `.dbcli` with table structures and relationships
- [ ] **SCHEMA-04**: Incremental schema refresh (detect and update only changes)

### Query Operations

- [ ] **QUERY-01**: `dbcli query "SELECT ..."` command for direct SQL execution
- [ ] **QUERY-02**: Permission-aware execution (reject write operations in Query-only mode)
- [ ] **QUERY-03**: Structured output formats (table, JSON, CSV) for AI parsing
- [ ] **QUERY-04**: Helpful error messages with debug suggestions and similar table recommendations

### Data Modification

- [ ] **DATA-01**: `dbcli insert [table]` command to insert data (Auth required, permission-checked)
- [ ] **DATA-02**: `dbcli update [table]` command to update data (Auth required, permission-checked)

### Export

- [ ] **EXPORT-01**: `dbcli export "SELECT ..." --format json|csv` for data export with streaming support

### AI Integration

- [ ] **AI-01**: Create dbcli skill documentation (Claude Code compatible format)
- [ ] **AI-02**: Support cross-platform AI agents (Claude Code, Gemini, Copilot CLI, Cursor, IDEs)
- [ ] **AI-03**: Dynamic skill reflection (skill updates as CLI capabilities evolve)

---

## v14.0 Requirements — Data Access Control & Sensitive Data Protection

### Blacklist Infrastructure

- [x] **BL-01**: Table-level blacklisting (reject all operations on blacklisted tables)
- [x] **BL-02**: Column-level blacklisting (omit blacklisted columns from all SELECT operations)
- [x] **BL-03**: Blacklist management via CLI commands (list, add, remove)
- [x] **BL-04**: Security notifications (display which columns were omitted from results)
- [ ] **BL-05**: Context-aware overrides (temporary override via environment variable)

### Requirements Mapping

| Req ID | Description | Phase | Type |
|--------|-------------|-------|------|
| BL-01 | Table-level blacklisting | 13 | Core |
| BL-02 | Column-level blacklisting | 13 | Core |
| BL-03 | CLI commands for blacklist management | 13 | Core |
| BL-04 | Security notifications in output | 13 | Core |
| BL-05 | Context-aware overrides | 13.1+ | Future |

### Non-Functional Requirements

- [x] **NF-01**: Performance — Blacklist check adds < 1ms overhead
- [x] **NF-02**: Security — Blacklist config not exposed in skill output
- [x] **NF-03**: Backward compatibility — Existing configs work unchanged
- [x] **NF-04**: Test coverage — 30+ unit tests for all blacklist scenarios

---

## v2+ Requirements (Deferred)

- Audit logging (WHO, WHAT, WHEN, WHY for all operations)
- Multi-connection management (multiple databases per project)
- Interactive SQL shell (similar to `psql` or `mysql` CLI)
- Row-level security (filter rows based on conditions)
- Role-based blacklist (different blacklist per permission level)
- Bulk data import/export operations
- ORM code generation from schema

---

## Out of Scope (Explicitly Excluded)

- **Data migration tools** — Use Flyway, Liquibase, or db-migrate instead
- **Visual schema designer** — Out of scope; dbcli is CLI-first
- **Real-time data streaming** — Not a requirement for V1
- **Access control per-table or per-column** — Coarse-grained roles sufficient for V1
- **Query result caching** — Deferred to performance optimization phase

---

## Requirement Quality Checklist

✅ All requirements are:
- **Specific and testable** — Each has clear acceptance criteria
- **User-centric** — Written from AI agent or developer perspective
- **Atomic** — One capability per requirement
- **Independent** — Minimal cross-requirement dependencies (dependencies are documented in ROADMAP.md)

---

## Traceability

| Requirement ID | Phase | Status |
|---|---|---|
| INIT-01 | Phase 2 | Pending |
| INIT-02 | Phase 3 | Pending |
| INIT-03 | Phase 2 | Pending |
| INIT-04 | Phase 2 | Pending |
| INIT-05 | Phase 4 | Pending |
| SCHEMA-01 | Phase 5 | Pending |
| SCHEMA-02 | Phase 5 | Pending |
| SCHEMA-03 | Phase 5 | Pending |
| SCHEMA-04 | Phase 8 | Pending |
| QUERY-01 | Phase 6 | Pending |
| QUERY-02 | Phase 6 | Pending |
| QUERY-03 | Phase 6 | Pending |
| QUERY-04 | Phase 6 | Pending |
| DATA-01 | Phase 7 | Pending |
| DATA-02 | Phase 7 | Pending |
| EXPORT-01 | Phase 8 | Pending |
| AI-01 | Phase 9 | Pending |
| AI-02 | Phase 9 | Pending |
| AI-03 | Phase 9 | Pending |

---

*Last updated: 2026-03-25 after roadmap definition*
