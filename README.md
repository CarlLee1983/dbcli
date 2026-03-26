# dbcli — Database CLI for AI Agents

**Languages:** [English](./README.md) | [繁體中文](./README.zh-TW.md)

A unified database CLI tool that enables AI agents (Claude Code, Gemini, Copilot, Cursor) to safely query, discover, and operate on databases.

**Core Value:** AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool.

## Internationalization (i18n)

dbcli supports multiple languages via the `DBCLI_LANG` environment variable:

```bash
# English (default)
dbcli init

# Traditional Chinese
DBCLI_LANG=zh-TW dbcli init

# Or set in .env
export DBCLI_LANG=zh-TW
dbcli init
```

**Supported languages:**
- `en` — English (default)
- `zh-TW` — Traditional Chinese (Taiwan)

All messages, help text, error messages, and command output respond to the language setting automatically.


## Quick Start

### Installation

#### Global Installation (Recommended)

```bash
npm install -g dbcli
```

#### Zero-Install (No Installation Needed)

```bash
npx dbcli init
npx dbcli query "SELECT * FROM users"
```

#### Development Installation

```bash
git clone <repository>
cd dbcli
bun install
bun run dev -- --help
```

### First Steps

```bash
# Initialize project with database connection
dbcli init

# List available tables
dbcli list

# View table structure
dbcli schema users

# Query data
dbcli query "SELECT * FROM users"

# Generate AI agent skill
dbcli skill --install claude
```

---

## API Reference

### Commands

#### `dbcli init`

Initialize a new dbcli project with database connection configuration.

**Usage:**
```bash
dbcli init
```

**Behavior:**
- Reads `.env` file if present (auto-fills DATABASE_URL, DB_* variables)
- Prompts for missing values (host, port, user, password, database name, permission level)
- Creates `.dbcli` JSON config file in project root
- Tests database connection before saving

**Examples:**
```bash
# Interactive initialization
dbcli init

# With environment variables pre-set
export DATABASE_URL="postgresql://user:pass@localhost/mydb"
dbcli init

# Specify permission level
echo "PERMISSION_LEVEL=admin" >> .env && dbcli init
```

---

#### `dbcli list`

List all tables in the connected database.

**Usage:**
```bash
dbcli list [OPTIONS]
```

**Options:**
- `--format json` — Output as JSON instead of ASCII table

**Examples:**
```bash
# Table format (human-readable)
dbcli list

# JSON format (for AI parsing)
dbcli list --format json

# Pipe to tools
dbcli list --format json | jq '.data[].name'
```

---

#### `dbcli schema [table]`

Show table structure (columns, types, constraints, foreign keys).

**Usage:**
```bash
dbcli schema [table]
dbcli schema                 # Scan entire database and update .dbcli
dbcli schema users           # Show structure of 'users' table
```

**Options:**
- `--format json` — Output as JSON
- `--refresh` — Detect and update schema changes (requires --force for approval)
- `--force` — Skip confirmation for schema refresh/overwrite

**Examples:**
```bash
# Show users table structure
dbcli schema users

# JSON output with full metadata
dbcli schema users --format json

# Update schema with new tables
dbcli schema --refresh

# Auto-approve schema refresh
dbcli schema --refresh --force

# Scan entire database
dbcli schema
```

---

#### `dbcli query "SQL"`

Execute SQL query and return results.

**Usage:**
```bash
dbcli query "SELECT * FROM users"
```

**Options:**
- `--format json|table|csv` — Output format (default: table)
- `--output file` — Write to file instead of stdout

**Behavior:**
- Enforces permission-based restrictions (Query-only mode blocks INSERT/UPDATE/DELETE)
- Auto-limits results to 1000 rows in Query-only mode (notification shown)
- Returns structured results with metadata (row count, execution time)

**Examples:**
```bash
# Table output (human-readable)
dbcli query "SELECT * FROM users"

# JSON (for AI/programmatic parsing)
dbcli query "SELECT * FROM users" --format json

# CSV export
dbcli query "SELECT * FROM users" --format csv --output users.csv

# Pipe to other tools
dbcli query "SELECT * FROM products" --format json | jq '.data[] | .name'

# Large result sets (paginate with LIMIT/OFFSET)
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 0"
```

---

#### `dbcli insert [table]` (Requires Read-Write or Admin permission)

Insert data into table.

