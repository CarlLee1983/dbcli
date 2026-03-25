---
name: dbcli
description: Database CLI for AI agents. Use to query, modify, and manage database schemas with permission-based access control.
user-invocable: true
allowed-tools: Bash(dbcli *)
---

# dbcli Skill Documentation

Database CLI for AI agents with permission-based access control.

## Commands

### list

List tables

**Usage:** `dbcli list`

**Options:**
- `--format <type>`: Output format

**Permission required:** query-only or higher

**Example:**
```bash
dbcli list
```

```bash
dbcli list --format json
```

### schema

Show table schema

**Usage:** `dbcli schema`

**Options:**
- `--format <type>`: Output format

**Permission required:** query-only or higher

**Example:**
```bash
dbcli schema users
```

```bash
dbcli schema users --format json
```

### query

Execute SQL query

**Usage:** `dbcli query`

**Options:**
- `--format <type>`: Output format
- `--limit <number>`: Limit results

**Permission required:** query-only or higher

**Example:**
```bash
dbcli query "SELECT * FROM users LIMIT 10"
```

```bash
dbcli query "SELECT id, email FROM users" --format json
```

### insert

Insert data

**Usage:** `dbcli insert`

**Options:**
- `--data <json>`: Data to insert

**Permission required:** read-write or higher

**Example:**
```bash
dbcli insert users --data '{"name":"Alice","email":"alice@example.com"}'
```

### update

Update data

**Usage:** `dbcli update`

**Options:**
- `--where <condition>`: WHERE clause
- `--set <json>`: Fields to update

**Permission required:** read-write or higher

**Example:**
```bash
dbcli update users --where "id=1" --set '{"name":"Bob"}'
```

### delete

Delete data

**Usage:** `dbcli delete`

**Options:**
- `--where <condition>`: WHERE clause

**Permission required:** admin or higher

**Example:**
```bash
dbcli delete users --where "id=1" --force
```

### export

Export data

**Usage:** `dbcli export`

**Options:**
- `--format <format>`: json or csv
- `--output <path>`: Output file

**Permission required:** query-only or higher

**Example:**
```bash
dbcli export "SELECT * FROM users" --format csv --output users.csv
```

```bash
dbcli export "SELECT * FROM users" --format json | jq '.[]'
```

## Permission Levels

dbcli enforces permission-based access control:

- **Query-only**: Execute SELECT queries, list tables, view schemas, export data
- **Read-Write**: Query-only + INSERT and UPDATE operations
- **Admin**: Read-Write + DELETE operations

Your current permission level is set in `.dbcli` config.

## Tips for AI Agents

1. **Schema introspection first**: Start with `dbcli schema <table>` to understand structure
2. **Test with --dry-run**: Use `--dry-run` to preview SQL before executing
3. **Use --format json**: AI parsing of JSON is more reliable than tables
4. **Check permission level**: Review `.dbcli` to understand what operations are allowed