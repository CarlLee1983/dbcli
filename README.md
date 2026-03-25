# dbcli — Database CLI for AI Agents

A unified database CLI tool that enables AI agents (Claude Code, Gemini, Copilot, Cursor) to safely query, discover, and operate on databases.

## Quick Start

### Installation

```bash
bun install
```

### Development

Run the CLI in development mode:

```bash
bun run dev -- --help
bun run dev -- --version
```

### Testing

Run all tests:

```bash
bun test --run
```

### Build

Create a production executable:

```bash
bun run build
./dist/cli.mjs --help
```

## Features (Phase 2+)

- `dbcli init` — Initialize project with database configuration
- `dbcli list` — List all available tables
- `dbcli schema [table]` — View table structure and relationships
- `dbcli query "SQL"` — Execute SQL queries safely

## Requirements

- Bun >= 1.3.0
- Node.js >= 18 (for bundled executable compatibility)

---

This project is built with [Bun](https://bun.com) — a fast all-in-one JavaScript runtime.