**Usage:**
```bash
dbcli insert users --data '{"name": "Alice", "email": "alice@example.com"}'
```

**Options:**
- `--data JSON` — Row data as JSON object (REQUIRED)
- `--dry-run` — Show SQL without executing
- `--force` — Skip confirmation

**Behavior:**
- Validates JSON format
- Generates parameterized SQL (prevents SQL injection)
- Shows confirmation prompt before inserting (unless --force used)

**Examples:**
```bash
# Insert single row
dbcli insert users --data '{"name": "Bob", "email": "bob@example.com"}'

# Preview SQL without executing
dbcli insert users --data '{"name": "Charlie"}' --dry-run

# Skip confirmation
dbcli insert users --data '{"name": "Diana"}' --force
```

---

#### `dbcli update [table]` (Requires Read-Write or Admin permission)

Update existing rows.

**Usage:**
```bash
dbcli update users --where "id=1" --set '{"name": "Alice Updated"}'
```

**Options:**
- `--where condition` — WHERE clause (REQUIRED, e.g., "id=1 AND status='active'")
- `--set JSON` — Updated columns as JSON object (REQUIRED)
- `--dry-run` — Show SQL without executing
- `--force` — Skip confirmation

**Examples:**
```bash
# Update single row
dbcli update users --where "id=1" --set '{"name": "Alice"}'

# Update multiple rows
dbcli update users --where "status='inactive'" --set '{"status":"active"}'

# Preview SQL
dbcli update users --where "id=1" --set '{"name": "Bob"}' --dry-run

# Skip confirmation
dbcli update users --where "id=2" --set '{"email": "new@example.com"}' --force
```

---

#### `dbcli delete [table]` (Requires Admin permission only)

Delete rows (admin-only for safety).

**Usage:**
```bash
dbcli delete users --where "id=1" --force
```

**Options:**
- `--where condition` — WHERE clause (REQUIRED)
- `--dry-run` — Show SQL without executing
- `--force` — Required to actually delete (safety guard)

**Examples:**
```bash
# Delete single row (requires --force)
dbcli delete users --where "id=1" --force

# Preview deletion
dbcli delete products --where "status='deprecated'" --dry-run

# Delete multiple rows
dbcli delete orders --where "created_at < '2020-01-01'" --force
```

---

#### `dbcli export "SQL"`

Export query results to file.

**Usage:**
```bash
dbcli export "SELECT * FROM users" --format json --output users.json
```

**Options:**
- `--format json|csv` — Output format
- `--output file` — Write to file (default: stdout for piping)

**Behavior:**
- Query-only permission limited to 1000 rows per export
- Generates RFC 4180 compliant CSV
- Creates well-formed JSON arrays

**Examples:**
```bash
# Export to JSON
dbcli export "SELECT * FROM users" --format json --output users.json

# Export to CSV
dbcli export "SELECT * FROM orders" --format csv --output orders.csv

# Pipe compressed export
dbcli export "SELECT * FROM products" --format csv | gzip > products.csv.gz

# Combine with query tools
dbcli export "SELECT * FROM users WHERE active=true" --format json | jq '.data | length'
```

---

#### `dbcli skill`

Generate or install AI agent skill documentation.

**Usage:**
```bash
dbcli skill                           # Output skill to stdout
dbcli skill --output SKILL.md         # Write to file
dbcli skill --install claude          # Install to Claude Code config
dbcli skill --install gemini          # Install to Gemini CLI
dbcli skill --install copilot         # Install to GitHub Copilot
dbcli skill --install cursor          # Install to Cursor IDE
```

**Behavior:**
- Dynamically generates SKILL.md from CLI introspection
- Filters commands by permission level (Query-only hides write commands)
- Supports multiple output modes: stdout, file, platform installation

**Examples:**
```bash
# Generate skill for Claude Code
dbcli skill --install claude

# Generate skill manually for documentation
dbcli skill > ./docs/SKILL.md

# View generated skill (stdout)
dbcli skill

# Install for all platforms
dbcli skill --install claude && \
dbcli skill --install gemini && \
dbcli skill --install copilot && \
dbcli skill --install cursor
```

---

## Permission Model

dbcli implements a coarse-grained permission system with three levels. Permission level is set during `dbcli init` and stored in `.dbcli` config file.

### Permission Levels

