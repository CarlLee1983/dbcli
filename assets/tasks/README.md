# dbcli Agent Tasks (built-in)

Built-in task templates shipped with dbcli for AI agents.

## Resolution order

```
assets/tasks/             # builtin (lowest)
.dbcli-shared/tasks/      # shared, version-controlled
.dbcli/tasks/             # local, gitignored (highest)
```

A task with the same name in a higher tier overrides the lower one. Use this to
customize built-in workflows without modifying dbcli source.

## File format

Each task is a `.md` file with a YAML frontmatter block:

- `name` (required, must match the file path without `.md`)
- `description`, `tags`, `engines`
- `params` (map of name → `{ type, required?, default?, description?, enum? }`)
- `safety.mode` — only `plan-only` is supported in this version
- `safety.requires` — optional capability IDs; planning checks them against the
  local engine, permission, and agent-mode context before emitting a plan
- `steps[]` — each step is `{ type: command, command, reason?, risk? }`

Use block-style YAML (no inline `{ ... }` maps) — the built-in YAML parser does
not support inline maps.

The markdown body below the frontmatter is `Agent Notes` and is shown in
`dbcli skill tasks show <name>`.

Use `postgresql` for PostgreSQL. The legacy `postgres` engine spelling is read
as `postgresql`; legacy requirement names `blacklist-list` and `schema-check`
are rejected with their replacements, `blacklist.manage` and `schema.read`.
