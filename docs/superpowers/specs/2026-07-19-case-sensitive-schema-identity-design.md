# Case-Sensitive Schema Identity Design

**Status:** Approved design amendment for ORM Drift P1b
**Date:** 2026-07-19
**Scope:** Schema and table identity only. Column identifier semantics remain unchanged.

## Problem

The original ORM drift contract keyed normalized tables by lowercased table
names. PostgreSQL permits distinct quoted objects such as `users` and `"Users"`.
Lowercasing both identities merges valid catalog objects and irreversibly loses
schema information.

Schema storage and SQL identifier lookup are different concerns:

- Storage must preserve the exact schema and table names returned by the
  database catalog.
- An unquoted SQL identifier is folded to lowercase before lookup.
- A quoted SQL identifier is matched exactly.
- Quote state must come from the parsed SQL identifier. It must never be
  inferred from display text or catalog spelling.

## Data Model

`NormalizedSchema.tables` changes from a lowercased-name record to an array.
An array avoids encoded-key collisions and keeps the exact identity explicit.

```ts
export interface NormalizedTableIdentity {
  schema?: string
  table: string
}

export interface ParsedIdentifierPart {
  value: string
  quoted: boolean
}

export interface ParsedTableIdentifier {
  schema?: ParsedIdentifierPart
  table: ParsedIdentifierPart
}

export interface NormalizedTable {
  identity: NormalizedTableIdentity
  parsedIdentifier?: ParsedTableIdentifier
  columns: NormalizedColumn[]
  indexes: NormalizedIndex[]
  foreignKeys: NormalizedForeignKey[]
}

export interface NormalizedSchema {
  source: OrmSource
  defaultSchema?: string
  tables: NormalizedTable[]
  unparsed: UnparsedEntry[]
}
```

`NormalizedForeignKey.refTable` also uses `NormalizedTableIdentity`. A parsed DDL
foreign-key reference may preserve a `parsedRefIdentifier`; column names and
referenced column names remain strings in this phase.

`TableSchema` gains `schema?: string`. PostgreSQL catalog and schema-cache paths
populate it with the exact catalog schema name. Other engines may omit it until
their adapters can provide a reliable namespace.

## Identity Resolution

A single helper owns SQL identifier resolution:

```ts
resolveTableIdentifier(
  parsed: ParsedTableIdentifier,
  defaultSchema?: string
): NormalizedTableIdentity
```

Resolution rules:

1. Unquoted components are folded to lowercase.
2. Quoted components preserve their exact value.
3. An omitted schema uses `defaultSchema` when one is available.
4. Explicit schema and table components are resolved independently.
5. No resolver inspects capitalization or punctuation to guess whether a
   component was quoted.

The exact identity is the only comparison key. Internal maps may use a
collision-free serialized tuple such as `JSON.stringify([schema ?? null, table])`;
that encoding is private and is not part of the JSON escape-hatch contract.

## Adapter Behavior

### Database cache

The PostgreSQL adapter preserves catalog `table_schema` and `table_name` exactly
in `TableSchema`. `normalizeDbSchema` copies those values into
`NormalizedTable.identity` and does not set `parsedIdentifier`, because catalog
results do not describe the original SQL quoting.

The PostgreSQL normalized schema uses its configured/current namespace as
`defaultSchema`; the current adapter's existing scope is `public`.

### DDL

The DDL adapter reads quote state from the original SQL token stream rather than
inferring it from `node-sql-parser` display values. It stores both:

- the resolved exact storage `identity`; and
- the source `parsedIdentifier`, including `quoted` for every present component.

If a table target or referenced-table target cannot be parsed without losing
schema or quote state, the statement or definition is reported in `unparsed`
with `blocked:` semantics and no guessed table identity is emitted.

Examples:

| SQL input | Parsed table | Storage table |
| --- | --- | --- |
| `Users` | `{ value: "Users", quoted: false }` | `users` |
| `"Users"` | `{ value: "Users", quoted: true }` | `Users` |
| `Tenant.Users` | both unquoted | `tenant.users` |
| `"Tenant"."Users"` | both quoted | `Tenant.Users` |

### Prisma and normalized JSON

Prisma physical mappings such as `@@map("Users")` and JSON identities are already
exact storage identities. They do not create a fake `parsedIdentifier`.

The normalized JSON escape hatch uses the array contract and validates exact
identity fields. `parsedIdentifier` is optional, but when present its quote flags
are required.

## Comparison and Output

The compare engine resolves only parsed SQL identifiers, then compares exact
schema/table identity tuples. It never lowercases stored identities.

Unqualified ORM tables resolve against the DB schema's `defaultSchema`. Ignore
globs match the stable qualified display name and are case-sensitive. The
built-in `_prisma_migrations` ignore remains exact.

Drift entries and proposals use a qualified display name when a schema exists.
Report ordering is stable by schema, table, object, category, and detail.

Index drift retains the original structured `NormalizedIndex` until proposal
generation. Duplicate index signatures are emitted once. Proposal arguments are
shell-safe while preserving the documented unquoted strings for simple safe
tokens.

## Error Handling

- Parsed SQL with ambiguous or unavailable quote/schema information is blocked.
- Catalog identities are trusted as exact storage facts but never treated as
  evidence of quoting.
- Duplicate exact identities in one normalized schema are rejected or surfaced
  as `unparsed`; they are never silently overwritten.
- Existing ORM syntax, DDL syntax, and drift severity fail-closed behavior remain
  unchanged except where this amendment explicitly changes identity handling.

## Test Contract

Regression coverage must prove:

1. `public.users` and `public.Users` coexist in the DB cache and normalized
   schema.
2. DDL definitions for `users` and `"Users"` coexist.
3. Unquoted `Users` resolves to storage identity `users`.
4. Quoted `"Users"` resolves only to storage identity `Users`.
5. Quoted and unquoted schema-qualified components resolve independently.
6. Catalog spelling never creates inferred quote metadata.
7. JSON validation accepts the new array/identity contract and rejects missing
   identity fields or incomplete parsed identifiers.
8. Task 1–4 focused suites and Task 5 compare tests use the new contract.
9. Shell-safe proposal quoting, structural index proposal data, index
   deduplication, case-sensitive ignore matching, and stable report ordering are
   covered.
10. Snapshot-mode `dbcli diff` behavior remains unchanged.

## Non-Goals

- Quote-aware column lookup.
- Changing column, index-column, or referenced-column storage contracts.
- Expanding PostgreSQL discovery beyond the adapter's existing schema scope.
- Inferring quoting from catalog or Prisma display strings.
- Comparing foreign keys as a new ORM drift category in P1b.