| Level | Allowed Commands | Blocked Commands | Use Case |
|-------|------------------|------------------|----------|
| **Query-only** | `init`, `list`, `schema`, `query`, `export` (limited to 1000 rows) | `insert`, `update`, `delete` | Read-only AI agents, data analysts, reporting |
| **Read-Write** | + `insert`, `update` | `delete` | Application developers, content managers |
| **Admin** | All commands | — | Database administrators, schema modifications |

### Configuration

Permission level is set during initialization:

```bash
dbcli init
# Prompts: "Permission level? (query-only / read-write / admin)"
# Stored in ~/.dbcli as: "permissionLevel": "query-only"
```

### Permission-Based Examples

#### Query-Only Mode (AI Agent)
```bash
# Allowed: Read operations
dbcli query "SELECT * FROM users"
dbcli schema users
dbcli export "SELECT * FROM orders" --format json

# Blocked: Write operations
dbcli insert users --data '{...}'  # ERROR: Permission denied
dbcli delete users --where "id=1"  # ERROR: Permission denied
```

#### Read-Write Mode (Application Developer)
```bash
# Allowed: Read + write
dbcli query "SELECT * FROM users"
dbcli insert users --data '{"name": "Alice"}'
dbcli update users --where "id=1" --set '{"name": "Bob"}'

# Blocked: Delete (safety feature)
dbcli delete users --where "id=1"  # ERROR: Admin only
```

#### Admin Mode (Database Administrator)
```bash
# Allowed: Everything
dbcli query "SELECT * FROM users"
dbcli insert users --data '{"name": "Eve"}'
dbcli update users --where "id=1" --set '{"status": "active"}'
dbcli delete users --where "id=1" --force  # Only Admin can delete
```

### Best Practices

- **AI Agents:** Use Query-only for read-only scenarios; prevents accidental data loss
- **Applications:** Use Read-Write for normal CRUD operations; prevents DROP TABLE accidents
- **Maintenance:** Use Admin only for schema changes, bulk deletes, or emergency operations
- **Principle of Least Privilege:** Assign minimum permission level needed for each use case

---

## AI Integration Guide

dbcli generates AI-consumable skill documentation and can be integrated into your favorite AI development tools.

### Quick Start

Generate skill for your preferred platform:

```bash
# Claude Code (Anthropic's VS Code extension)
dbcli skill --install claude

# Gemini CLI (Google's command-line AI)
dbcli skill --install gemini

# GitHub Copilot CLI
dbcli skill --install copilot

# Cursor IDE (AI-native editor)
dbcli skill --install cursor
```

After installation, the AI agent will have access to dbcli commands and can use them to query, insert, update, or export data based on your permission level.

### Platform-Specific Setup

#### Claude Code (Anthropic)

1. Install dbcli globally: `npm install -g dbcli`
2. Initialize: `dbcli init` (choose permission level)
3. Install skill: `dbcli skill --install claude`
4. Restart Claude Code extension
5. In Claude Code chat, ask: "Show me the database schema" or "Query active users"

**Skill location:** `~/.claude/skills/SKILL.md`

---

#### Gemini CLI (Google)

1. Install dbcli globally: `npm install -g dbcli`
2. Initialize: `dbcli init`
3. Install skill: `dbcli skill --install gemini`
4. Start Gemini: `gemini start`
5. In chat, request: "Query the users table" or "Show database tables"

**Skill location:** `~/.local/share/gemini/skills/` (Linux) or platform equivalent

---

#### GitHub Copilot CLI

1. Install dbcli globally: `npm install -g dbcli`
2. Initialize: `dbcli init`
3. Install skill: `dbcli skill --install copilot`
4. Install Copilot CLI: `npm install -g @github-next/github-copilot-cli`
5. Use copilot preview: `copilot --help` and explore dbcli integration

**Skill location:** Per Copilot configuration

---

#### Cursor IDE

1. Install dbcli globally: `npm install -g dbcli`
2. Initialize: `dbcli init`
3. Install skill: `dbcli skill --install cursor`
4. Open Cursor editor
5. Use Cursor's Composer: "Insert a new user" or "Export user data"

**Skill location:** `~/.cursor/skills/`

---

### Example: AI Agent Workflow

**Scenario:** You want an AI agent to analyze user engagement data.

