# Built-in snippets

Files under this directory are bundled with dbcli and resolved at runtime as
the `builtin` tier. Every file is a valid `.sql` snippet.

## Naming

- Single-engine variant: `<topic>.<engine>.sql` — loader derives key
  `@<dir>/<topic>` and engine from the suffix.
- Cross-engine variant: `<topic>.sql` with explicit
  `engine: [postgres, mysql]` in frontmatter.

## Override

Users can shadow any built-in snippet by placing a same-key file in
`.dbcli-shared/queries/` (team) or `.dbcli/queries/` (personal). Override is
per-engine: a local `connections.postgres.sql` only shadows the postgres
variant; the mysql variant is still served from builtin.