```bash
# 1. Install and initialize
npm install -g dbcli
dbcli init  # Choose "query-only" for safety

# 2. Install skill to Claude Code
dbcli skill --install claude

# 3. In Claude Code chat, ask:
# "Analyze the last 7 days of user activity and summarize insights"

# Claude Code will:
# - Use: dbcli schema users, dbcli query "SELECT ..."
# - Parse JSON output
# - Provide analysis
```

### Skill Refresh

dbcli dynamically generates skills based on your current configuration:

```bash
# When permission level changes, skill updates automatically
# Edit ~/.dbcli and change "permissionLevel" to "admin"
dbcli skill  # Now shows delete and admin commands

# Re-install to push changes to AI platform
dbcli skill --install claude
```

---

## Troubleshooting

### Connection Issues

#### "ECONNREFUSED: Connection refused"

Database is not running or host/port is incorrect.

**Solutions:**

```bash
# Verify database is running
psql --version  # PostgreSQL installed?
mysql --version  # MySQL installed?

# Check connection string
dbcli init  # Re-run initialization to verify credentials

# Verify host/port from command line
psql -h localhost -U postgres  # PostgreSQL test
mysql -h 127.0.0.1 -u root      # MySQL test
```

#### "ENOTFOUND: getaddrinfo ENOTFOUND hostname"

Hostname resolution failed (typo or DNS issue).

**Solutions:**

```bash
# Verify hostname in .dbcli
cat ~/.dbcli | grep host

# Test DNS resolution
ping your-hostname.com

# Use 127.0.0.1 instead of localhost if issues persist
dbcli init  # Re-initialize with correct host
```

---

### Permission Errors

#### "Permission denied: INSERT requires Read-Write or Admin"

Trying to write with Query-only permission level.

**Solution:** Re-initialize with higher permission level:

```bash
rm ~/.dbcli  # Remove old config
dbcli init  # Re-run, choose "read-write" or "admin"
```

#### "Permission denied: DELETE requires Admin"

Only Admin can delete rows (safety feature).

**Solution:** Re-initialize with Admin permission, or ask administrator.

```bash
dbcli init  # Choose "admin"
dbcli delete users --where "id=1" --force
```

---

### Query Errors

#### "Table not found: users"

Table doesn't exist or name is misspelled.

**Solution:**

```bash
# Show all available tables
dbcli list

# Check spelling and retry
dbcli query "SELECT * FROM user" --format json
```

#### "Syntax error near SELECT"

SQL syntax error in query.

**Solution:**

```bash
# Test query in native database client first
psql  # Or mysql
# SELECT * FROM users;  <- Test here first

# Then use in dbcli
dbcli query "SELECT * FROM users"
```

---

### Performance Issues

#### "Query returns 1000 rows instead of full result set"

Query-only permission auto-limits results for safety.

**Solution:** Increase permission level or fetch data in chunks:

```bash
# Re-initialize with higher permission
dbcli init  # Choose "read-write" or "admin"

# OR fetch data in chunks
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 0"
dbcli query "SELECT * FROM users LIMIT 100 OFFSET 100"
```

#### "CLI startup takes 30+ seconds (first run)"

npx is downloading and caching package.

**Solution:** This is normal on first run. Subsequent runs are instant:

```bash
npx dbcli init  # First run: 30s (downloads)
npx dbcli init  # Second run: <1s (cached)

# Or install globally for faster startup
npm install -g dbcli
dbcli init  # All future runs: <1s
```

---

### Cross-Platform Issues

#### Windows: "Command not found: dbcli"

npm .cmd wrapper not created or PATH not updated.

**Solutions:**

```bash
# Restart terminal to refresh PATH
# OR reinstall globally
npm uninstall -g dbcli
npm install -g dbcli

# Verify installation
where dbcli  # Windows command to find executable
```

#### macOS/Linux: "Permission denied: ./dist/cli.mjs"

Executable bit not set.

**Solution:**

```bash
chmod +x dist/cli.mjs
./dist/cli.mjs --help
```

---

## System Requirements

### Database Support

- **PostgreSQL:** 12.0+
- **MySQL:** 8.0+
- **MariaDB:** 10.5+

### Runtime

- **Node.js:** 18.0.0+
- **Bun:** 1.3.3+

### Platforms

- **macOS:** Intel and Apple Silicon
- **Linux:** x86_64 (Ubuntu, Debian, CentOS, etc.)
- **Windows:** 10+ (via npm .cmd wrapper)

---

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, testing, and release process.

---

## License

See LICENSE file for details.
