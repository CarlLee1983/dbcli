# `dbcli lint` (P1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `dbcli lint` — a static, schema-aware SQL anti-pattern advisor that reports findings with rewrite drafts and verify commands, never executing anything.

**Architecture:** A rule engine in `src/core/lint/` parses SQL with `node-sql-parser` (existing dependency, same wrapper pattern as `src/core/guide/missing-index/parse-sql.ts`), runs one-file-per-rule checks, and enriches schema-aware rules from the layered local cache under `.dbcli/schemas/` through the existing `SchemaLayeredLoader` abstraction. The existing global `--use <conn>` option selects the per-connection cache directory. A thin command layer (`src/commands/lint.ts`) reuses `resolveBulkInputs` from the explain bulk-runner for `@snippet` / `@file` / `--bulk` inputs, and wires audit + `--recovery` following the existing `plan.ts` / `schema.ts` patterns.

**Tech Stack:** Bun + TypeScript ESM, commander 13, node-sql-parser 5, zod (config already validated upstream), `bun test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-lint-and-orm-drift-design.md` §1.
- SQL engines only: `postgresql` / `mysql` / `mariadb`. Other systems → error message `dbcli lint requires a SQL connection (postgresql/mysql/mariadb), got: <system>` and exit 1.
- Never connect to the database. Schema data comes only from `.dbcli/schemas/` through `SchemaLayeredLoader`; `config.schema` is not a lint schema source.
- Preserve the existing global `--use <conn>` option and use it to select `.dbcli/schemas/<conn>/` for v2 configurations.
- Never execute or apply rewrites. `rewrite` is a draft. A verify/related command uses `dbcli explain --analyze "<sql>"` only when parser-backed structural analysis proves the complete statement read-only; otherwise it falls back to plain `dbcli explain "<sql>"`. The `explain --analyze` command independently enforces the same fail-closed boundary before adapter execution.
- Findings vocabulary: severity `info | warn | error`; skipped schema rules use reason strings starting with `blocked:`.
- Imports use the `@/` alias (existing tsconfig paths). All files ESM, no default exports (match existing command/core modules).
- Run `bun test <file>` after each RED/GREEN step; run `bun run lint` (eslint) before each commit if the repo script exists (`bun run --list` shows it) — fix warnings in touched files only.
- Commit messages: conventional commits, English subject fine, no attribution footer.
- Rule tests may be grouped into the three task-level files in this plan, but every rule must have its own clearly named, independently executable `test(...)` case covering its hit and no-hit behavior; schema-aware rules also cover cache-present and cache-unavailable behavior.

## Approved Specification Resolutions (2026-07-19)

- The design spec governs schema architecture: layered files under `.dbcli/schemas/` are loaded through `SchemaLayeredLoader`; references to `config.schema` in the original plan were an oversight.
- The design spec governs the CLI surface: `--use <conn>` remains available as the existing global option and selects the named connection plus its isolated schema cache.
- The grouped rule-test files in Tasks 3–5 are an approved plan-level organization choice, provided each rule retains clearly named, independently executable test cases.
- The `not-in-nullable` rule detects the actual SQL NULL hazard on the right-hand side of `NOT IN`: explicit NULL list items, nullable subquery projections, and other RHS expressions known nullable from schema facts. Nullable left-hand columns are not findings for this rule. A nullable projection is not reported when the subquery `WHERE` provably null-rejects that exact expression with `IS NOT NULL` directly or under `AND`; `OR` and ambiguous expressions remain conservative findings. Subquery remediation prefers filtering the projection with `IS NOT NULL`; `NOT EXISTS` is suggested only when correlation and semantics are unambiguous, and is never auto-rewritten by this rule.
- Safety refinement approved during final review: `--analyze` is suggested only for structurally proven read-only `SELECT` / SELECT-only CTE statements. DML, DDL, data-modifying CTEs, parse failures, and otherwise uncertain SQL receive plain `dbcli explain`; `explain --analyze` rejects them before any adapter call.

## File Structure (final state)

```
src/core/lint/
  types.ts        # LintFinding, LintReport, LintRule, LintRuleContext, severities
  parse.ts        # parseSingleStatement(sql, system) → ast | ParseFailure (mirrors missing-index/parse-sql.ts, allows any single statement)
  ast-utils.ts    # walkExpr, whereOf, collectTables, findingSpan helpers
  context.ts      # SchemaLayeredLoader-backed loadSchemaContext + in-memory buildSchemaContext
  engine.ts       # lintSql(sql, opts) → LintReport ; ALL_RULES registry
  rules/select-star.ts
  rules/non-sargable-where.ts
  rules/unanchored-like.ts
  rules/or-to-union.ts
  rules/implicit-cast.ts
  rules/not-in-nullable.ts
  rules/missing-limit-offset.ts
  rules/subquery-to-join.ts
  rules/distinct-groupby-abuse.ts
src/formatters/lint.ts
src/commands/lint.ts
src/program.ts                  # register lintCommand (modify)
tests/unit/core/lint/*.test.ts  # engine/context plus three grouped rule suites with one test case per rule
tests/unit/commands/lint.test.ts
tests/unit/formatters/lint.test.ts
```

> **AST caveat for the implementer:** node-sql-parser v5 AST shapes vary slightly by
> dialect (e.g. `SELECT *` may surface as `columns: '*'` in older code paths or as
> `[{ expr: { type: 'column_ref', column: '*' } }]`). The tests below are the oracle:
> if an assertion fails because the real AST differs from the code shown, `console.log(JSON.stringify(ast))`
> in the test, adapt the rule's AST access, and keep the test's *behavioral* assertion unchanged.

---

### Task 1: Lint types, parse wrapper, and AST helpers

**Files:**
- Create: `src/core/lint/types.ts`
- Create: `src/core/lint/parse.ts`
- Create: `src/core/lint/ast-utils.ts`
- Test: `tests/unit/core/lint/parse.test.ts`

**Interfaces:**
- Consumes: `SqlDatabaseSystem` from `@/adapters/types`.
- Produces (used by every later task):
  - `LintSeverity = 'info' | 'warn' | 'error'`
  - `LintFinding { rule: string; severity: LintSeverity; message: string; span: { start: number; end: number }; rewrite?: { sql: string; confidence: 'high' | 'medium' | 'low' }; verifyCommand?: string; schemaVerified: boolean }`
  - `LintReport { sql: string; label?: string; dialect: SqlDatabaseSystem; findings: LintFinding[]; skippedRules: { rule: string; reason: string }[]; relatedCommands: string[]; parseError?: string }`
  - `LintRuleContext { system: SqlDatabaseSystem; sql: string; ast: AstNode; schema: SchemaContext }` (SchemaContext lands in Task 2; declare it here as an interface)
  - `LintRule { name: string; requiresSchema: boolean; check(ctx: LintRuleContext): LintFinding[] }`
  - `parseSingleStatement(sql: string, system: SqlDatabaseSystem): AstNode` (throws `ParseFailure`)
  - `walkExpr(node, visit)`, `whereOf(ast)`, `collectTables(ast)`, `findingSpan(sql, fragment)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/lint/parse.test.ts
import { describe, test, expect } from 'bun:test'
import { parseSingleStatement, ParseFailure } from '@/core/lint/parse'
import { collectTables, whereOf, findingSpan } from '@/core/lint/ast-utils'

describe('lint parse', () => {
  test('parses a single SELECT into an ast with type select', () => {
    const ast = parseSingleStatement('SELECT id FROM users WHERE id = 1', 'postgresql')
    expect((ast as { type?: string }).type).toBe('select')
  })

  test('accepts non-SELECT single statements (rules will no-op)', () => {
    const ast = parseSingleStatement("UPDATE users SET name = 'x' WHERE id = 1", 'mysql')
    expect((ast as { type?: string }).type).toBe('update')
  })

  test('throws ParseFailure on invalid SQL', () => {
    expect(() => parseSingleStatement('SELEC oops', 'postgresql')).toThrow(ParseFailure)
  })

  test('throws ParseFailure on multiple statements', () => {
    expect(() => parseSingleStatement('SELECT 1; SELECT 2', 'postgresql')).toThrow(ParseFailure)
  })

  test('collectTables returns FROM tables', () => {
    const ast = parseSingleStatement(
      'SELECT u.id FROM users u JOIN orders o ON o.user_id = u.id',
      'postgresql'
    )
    expect(collectTables(ast)).toEqual(['users', 'orders'])
  })

  test('whereOf returns the where node or null', () => {
    const ast = parseSingleStatement('SELECT id FROM users', 'postgresql')
    expect(whereOf(ast)).toBeNull()
  })

  test('findingSpan locates a fragment case-insensitively, else whole string', () => {
    expect(findingSpan('SELECT * FROM users', 'select *')).toEqual({ start: 0, end: 8 })
    expect(findingSpan('SELECT * FROM users', 'nope')).toEqual({ start: 0, end: 19 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/lint/parse.test.ts`
Expected: FAIL — `Cannot find module '@/core/lint/parse'`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/lint/types.ts
import type { SqlDatabaseSystem, TableSchema, ColumnSchema } from '@/adapters/types'

export type LintSeverity = 'info' | 'warn' | 'error'
export type AstNode = Record<string, unknown>

export interface LintFinding {
  rule: string
  severity: LintSeverity
  message: string
  span: { start: number; end: number }
  rewrite?: { sql: string; confidence: 'high' | 'medium' | 'low' }
  verifyCommand?: string
  schemaVerified: boolean
}

export interface LintReport {
  sql: string
  label?: string
  dialect: SqlDatabaseSystem
  findings: LintFinding[]
  skippedRules: { rule: string; reason: string }[]
  relatedCommands: string[]
  parseError?: string
}

/** Read-only view over the local schema cache. Implemented in context.ts. */
export interface SchemaContext {
  available: boolean
  getTable(name: string): TableSchema | undefined
  /** Resolve a column across candidate tables; first match wins. */
  resolveColumn(
    tables: string[],
    column: string
  ): { table: string; column: ColumnSchema } | undefined
}

export interface LintRuleContext {
  system: SqlDatabaseSystem
  sql: string
  ast: AstNode
  schema: SchemaContext
}

export interface LintRule {
  name: string
  requiresSchema: boolean
  check(ctx: LintRuleContext): LintFinding[]
}

export function verifyWith(sql: string, system: SqlDatabaseSystem): string {
  const analyze = isProvenReadOnlySql(sql, system) ? ' --analyze' : ''
  return `dbcli explain${analyze} "${sql.replace(/"/g, '\\"')}"`
}
```

```ts
// src/core/lint/parse.ts
/**
 * node-sql-parser wrapper for lint. Unlike missing-index/parse-sql.ts this
 * accepts any single statement type — individual rules guard on ast.type.
 */
import { Parser } from 'node-sql-parser'
import type { SqlDatabaseSystem } from '@/adapters/types'
import type { AstNode } from './types'

export class ParseFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseFailure'
  }
}

const DIALECT: Record<SqlDatabaseSystem, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'Postgresql',
}

const parser = new Parser()

export function parseSingleStatement(sql: string, system: SqlDatabaseSystem): AstNode {
  let ast: unknown
  try {
    ast = parser.astify(sql, { database: DIALECT[system] })
  } catch (e) {
    throw new ParseFailure(`SQL parse failed: ${(e as Error).message}`)
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw new ParseFailure('Only a single SQL statement is supported')
    }
    ast = ast[0]
  }
  if (!ast || typeof ast !== 'object') {
    throw new ParseFailure('SQL parse produced no statement')
  }
  return ast as AstNode
}
```

```ts
// src/core/lint/ast-utils.ts
import type { AstNode } from './types'

/** Depth-first walk over expression-ish nodes (left/right/args/value/expr arrays). */
export function walkExpr(node: unknown, visit: (n: AstNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walkExpr(item, visit)
    return
  }
  const n = node as AstNode
  visit(n)
  for (const key of ['left', 'right', 'args', 'value', 'expr', 'columns', 'where', 'ast']) {
    if (key in n) walkExpr(n[key], visit)
  }
}

export function whereOf(ast: AstNode): AstNode | null {
  const where = ast.where
  return where && typeof where === 'object' ? (where as AstNode) : null
}

export function collectTables(ast: AstNode): string[] {
  const from = ast.from
  if (!Array.isArray(from)) return []
  const tables: string[] = []
  for (const f of from) {
    const table = (f as AstNode).table
    if (typeof table === 'string') tables.push(table)
  }
  return tables
}

/** Best-effort span: case-insensitive substring match, else the whole statement. */
export function findingSpan(sql: string, fragment: string): { start: number; end: number } {
  const idx = sql.toLowerCase().indexOf(fragment.toLowerCase())
  if (idx === -1) return { start: 0, end: sql.length }
  return { start: idx, end: idx + fragment.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/lint/parse.test.ts`
Expected: PASS (7 tests). If `collectTables` fails, log the real `ast.from` shape and adapt the accessor, keeping the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/core/lint/types.ts src/core/lint/parse.ts src/core/lint/ast-utils.ts tests/unit/core/lint/parse.test.ts
git commit -m "feat: add lint core types, parse wrapper, and AST helpers"
```

---

### Task 2: Schema context

**Files:**
- Create: `src/core/lint/context.ts`
- Test: `tests/unit/core/lint/context.test.ts`

**Interfaces:**
- Consumes: `SchemaContext`, `TableSchema` (Task 1 / `@/adapters/types`) and `SchemaLayeredLoader` from `@/core/schema-loader`.
- Produces:
  - `buildSchemaContext(schema: Record<string, TableSchema> | undefined): SchemaContext` for rule/engine unit tests.
  - `loadSchemaContext(dbcliPath: string, connectionName?: string): Promise<SchemaContext>` as the production path. It loads only `.dbcli/schemas/` (or `.dbcli/schemas/<connectionName>/`) through `SchemaLayeredLoader`; it never reads `config.schema` and never connects to a database.
  - Rules call `ctx.schema.available` / `resolveColumn`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/lint/context.test.ts
import { describe, test, expect } from 'bun:test'
import { buildSchemaContext, loadSchemaContext } from '@/core/lint/context'
import { SchemaWriter } from '@/core/schema-writer'
import type { TableSchema } from '@/adapters/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const users: TableSchema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'email', type: 'varchar(255)', nullable: true },
  ],
}

describe('buildSchemaContext', () => {
  test('unavailable when schema is undefined or empty', () => {
    expect(buildSchemaContext(undefined).available).toBe(false)
    expect(buildSchemaContext({}).available).toBe(false)
  })

  test('resolves table and column case-insensitively', () => {
    const ctx = buildSchemaContext({ users })
    expect(ctx.available).toBe(true)
    expect(ctx.getTable('USERS')?.name).toBe('users')
    expect(ctx.resolveColumn(['users'], 'EMAIL')?.column.type).toBe('varchar(255)')
  })

  test('resolveColumn returns undefined for unknown table or column', () => {
    const ctx = buildSchemaContext({ users })
    expect(ctx.resolveColumn(['orders'], 'id')).toBeUndefined()
    expect(ctx.resolveColumn(['users'], 'nope')).toBeUndefined()
  })

  test('loads the named connection from the layered .dbcli/schemas cache', async () => {
    const dbcliPath = await mkdtemp(join(tmpdir(), 'dbcli-lint-schema-'))
    try {
      await new SchemaWriter(dbcliPath).save({ users }, 'staging')
      const ctx = await loadSchemaContext(dbcliPath, 'staging')
      expect(ctx.available).toBe(true)
      expect(ctx.getTable('users')?.columns[0]?.name).toBe('id')
    } finally {
      await rm(dbcliPath, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/lint/context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/lint/context.ts
import type { TableSchema } from '@/adapters/types'
import { SchemaLayeredLoader } from '@/core/schema-loader'
import type { SchemaContext } from './types'

export function buildSchemaContext(
  schema: Record<string, TableSchema> | undefined
): SchemaContext {
  const tables = new Map<string, TableSchema>()
  for (const [name, table] of Object.entries(schema ?? {})) {
    tables.set(name.toLowerCase(), table)
  }
  return {
    available: tables.size > 0,
    getTable(name) {
      return tables.get(name.toLowerCase())
    },
    resolveColumn(candidateTables, column) {
      for (const t of candidateTables) {
        const table = tables.get(t.toLowerCase())
        const col = table?.columns.find((c) => c.name.toLowerCase() === column.toLowerCase())
        if (table && col) return { table: table.name, column: col }
      }
      return undefined
    },
  }
}

export async function loadSchemaContext(
  dbcliPath: string,
  connectionName?: string
): Promise<SchemaContext> {
  const loader = new SchemaLayeredLoader(dbcliPath, { connectionName })
  const { cache, index } = await loader.initialize()
  const schema: Record<string, TableSchema> = {}
  for (const tableName of Object.keys(index?.tables ?? {})) {
    const table = await cache.getTableSchema(tableName)
    if (table) schema[tableName] = table
  }
  return buildSchemaContext(schema)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/lint/context.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/lint/context.ts tests/unit/core/lint/context.test.ts
git commit -m "feat: add lint schema context over local schema cache"
```

---

### Task 3: Static rules — select-star, unanchored-like, missing-limit-offset

**Files:**
- Create: `src/core/lint/rules/select-star.ts`
- Create: `src/core/lint/rules/unanchored-like.ts`
- Create: `src/core/lint/rules/missing-limit-offset.ts`
- Test: `tests/unit/core/lint/rules-static-basic.test.ts`

**Interfaces:**
- Consumes: `LintRule`, `LintRuleContext`, `LintFinding`, `verifyWith` (Task 1); helpers from `ast-utils`; `SchemaContext` (Task 2, select-star only, optionally).
- Produces: `selectStarRule: LintRule` (name `select-star`), `unanchoredLikeRule: LintRule` (name `unanchored-like`), `missingLimitOffsetRule: LintRule` (name `missing-limit-offset`). Task 6 imports these into `ALL_RULES`.

Test helper used by all rule test files — define it inline in each test file (each file must be runnable standalone):

```ts
// (top of each rule test file)
import { parseSingleStatement } from '@/core/lint/parse'
import { buildSchemaContext } from '@/core/lint/context'
import type { LintRuleContext } from '@/core/lint/types'
import type { TableSchema } from '@/adapters/types'

function ctxFor(
  sql: string,
  schema?: Record<string, TableSchema>
): LintRuleContext {
  return {
    system: 'postgresql',
    sql,
    ast: parseSingleStatement(sql, 'postgresql'),
    schema: buildSchemaContext(schema),
  }
}
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/lint/rules-static-basic.test.ts
import { describe, test, expect } from 'bun:test'
import { selectStarRule } from '@/core/lint/rules/select-star'
import { unanchoredLikeRule } from '@/core/lint/rules/unanchored-like'
import { missingLimitOffsetRule } from '@/core/lint/rules/missing-limit-offset'
// … ctxFor helper as shown in the task header …

describe('select-star', () => {
  test('flags SELECT *', () => {
    const findings = selectStarRule.check(ctxFor('SELECT * FROM users'))
    expect(findings).toHaveLength(1)
    expect(findings[0].rule).toBe('select-star')
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('with schema + single table, offers explicit-column rewrite', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'email', type: 'varchar(255)', nullable: true },
      ],
    }
    const findings = selectStarRule.check(ctxFor('SELECT * FROM users', { users }))
    expect(findings[0].rewrite?.sql).toBe('SELECT id, email FROM users')
    expect(findings[0].rewrite?.confidence).toBe('high')
    expect(findings[0].verifyCommand).toContain('dbcli explain --analyze')
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('does not flag explicit columns', () => {
    expect(selectStarRule.check(ctxFor('SELECT id FROM users'))).toHaveLength(0)
  })

  test('no-ops on non-SELECT', () => {
    expect(
      selectStarRule.check(ctxFor("UPDATE users SET name = 'x' WHERE id = 1"))
    ).toHaveLength(0)
  })
})

describe('unanchored-like', () => {
  test("flags LIKE '%...'", () => {
    const findings = unanchoredLikeRule.check(
      ctxFor("SELECT id FROM users WHERE email LIKE '%@x.com'")
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
  })

  test("does not flag anchored LIKE 'abc%'", () => {
    expect(
      unanchoredLikeRule.check(ctxFor("SELECT id FROM users WHERE email LIKE 'a%'"))
    ).toHaveLength(0)
  })
})

describe('missing-limit-offset', () => {
  test('flags OFFSET >= 1000', () => {
    const findings = missingLimitOffsetRule.check(
      ctxFor('SELECT id FROM users ORDER BY id LIMIT 20 OFFSET 5000')
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
    expect(findings[0].message).toContain('keyset')
  })

  test('does not flag small offsets or no offset', () => {
    expect(
      missingLimitOffsetRule.check(ctxFor('SELECT id FROM users LIMIT 20 OFFSET 40'))
    ).toHaveLength(0)
    expect(missingLimitOffsetRule.check(ctxFor('SELECT id FROM users LIMIT 20'))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/lint/rules-static-basic.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/core/lint/rules/select-star.ts
import type { LintRule, LintFinding, AstNode } from '../types'
import { collectTables, findingSpan } from '../ast-utils'
import { verifyWith } from '../types'

function isStar(ast: AstNode): boolean {
  const cols = ast.columns
  if (cols === '*') return true
  if (!Array.isArray(cols)) return false
  return cols.some((c) => {
    const expr = (c as AstNode).expr as AstNode | undefined
    return expr?.type === 'column_ref' && expr?.column === '*'
  })
}

export const selectStarRule: LintRule = {
  name: 'select-star',
  requiresSchema: false,
  check(ctx) {
    if (ctx.ast.type !== 'select' || !isStar(ctx.ast)) return []
    const finding: LintFinding = {
      rule: 'select-star',
      severity: 'warn',
      message:
        'SELECT * fetches every column: more I/O, breaks covering indexes, and couples code to schema order. List the columns you need.',
      span: findingSpan(ctx.sql, 'select *'),
      schemaVerified: false,
    }
    const tables = collectTables(ctx.ast)
    if (ctx.schema.available && tables.length === 1) {
      const table = ctx.schema.getTable(tables[0])
      if (table && table.columns.length > 0) {
        const cols = table.columns.map((c) => c.name).join(', ')
        const rewritten = ctx.sql.replace(/\*/, cols)
        finding.rewrite = { sql: rewritten, confidence: 'high' }
        finding.verifyCommand = verifyWith(rewritten)
        finding.schemaVerified = true
      }
    }
    return [finding]
  },
}
```

```ts
// src/core/lint/rules/unanchored-like.ts
import type { LintRule, LintFinding, AstNode } from '../types'
import { walkExpr, whereOf, findingSpan } from '../ast-utils'

export const unanchoredLikeRule: LintRule = {
  name: 'unanchored-like',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []
    const findings: LintFinding[] = []
    walkExpr(where, (n) => {
      const op = typeof n.operator === 'string' ? n.operator.toUpperCase() : ''
      if (op !== 'LIKE' && op !== 'ILIKE') return
      const right = n.right as AstNode | undefined
      const pattern = right?.value
      if (typeof pattern === 'string' && pattern.startsWith('%')) {
        findings.push({
          rule: 'unanchored-like',
          severity: 'warn',
          message: `LIKE '${pattern}' starts with a wildcard, so no B-tree index can be used (full scan). Anchor the prefix, or use a trigram/full-text index.`,
          span: findingSpan(ctx.sql, pattern),
          schemaVerified: false,
        })
      }
    })
    return findings
  },
}
```

```ts
// src/core/lint/rules/missing-limit-offset.ts
import type { LintRule, AstNode } from '../types'
import { findingSpan } from '../ast-utils'

const DEEP_OFFSET = 1000

export const missingLimitOffsetRule: LintRule = {
  name: 'missing-limit-offset',
  requiresSchema: false,
  check(ctx) {
    if (ctx.ast.type !== 'select') return []
    const limit = ctx.ast.limit as AstNode | undefined
    const values = Array.isArray(limit?.value) ? (limit?.value as AstNode[]) : []
    // node-sql-parser: `LIMIT n OFFSET m` → value [n, m] with seperator 'offset';
    // MySQL `LIMIT m, n` → value [m, n] with seperator ','.
    if (values.length < 2) return []
    const sep = limit?.seperator
    const offsetNode = sep === ',' ? values[0] : values[1]
    const offset = typeof offsetNode?.value === 'number' ? offsetNode.value : 0
    if (offset < DEEP_OFFSET) return []
    return [
      {
        rule: 'missing-limit-offset',
        severity: 'info',
        message: `OFFSET ${offset} scans and discards ${offset} rows on every page. For deep pagination use keyset pagination: WHERE (sort_key) > (last seen value) ORDER BY sort_key LIMIT n.`,
        span: findingSpan(ctx.sql, String(offset)),
        schemaVerified: false,
      },
    ]
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/lint/rules-static-basic.test.ts`
Expected: PASS (8 tests). Adapt AST accessors if a shape assertion fails (log the ast), keep behavioral assertions.

- [ ] **Step 5: Commit**

```bash
git add src/core/lint/rules/select-star.ts src/core/lint/rules/unanchored-like.ts src/core/lint/rules/missing-limit-offset.ts tests/unit/core/lint/rules-static-basic.test.ts
git commit -m "feat: add select-star, unanchored-like, missing-limit-offset lint rules"
```

---

### Task 4: Static rules — non-sargable-where, or-to-union, subquery-to-join, distinct-groupby-abuse

**Files:**
- Create: `src/core/lint/rules/non-sargable-where.ts`
- Create: `src/core/lint/rules/or-to-union.ts`
- Create: `src/core/lint/rules/subquery-to-join.ts`
- Create: `src/core/lint/rules/distinct-groupby-abuse.ts`
- Test: `tests/unit/core/lint/rules-static-structure.test.ts`

**Interfaces:**
- Consumes: Task 1 types/helpers (same `ctxFor` inline helper as Task 3).
- Produces: `nonSargableWhereRule`, `orToUnionRule`, `subqueryToJoinRule`, `distinctGroupbyAbuseRule` — all `LintRule`, names matching their file names.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/lint/rules-static-structure.test.ts
import { describe, test, expect } from 'bun:test'
import { nonSargableWhereRule } from '@/core/lint/rules/non-sargable-where'
import { orToUnionRule } from '@/core/lint/rules/or-to-union'
import { subqueryToJoinRule } from '@/core/lint/rules/subquery-to-join'
import { distinctGroupbyAbuseRule } from '@/core/lint/rules/distinct-groupby-abuse'
// … ctxFor helper as in Task 3 …

describe('non-sargable-where', () => {
  test('flags function wrapping a column in a comparison', () => {
    const findings = nonSargableWhereRule.check(
      ctxFor("SELECT id FROM users WHERE LOWER(email) = 'a@x.com'")
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('LOWER')
  })

  test('flags arithmetic on a column in a comparison', () => {
    const findings = nonSargableWhereRule.check(
      ctxFor('SELECT id FROM orders WHERE amount * 100 > 5000')
    )
    expect(findings).toHaveLength(1)
  })

  test('does not flag a bare column comparison', () => {
    expect(
      nonSargableWhereRule.check(ctxFor("SELECT id FROM users WHERE email = 'a@x.com'"))
    ).toHaveLength(0)
  })

  test('does not flag functions over literals on the value side', () => {
    expect(
      nonSargableWhereRule.check(ctxFor("SELECT id FROM users WHERE created_at > NOW()"))
    ).toHaveLength(0)
  })
})

describe('or-to-union', () => {
  test('flags top-level OR across different columns', () => {
    const findings = orToUnionRule.check(
      ctxFor("SELECT id FROM users WHERE email = 'a' OR name = 'b'")
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
    expect(findings[0].message).toContain('UNION ALL')
  })

  test('does not flag OR on the same column (IN-able)', () => {
    expect(
      orToUnionRule.check(ctxFor("SELECT id FROM users WHERE email = 'a' OR email = 'b'"))
    ).toHaveLength(0)
  })
})

describe('subquery-to-join', () => {
  test('flags IN (SELECT …)', () => {
    const findings = subqueryToJoinRule.check(
      ctxFor('SELECT id FROM users WHERE id IN (SELECT user_id FROM orders)')
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('JOIN')
  })

  test('does not flag IN over a literal list', () => {
    expect(
      subqueryToJoinRule.check(ctxFor('SELECT id FROM users WHERE id IN (1, 2, 3)'))
    ).toHaveLength(0)
  })
})

describe('distinct-groupby-abuse', () => {
  test('flags DISTINCT combined with GROUP BY', () => {
    const findings = distinctGroupbyAbuseRule.check(
      ctxFor('SELECT DISTINCT user_id FROM orders GROUP BY user_id')
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
  })

  test('does not flag plain DISTINCT or plain GROUP BY', () => {
    expect(
      distinctGroupbyAbuseRule.check(ctxFor('SELECT DISTINCT user_id FROM orders'))
    ).toHaveLength(0)
    expect(
      distinctGroupbyAbuseRule.check(ctxFor('SELECT user_id FROM orders GROUP BY user_id'))
    ).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/lint/rules-static-structure.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/core/lint/rules/non-sargable-where.ts
import type { LintRule, LintFinding, AstNode } from '../types'
import { walkExpr, whereOf, findingSpan } from '../ast-utils'

const COMPARISONS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'IN'])

function containsColumnRef(node: unknown): boolean {
  let found = false
  walkExpr(node, (n) => {
    if (n.type === 'column_ref') found = true
  })
  return found
}

/** True when the node itself computes over a column (function call or arithmetic). */
function computesOverColumn(node: AstNode | undefined): { kind: string } | null {
  if (!node) return null
  if (node.type === 'function' && containsColumnRef(node.args)) {
    const nameNode = node.name as AstNode | undefined
    const nameList = nameNode?.name
    const fname = Array.isArray(nameList)
      ? String((nameList[0] as AstNode)?.value ?? 'function')
      : 'function'
    return { kind: fname.toUpperCase() }
  }
  if (
    node.type === 'binary_expr' &&
    ['+', '-', '*', '/'].includes(String(node.operator)) &&
    containsColumnRef(node)
  ) {
    return { kind: `arithmetic (${node.operator})` }
  }
  return null
}

export const nonSargableWhereRule: LintRule = {
  name: 'non-sargable-where',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []
    const findings: LintFinding[] = []
    walkExpr(where, (n) => {
      if (n.type !== 'binary_expr') return
      const op = String(n.operator).toUpperCase()
      if (!COMPARISONS.has(op)) return
      const hit = computesOverColumn(n.left as AstNode)
      if (hit) {
        findings.push({
          rule: 'non-sargable-where',
          severity: 'warn',
          message: `${hit.kind} applied to a column on the left of '${op}' prevents index use (non-sargable). Move the computation to the literal side, use a generated/expression index, or restate the predicate.`,
          span: findingSpan(ctx.sql, 'where'),
          schemaVerified: false,
        })
      }
    })
    return findings
  },
}
```

```ts
// src/core/lint/rules/or-to-union.ts
import type { LintRule, AstNode } from '../types'
import { whereOf, findingSpan } from '../ast-utils'

function columnOf(side: AstNode | undefined): string | null {
  if (!side) return null
  if (side.type === 'column_ref') return String(side.column)
  if (side.type === 'binary_expr') return columnOf(side.left as AstNode)
  return null
}

export const orToUnionRule: LintRule = {
  name: 'or-to-union',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where || where.type !== 'binary_expr' || String(where.operator).toUpperCase() !== 'OR') {
      return []
    }
    const leftCol = columnOf(where.left as AstNode)
    const rightCol = columnOf(where.right as AstNode)
    if (!leftCol || !rightCol || leftCol === rightCol) return []
    return [
      {
        rule: 'or-to-union',
        severity: 'info',
        message: `OR across different columns (${leftCol} / ${rightCol}) often defeats index selection. Consider rewriting as two indexed queries combined with UNION ALL (dedupe with UNION if rows can overlap).`,
        span: findingSpan(ctx.sql, ' or '),
        schemaVerified: false,
      },
    ]
  },
}
```

```ts
// src/core/lint/rules/subquery-to-join.ts
import type { LintRule, LintFinding, AstNode } from '../types'
import { walkExpr, whereOf, findingSpan } from '../ast-utils'

function isSubquery(node: unknown): boolean {
  let found = false
  walkExpr(node, (n) => {
    if (n.type === 'select') found = true
  })
  return found
}

export const subqueryToJoinRule: LintRule = {
  name: 'subquery-to-join',
  requiresSchema: false,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []
    const findings: LintFinding[] = []
    walkExpr(where, (n) => {
      if (n.type !== 'binary_expr' || String(n.operator).toUpperCase() !== 'IN') return
      if (!isSubquery(n.right)) return
      findings.push({
        rule: 'subquery-to-join',
        severity: 'info',
        message:
          'IN (SELECT …) may be executed as a dependent subquery on some planners. Consider an equivalent JOIN or EXISTS and compare plans with explain.',
        span: findingSpan(ctx.sql, 'in ('),
        schemaVerified: false,
      })
    })
    return findings
  },
}
```

```ts
// src/core/lint/rules/distinct-groupby-abuse.ts
import type { LintRule } from '../types'
import { findingSpan } from '../ast-utils'

export const distinctGroupbyAbuseRule: LintRule = {
  name: 'distinct-groupby-abuse',
  requiresSchema: false,
  check(ctx) {
    if (ctx.ast.type !== 'select') return []
    const hasDistinct = Boolean(ctx.ast.distinct)
    const groupby = ctx.ast.groupby
    const hasGroupBy = Array.isArray(groupby)
      ? groupby.length > 0
      : Boolean((groupby as Record<string, unknown> | null)?.columns)
    if (!hasDistinct || !hasGroupBy) return []
    return [
      {
        rule: 'distinct-groupby-abuse',
        severity: 'warn',
        message:
          'DISTINCT combined with GROUP BY is redundant: GROUP BY already produces unique groups. Drop DISTINCT (or drop GROUP BY if no aggregates are used).',
        span: findingSpan(ctx.sql, 'distinct'),
        schemaVerified: false,
      },
    ]
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/lint/rules-static-structure.test.ts`
Expected: PASS (10 tests). Same AST-adaptation rule as before. Note: `distinct` in node-sql-parser may be `{ type: 'DISTINCT' }` or the string `'DISTINCT'` — `Boolean()` covers both; `groupby` may be an array or `{ columns: [...] }` — the code handles both.

- [ ] **Step 5: Commit**

```bash
git add src/core/lint/rules/non-sargable-where.ts src/core/lint/rules/or-to-union.ts src/core/lint/rules/subquery-to-join.ts src/core/lint/rules/distinct-groupby-abuse.ts tests/unit/core/lint/rules-static-structure.test.ts
git commit -m "feat: add non-sargable, or-to-union, subquery, distinct-groupby lint rules"
```

---

### Task 5: Schema-aware rules — implicit-cast, not-in-nullable

**Files:**
- Create: `src/core/lint/rules/implicit-cast.ts`
- Create: `src/core/lint/rules/not-in-nullable.ts`
- Test: `tests/unit/core/lint/rules-schema-aware.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`SchemaContext.resolveColumn`, `collectTables`).
- Produces: `implicitCastRule`, `notInNullableRule` — both with `requiresSchema: true`. The engine (Task 6) skips `requiresSchema` rules when `!schema.available` and records them in `skippedRules`; therefore these rules may assume `ctx.schema.available === true`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/lint/rules-schema-aware.test.ts
import { describe, test, expect } from 'bun:test'
import { implicitCastRule } from '@/core/lint/rules/implicit-cast'
import { notInNullableRule } from '@/core/lint/rules/not-in-nullable'
// … ctxFor helper as in Task 3 …

const schema = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'email', type: 'varchar(255)', nullable: true },
      { name: 'ref_code', type: 'varchar(32)', nullable: true },
      { name: 'nullable_number', type: 'integer', nullable: true },
    ],
  },
  blocked_users: {
    name: 'blocked_users',
    columns: [
      { name: 'id', type: 'integer', nullable: false },
      { name: 'email', type: 'varchar(255)', nullable: true },
    ],
  },
} satisfies Record<string, import('@/adapters/types').TableSchema>

describe('implicit-cast', () => {
  test('flags string literal compared to numeric column', () => {
    const findings = implicitCastRule.check(
      ctxFor("SELECT id FROM users WHERE id = '42'", schema)
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].schemaVerified).toBe(true)
    expect(findings[0].rewrite?.sql).toContain('id = 42')
  })

  test('flags number literal compared to string column', () => {
    const findings = implicitCastRule.check(
      ctxFor('SELECT id FROM users WHERE ref_code = 12345', schema)
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('ref_code')
  })

  test('does not flag matching types', () => {
    expect(implicitCastRule.check(ctxFor('SELECT id FROM users WHERE id = 42', schema))).toHaveLength(0)
    expect(
      implicitCastRule.check(ctxFor("SELECT id FROM users WHERE email = 'a@x.com'", schema))
    ).toHaveLength(0)
  })

  test('ignores columns not present in schema', () => {
    expect(
      implicitCastRule.check(ctxFor("SELECT id FROM users WHERE ghost = '1'", schema))
    ).toHaveLength(0)
  })
})

describe('not-in-nullable', () => {
  test('flags an explicit NULL value in the NOT IN list', () => {
    const findings = notInNullableRule.check(
      ctxFor('SELECT id FROM users WHERE id NOT IN (1, NULL, 2)', schema)
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('NULL')
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('flags a subquery whose projected column is nullable', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE email NOT IN (SELECT email FROM blocked_users)',
        schema
      )
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('IS NOT NULL')
    expect(findings[0].message).toContain('NOT EXISTS')
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('flags another RHS expression known nullable from schema', () => {
    const findings = notInNullableRule.check(
      ctxFor('SELECT id FROM users WHERE id NOT IN (1, nullable_number)', schema)
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('right-hand')
  })

  test('does not flag a non-null literal list or non-null subquery projection', () => {
    expect(
      notInNullableRule.check(ctxFor('SELECT id FROM users WHERE id NOT IN (1, 2)', schema))
    ).toHaveLength(0)
    expect(
      notInNullableRule.check(
        ctxFor('SELECT id FROM users WHERE id NOT IN (SELECT id FROM blocked_users)', schema)
      )
    ).toHaveLength(0)
  })

  test('does not confuse a nullable left-hand column with the RHS NULL hazard', () => {
    expect(
      notInNullableRule.check(
        ctxFor("SELECT id FROM users WHERE email NOT IN ('a', 'b')", schema)
      )
    ).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/lint/rules-schema-aware.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// src/core/lint/rules/implicit-cast.ts
import type { LintRule, LintFinding, AstNode } from '../types'
import { walkExpr, whereOf, collectTables, findingSpan } from '../ast-utils'
import { verifyWith } from '../types'

const NUMERIC = /int|serial|decimal|numeric|float|double|real|bigint|smallint/i
const TEXTUAL = /char|text|uuid|enum/i

function columnKind(type: string): 'number' | 'string' | 'other' {
  if (NUMERIC.test(type)) return 'number'
  if (TEXTUAL.test(type)) return 'string'
  return 'other'
}

function literalKind(node: AstNode | undefined): 'number' | 'string' | null {
  if (!node) return null
  if (node.type === 'number') return 'number'
  if (node.type === 'single_quote_string' || node.type === 'string') return 'string'
  return null
}

export const implicitCastRule: LintRule = {
  name: 'implicit-cast',
  requiresSchema: true,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []
    const tables = collectTables(ctx.ast)
    const findings: LintFinding[] = []
    walkExpr(where, (n) => {
      if (n.type !== 'binary_expr') return
      const op = String(n.operator)
      if (!['=', '!=', '<>', '>', '>=', '<', '<='].includes(op)) return
      const left = n.left as AstNode | undefined
      if (left?.type !== 'column_ref') return
      const litKind = literalKind(n.right as AstNode)
      if (!litKind) return
      const resolved = ctx.schema.resolveColumn(tables, String(left.column))
      if (!resolved) return
      const colKind = columnKind(resolved.column.type)
      if (colKind === 'other' || colKind === litKind) return

      const finding: LintFinding = {
        rule: 'implicit-cast',
        severity: 'warn',
        message: `Column '${resolved.column.name}' is ${resolved.column.type} but is compared to a ${litKind} literal — the implicit cast can disable index use on '${resolved.column.name}'. Use a ${colKind} literal.`,
        span: findingSpan(ctx.sql, String(left.column)),
        schemaVerified: true,
      }
      // High-confidence rewrite only for string-literal-vs-numeric-column: unquote.
      if (colKind === 'number' && litKind === 'string') {
        const raw = String((n.right as AstNode).value)
        if (/^\d+(\.\d+)?$/.test(raw)) {
          const rewritten = ctx.sql
            .replace(`'${raw}'`, raw)
            .replace(`"${raw}"`, raw)
          finding.rewrite = { sql: rewritten, confidence: 'high' }
          finding.verifyCommand = verifyWith(rewritten)
        }
      }
      findings.push(finding)
    })
    return findings
  },
}
```

```ts
// src/core/lint/rules/not-in-nullable.ts
// Required implementation behavior:
// 1. Walk WHERE for binary_expr nodes whose operator is NOT IN.
// 2. Inspect only n.right. A nullable n.left is not a finding.
// 3. For expr_list values, flag explicit null nodes and column/expression nodes
//    whose referenced schema column is nullable.
// 4. For subquery wrappers (`value[i].ast`), inspect the SELECT projection in
//    that subquery's own FROM/alias scope. Flag a direct nullable projected
//    column; do not infer nullability from unrelated WHERE/JOIN expressions.
// 5. Preserve table qualifiers/aliases when resolving columns. If a qualified
//    reference cannot be resolved unambiguously, skip it.
// 6. Emit a warn finding with schemaVerified true and no rewrite. For a
//    subquery, prefer `WHERE projected_column IS NOT NULL`; mention NOT EXISTS
//    only when correlation, type classification, and multiplicity semantics
//    can be preserved. Never auto-rewrite to NOT EXISTS.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/lint/rules-schema-aware.test.ts`
Expected: PASS (10 tests before additional review regressions). If `NOT IN` surfaces differently in the AST (e.g. a unary `NOT` wrapping an `IN` binary_expr), adapt the operator check: also match `n.type === 'unary_expr' && n.operator === 'NOT'` wrapping an `IN` — log the ast to confirm, keep the behavioral assertions.

- [ ] **Step 5: Commit**

```bash
git add src/core/lint/rules/implicit-cast.ts src/core/lint/rules/not-in-nullable.ts tests/unit/core/lint/rules-schema-aware.test.ts
git commit -m "feat: add schema-aware implicit-cast and not-in-nullable lint rules"
```

---

### Task 6: Engine — rule registry, severity filter, skip semantics

**Files:**
- Create: `src/core/lint/engine.ts`
- Test: `tests/unit/core/lint/engine.test.ts`

**Interfaces:**
- Consumes: all 9 rules (Tasks 3–5), `parseSingleStatement`/`ParseFailure` (Task 1), and a `SchemaContext` produced by Task 2.
- Produces (used by the command in Task 8):
  - `ALL_RULES: LintRule[]` (exported for docs/tests)
  - `lintSql(sql: string, opts: { system: SqlDatabaseSystem; schema?: SchemaContext; minSeverity?: LintSeverity; noSchema?: boolean }, label?: string): LintReport`

Behavior contract:
- Parse failure → report with `parseError` set, empty `findings`, all rules listed in `skippedRules` with reason `blocked: parse failed`.
- `requiresSchema` rules skipped when `noSchema` or schema unavailable, each recorded as `{ rule, reason: 'blocked: schema cache unavailable (run dbcli schema)' }` (or `'blocked: --no-schema'`).
- `minSeverity` filters findings (`info` < `warn` < `error`).
- `relatedCommands` always includes the guide command and an explain command with the actual SQL substituted. The explain command includes `--analyze` only for a structurally proven read-only statement; uncertain or write-capable SQL uses plain `dbcli explain`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/lint/engine.test.ts
import { describe, test, expect } from 'bun:test'
import { lintSql, ALL_RULES } from '@/core/lint/engine'
import { buildSchemaContext } from '@/core/lint/context'
import type { TableSchema } from '@/adapters/types'

const schemaTables: Record<string, TableSchema> = {
  users: {
    name: 'users',
    columns: [{ name: 'id', type: 'integer', nullable: false }],
  },
}
const schema = buildSchemaContext(schemaTables)

describe('lintSql', () => {
  test('registry holds all 9 rules', () => {
    expect(ALL_RULES.map((r) => r.name).sort()).toEqual([
      'distinct-groupby-abuse',
      'implicit-cast',
      'missing-limit-offset',
      'non-sargable-where',
      'not-in-nullable',
      'or-to-union',
      'select-star',
      'subquery-to-join',
      'unanchored-like',
    ])
  })

  test('reports findings across rules', () => {
    const report = lintSql("SELECT * FROM users WHERE LOWER(name) = 'x'", {
      system: 'postgresql',
    })
    const rules = report.findings.map((f) => f.rule)
    expect(rules).toContain('select-star')
    expect(rules).toContain('non-sargable-where')
    expect(report.parseError).toBeUndefined()
  })

  test('skips schema rules without cache, with blocked reason', () => {
    const report = lintSql("SELECT id FROM users WHERE id = '1'", { system: 'postgresql' })
    expect(report.findings.map((f) => f.rule)).not.toContain('implicit-cast')
    for (const rule of ['implicit-cast', 'not-in-nullable']) {
      const skipped = report.skippedRules.find((s) => s.rule === rule)
      expect(skipped?.reason).toBe('blocked: schema cache unavailable (run dbcli schema)')
    }
  })

  test('runs schema rules when cache provided; --no-schema forces skip', () => {
    const withSchema = lintSql("SELECT id FROM users WHERE id = '1'", {
      system: 'postgresql',
      schema,
    })
    expect(withSchema.findings.map((f) => f.rule)).toContain('implicit-cast')

    const noSchema = lintSql("SELECT id FROM users WHERE id = '1'", {
      system: 'postgresql',
      schema,
      noSchema: true,
    })
    expect(noSchema.findings.map((f) => f.rule)).not.toContain('implicit-cast')
    expect(noSchema.skippedRules.find((s) => s.rule === 'implicit-cast')?.reason).toBe(
      'blocked: --no-schema'
    )
  })

  test('minSeverity filters findings', () => {
    const report = lintSql('SELECT id FROM users WHERE id IN (SELECT user_id FROM orders)', {
      system: 'postgresql',
      minSeverity: 'warn',
    })
    expect(report.findings.every((f) => f.severity !== 'info')).toBe(true)
  })

  test('parse failure yields parseError and all rules skipped', () => {
    const report = lintSql('SELEC oops', { system: 'postgresql' })
    expect(report.parseError).toContain('SQL parse failed')
    expect(report.findings).toHaveLength(0)
    expect(report.skippedRules).toHaveLength(ALL_RULES.length)
  })

  test('relatedCommands embed the SQL', () => {
    const report = lintSql('SELECT id FROM users', { system: 'postgresql' })
    expect(report.relatedCommands[0]).toBe('dbcli guide missing-index-for "SELECT id FROM users"')
    expect(report.relatedCommands[1]).toBe('dbcli explain --analyze "SELECT id FROM users"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/core/lint/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/core/lint/engine.ts
import type { SqlDatabaseSystem } from '@/adapters/types'
import type { LintReport, LintRule, LintSeverity, SchemaContext } from './types'
import { parseSingleStatement, ParseFailure } from './parse'
import { buildSchemaContext } from './context'
import { selectStarRule } from './rules/select-star'
import { unanchoredLikeRule } from './rules/unanchored-like'
import { missingLimitOffsetRule } from './rules/missing-limit-offset'
import { nonSargableWhereRule } from './rules/non-sargable-where'
import { orToUnionRule } from './rules/or-to-union'
import { subqueryToJoinRule } from './rules/subquery-to-join'
import { distinctGroupbyAbuseRule } from './rules/distinct-groupby-abuse'
import { implicitCastRule } from './rules/implicit-cast'
import { notInNullableRule } from './rules/not-in-nullable'

export const ALL_RULES: LintRule[] = [
  selectStarRule,
  unanchoredLikeRule,
  missingLimitOffsetRule,
  nonSargableWhereRule,
  orToUnionRule,
  subqueryToJoinRule,
  distinctGroupbyAbuseRule,
  implicitCastRule,
  notInNullableRule,
]

const SEVERITY_RANK: Record<LintSeverity, number> = { info: 0, warn: 1, error: 2 }

export interface LintSqlOptions {
  system: SqlDatabaseSystem
  schema?: SchemaContext
  minSeverity?: LintSeverity
  noSchema?: boolean
}

export function lintSql(sql: string, opts: LintSqlOptions, label?: string): LintReport {
  const relatedCommands = [
    `dbcli guide missing-index-for "${sql}"`,
    explainWith(sql, opts.system),
  ]
  const base: LintReport = {
    sql,
    ...(label !== undefined && { label }),
    dialect: opts.system,
    findings: [],
    skippedRules: [],
    relatedCommands,
  }

  let ast
  try {
    ast = parseSingleStatement(sql, opts.system)
  } catch (e) {
    if (e instanceof ParseFailure) {
      return {
        ...base,
        parseError: e.message,
        skippedRules: ALL_RULES.map((r) => ({ rule: r.name, reason: 'blocked: parse failed' })),
      }
    }
    throw e
  }

  const schemaCtx = opts.noSchema ? buildSchemaContext(undefined) : (opts.schema ?? buildSchemaContext(undefined))
  const ctx = { system: opts.system, sql, ast, schema: schemaCtx }
  const minRank = SEVERITY_RANK[opts.minSeverity ?? 'info']

  const findings = []
  const skippedRules = []
  for (const rule of ALL_RULES) {
    if (rule.requiresSchema && !schemaCtx.available) {
      skippedRules.push({
        rule: rule.name,
        reason: opts.noSchema
          ? 'blocked: --no-schema'
          : 'blocked: schema cache unavailable (run dbcli schema)',
      })
      continue
    }
    findings.push(...rule.check(ctx).filter((f) => SEVERITY_RANK[f.severity] >= minRank))
  }
  return { ...base, findings, skippedRules }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/core/lint/engine.test.ts` then the whole lint suite: `bun test tests/unit/core/lint/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/lint/engine.ts tests/unit/core/lint/engine.test.ts
git commit -m "feat: add lint engine with rule registry and skip semantics"
```

---

### Task 7: Formatter — text / json / markdown

**Files:**
- Create: `src/formatters/lint.ts`
- Test: `tests/unit/formatters/lint.test.ts`

**Interfaces:**
- Consumes: `LintReport` (Task 1).
- Produces: `formatLint(reports: LintReport[], format: LintFormat): string`; `type LintFormat = 'text' | 'json' | 'markdown'`. Task 8 calls this once with all reports.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/formatters/lint.test.ts
import { describe, test, expect } from 'bun:test'
import { formatLint } from '@/formatters/lint'
import type { LintReport } from '@/core/lint/types'

const report: LintReport = {
  sql: 'SELECT * FROM users',
  label: 'inline',
  dialect: 'postgresql',
  findings: [
    {
      rule: 'select-star',
      severity: 'warn',
      message: 'SELECT * fetches every column.',
      span: { start: 0, end: 8 },
      rewrite: { sql: 'SELECT id FROM users', confidence: 'high' },
      verifyCommand: 'dbcli explain --analyze "SELECT id FROM users"',
      schemaVerified: true,
    },
  ],
  skippedRules: [{ rule: 'implicit-cast', reason: 'blocked: schema cache unavailable (run dbcli schema)' }],
  relatedCommands: ['dbcli explain --analyze "SELECT * FROM users"'],
}

describe('formatLint', () => {
  test('json round-trips the reports array', () => {
    const parsed = JSON.parse(formatLint([report], 'json'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].findings[0].rule).toBe('select-star')
  })

  test('text includes severity, rule, message, rewrite and skipped section', () => {
    const out = formatLint([report], 'text')
    expect(out).toContain('[warn] select-star')
    expect(out).toContain('SELECT * fetches every column.')
    expect(out).toContain('Rewrite (high): SELECT id FROM users')
    expect(out).toContain('Verify: dbcli explain --analyze')
    expect(out).toContain('Skipped: implicit-cast — blocked: schema cache unavailable (run dbcli schema)')
  })

  test('text reports a clean query', () => {
    const clean: LintReport = { ...report, findings: [], skippedRules: [] }
    expect(formatLint([clean], 'text')).toContain('No findings')
  })

  test('markdown renders a findings table', () => {
    const out = formatLint([report], 'markdown')
    expect(out).toContain('| Severity | Rule | Message |')
    expect(out).toContain('| warn | select-star |')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/formatters/lint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/formatters/lint.ts
import type { LintReport } from '@/core/lint/types'

export type LintFormat = 'text' | 'json' | 'markdown'

export function formatLint(reports: LintReport[], format: LintFormat): string {
  if (format === 'json') return JSON.stringify(reports, null, 2)
  if (format === 'markdown') return reports.map(markdownOne).join('\n\n---\n\n')
  return reports.map(textOne).join('\n\n')
}

function header(r: LintReport): string {
  return r.label ? `${r.label}: ${r.sql}` : r.sql
}

function textOne(r: LintReport): string {
  const lines: string[] = [`Query: ${header(r)}`, `Dialect: ${r.dialect}`]
  if (r.parseError) {
    lines.push(`Parse error: ${r.parseError}`)
  } else if (r.findings.length === 0) {
    lines.push('No findings.')
  } else {
    for (const f of r.findings) {
      lines.push('', `[${f.severity}] ${f.rule}${f.schemaVerified ? ' (schema-verified)' : ''}`)
      lines.push(`  ${f.message}`)
      if (f.rewrite) lines.push(`  Rewrite (${f.rewrite.confidence}): ${f.rewrite.sql}`)
      if (f.verifyCommand) lines.push(`  Verify: ${f.verifyCommand}`)
    }
  }
  for (const s of r.skippedRules) {
    lines.push(`Skipped: ${s.rule} — ${s.reason}`)
  }
  if (r.relatedCommands.length > 0) {
    lines.push('', 'Related:', ...r.relatedCommands.map((c) => `  ${c}`))
  }
  return lines.join('\n')
}

function markdownOne(r: LintReport): string {
  const lines: string[] = [`### ${header(r)}`, '']
  if (r.parseError) {
    lines.push(`**Parse error:** ${r.parseError}`)
    return lines.join('\n')
  }
  if (r.findings.length === 0) {
    lines.push('No findings.')
  } else {
    lines.push('| Severity | Rule | Message |', '| --- | --- | --- |')
    for (const f of r.findings) {
      lines.push(`| ${f.severity} | ${f.rule} | ${f.message.replace(/\|/g, '\\|')} |`)
    }
    for (const f of r.findings) {
      if (f.rewrite) {
        lines.push('', `**Rewrite** (\`${f.rule}\`, ${f.rewrite.confidence}):`, '```sql', f.rewrite.sql, '```')
        if (f.verifyCommand) lines.push(`Verify: \`${f.verifyCommand}\``)
      }
    }
  }
  if (r.skippedRules.length > 0) {
    lines.push('', ...r.skippedRules.map((s) => `- Skipped: \`${s.rule}\` — ${s.reason}`))
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/formatters/lint.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/formatters/lint.ts tests/unit/formatters/lint.test.ts
git commit -m "feat: add lint output formatter (text/json/markdown)"
```

---

### Task 8: Command layer + registration + audit + recovery

**Files:**
- Create: `src/commands/lint.ts`
- Modify: `src/program.ts` (import near line 24, `program.addCommand(lintCommand)` next to the `explain` registration near line 279)
- Test: `tests/unit/commands/lint.test.ts`

**Interfaces:**
- Consumes: `lintSql`/`LintSqlOptions` (Task 6), `loadSchemaContext` (Task 2), `formatLint`/`LintFormat` (Task 7), `resolveBulkInputs` from `@/core/explain/bulk-runner`, `loadSnippets`/`resolveSnippetDirs` from `@/core/saved-queries`, `configModule`/`getSchemaIsolationConnectionName` from `@/core/config`, `resolveConfigStoragePath` from `@/core/config-binding`, `resolveConfigPath` from `@/utils/config-path`, `writeAuditEntry` from `@/core/audit/integration-helper`, `emitRecoveryEnvelope` from `@/core/recovery` (dynamic import, as in `schema.ts:346-353`).
- Produces: `lintCommand: Command` (commander). Also exports `runLint(...)` for tests.

Command spec:

```
dbcli lint [queries...]
  --use <conn>            existing global option; select named connection + schema cache
  --format <fmt>          text | json | markdown   (default: text)
  --min-severity <level>  info | warn | error      (default: info)
  --no-schema             skip schema-aware rules even when cache exists
  --bulk <input>          comma-separated @file / @glob / @saved-query inputs
  --recovery              on failure, emit a structured recovery envelope
```

- Reads config plus layered schema-cache files only (no adapter, no connect). Rejects non-SQL systems with the standard message (Global Constraints).
- Schema source: call `resolveConfigStoragePath(configPath)`, resolve the v2 cache slot with `getSchemaIsolationConnectionName(configPath)`, then call `loadSchemaContext(storagePath, connectionName)`. Never pass `config.schema` into lint.
- `--use <conn>` is the existing global option registered in `src/program.ts`; document and test invocation as `dbcli --use <conn> lint ...`. The global pre-action hook selects the config connection, and `getSchemaIsolationConnectionName` selects `.dbcli/schemas/<conn>/`.
- On success: `writeAuditEntry(config, 'lint', options, { success: true, target: '*', metadata: { queries: reports.length, findings: totalFindings } })`.
- On failure: audit `success: false` + recovery envelope when `--recovery` (copy the `catch` structure of `src/commands/schema.ts:331-362` with `operation: 'lint'`), then `process.exit(1)`.

- [ ] **Step 1: Write the failing test**

Structure the command so the core is testable without process.exit: export
`runLint(queries, options, deps)` where `deps` supplies config, a loaded schema context,
and a saved-query loader, and have the commander `.action` call it. Tests exercise
`runLint` directly.

```ts
// tests/unit/commands/lint.test.ts
import { describe, test, expect } from 'bun:test'
import { runLint } from '@/commands/lint'
import { buildSchemaContext } from '@/core/lint/context'
import type { TableSchema } from '@/adapters/types'

const baseConfig = {
  connection: { system: 'postgresql' },
  permission: 'query-only',
}
const users: TableSchema = {
  name: 'users',
  columns: [{ name: 'id', type: 'integer', nullable: false }],
}
const schema = buildSchemaContext({ users })

const noSnippets = async () => null

describe('runLint', () => {
  test('lints an inline query and returns reports', async () => {
    const { reports } = await runLint(['SELECT * FROM users'], { format: 'json' }, {
      config: baseConfig as never,
      schema,
      loadSavedQuery: noSnippets,
    })
    expect(reports).toHaveLength(1)
    expect(reports[0].findings.map((f) => f.rule)).toContain('select-star')
  })

  test('rejects non-SQL systems', async () => {
    await expect(
      runLint(['SELECT 1'], {}, {
        config: { ...baseConfig, connection: { system: 'redis' } } as never,
        schema,
        loadSavedQuery: noSnippets,
      })
    ).rejects.toThrow('dbcli lint requires a SQL connection')
  })

  test('errors when no query given', async () => {
    await expect(
      runLint([], {}, { config: baseConfig as never, schema, loadSavedQuery: noSnippets })
    ).rejects.toThrow('No query provided')
  })

  test('passes noSchema through (schema rules skipped)', async () => {
    const { reports } = await runLint(
      ["SELECT id FROM users WHERE id = '1'"],
      { noSchema: true },
      { config: baseConfig as never, schema, loadSavedQuery: noSnippets }
    )
    expect(reports[0].skippedRules.find((s) => s.rule === 'implicit-cast')?.reason).toBe(
      'blocked: --no-schema'
    )
  })

  test('resolves @saved-query inputs via the loader', async () => {
    const loader = async (name: string) =>
      name === 'perf/top' ? [{ name: 'perf/top', sql: 'SELECT * FROM users' }] : null
    const { reports } = await runLint(['@perf/top'], {}, {
      config: baseConfig as never,
      schema,
      loadSavedQuery: loader,
    })
    expect(reports[0].label).toBe('perf/top')
    expect(reports[0].findings.map((f) => f.rule)).toContain('select-star')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/commands/lint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/commands/lint.ts
/**
 * `dbcli lint` — static, schema-aware SQL anti-pattern advisor.
 * Never connects to the database; schema facts come from the layered local
 * cache under `.dbcli/schemas/`. Report-only: rewrites are
 * drafts to verify with guarded `dbcli explain` commands, never executed here.
 */
import { Command } from 'commander'
import { configModule, getSchemaIsolationConnectionName } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { resolveConfigPath } from '@/utils/config-path'
import { resolveBulkInputs } from '@/core/explain/bulk-runner'
import { loadSnippets, resolveSnippetDirs } from '@/core/saved-queries'
import { lintSql, type LintSqlOptions } from '@/core/lint/engine'
import { buildSchemaContext, loadSchemaContext } from '@/core/lint/context'
import type { LintReport, LintSeverity, SchemaContext } from '@/core/lint/types'
import { formatLint, type LintFormat } from '@/formatters/lint'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'
import type { SqlDatabaseSystem } from '@/adapters/types'

const FORMATS: LintFormat[] = ['text', 'json', 'markdown']
const SEVERITIES: LintSeverity[] = ['info', 'warn', 'error']
const SQL_SYSTEMS = ['postgresql', 'mysql', 'mariadb']

export interface LintCommandOptions {
  format?: string
  minSeverity?: string
  noSchema?: boolean
  bulk?: string
  recovery?: boolean
}

type SavedQueryLoader = (nameOrGlob: string) => Promise<{ name: string; sql: string }[] | null>

interface LintDeps {
  config: DbcliConfig
  schema: SchemaContext
  loadSavedQuery: SavedQueryLoader
}

export async function runLint(
  queries: string[],
  options: LintCommandOptions,
  deps: LintDeps
): Promise<{ reports: LintReport[]; output: string }> {
  const format = (options.format ?? 'text') as LintFormat
  if (!FORMATS.includes(format)) {
    throw new Error(`Unknown format '${format}'. Allowed: ${FORMATS.join(', ')}`)
  }
  const minSeverity = (options.minSeverity ?? 'info') as LintSeverity
  if (!SEVERITIES.includes(minSeverity)) {
    throw new Error(`Unknown --min-severity '${minSeverity}'. Allowed: ${SEVERITIES.join(', ')}`)
  }

  const system = deps.config.connection?.system
  if (!system || !SQL_SYSTEMS.includes(system)) {
    throw new Error(
      `dbcli lint requires a SQL connection (postgresql/mysql/mariadb), got: ${system ?? 'none'}`
    )
  }

  const rawInputs =
    options.bulk !== undefined
      ? options.bulk.split(',').map((s) => s.trim()).filter(Boolean)
      : queries
  const inputs = await resolveBulkInputs(rawInputs, {
    loadFromSavedQueries: deps.loadSavedQuery,
  })
  if (inputs.length === 0) {
    throw new Error('No query provided. Pass a SQL string, @saved-query, or --bulk @file.sql.')
  }

  const lintOpts: LintSqlOptions = {
    system: system as SqlDatabaseSystem,
    schema: deps.schema,
    minSeverity,
    noSchema: options.noSchema === true,
  }
  const reports = inputs.map((input) => lintSql(input.sql, lintOpts, input.label))
  return { reports, output: formatLint(reports, format) }
}

/** Same saved-query loader as src/commands/explain.ts (glob + direct). */
function makeSavedQueryLoader(): SavedQueryLoader {
  return async (nameOrGlob) => {
    const snippetMap = await loadSnippets(resolveSnippetDirs(process.cwd()))
    const stripAt = (k: string) => k.replace(/^@/, '')
    if (nameOrGlob.includes('*')) {
      const regex = new RegExp(
        '^' + nameOrGlob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      )
      const entries: { name: string; sql: string }[] = []
      for (const [key, snippets] of snippetMap) {
        const name = stripAt(key)
        if (regex.test(name)) {
          const sql = snippets[0]?.query?.sqlBody ?? ''
          if (sql) entries.push({ name, sql })
        }
      }
      return entries.length > 0 ? entries : null
    }
    const direct = snippetMap.get(nameOrGlob) ?? snippetMap.get(`@${nameOrGlob}`)
    const sql = direct?.[0]?.query?.sqlBody
    return sql ? [{ name: nameOrGlob, sql }] : null
  }
}

export const lintCommand = new Command()
  .name('lint')
  .description('Static SQL anti-pattern advisor with rewrite drafts (no DB connection)')
  .argument('[queries...]', 'one or more SQL strings or @saved-query/@file references')
  .option('--format <fmt>', `output format: ${FORMATS.join(' | ')}`, 'text')
  .option('--min-severity <level>', `drop findings below: ${SEVERITIES.join(' | ')}`, 'info')
  .option('--no-schema', 'skip schema-aware rules even when the cache exists')
  .option('--bulk <input>', 'comma-separated list of @file / @glob / @saved-query inputs')
  .option('--recovery', 'on failure, emit a structured recovery envelope to stdout')
  .action(async (queries: string[], options: LintCommandOptions, command: Command) => {
    const globalOpts = command.parent?.opts<{ config?: string; env?: string }>() ?? {}
    const configPath = resolveConfigPath(command, globalOpts)
    let config: DbcliConfig | undefined
    try {
      config = await configModule.read(configPath)
      const schema =
        options.noSchema === true
          ? buildSchemaContext(undefined)
          : await loadSchemaContext(
              await resolveConfigStoragePath(configPath),
              await getSchemaIsolationConnectionName(configPath)
            )
      const { reports, output } = await runLint(queries, options, {
        config,
        schema,
        loadSavedQuery: makeSavedQueryLoader(),
      })
      console.log(output)
      await writeAuditEntry(config, 'lint', { ...options }, {
        success: true,
        target: '*',
        metadata: {
          queries: reports.length,
          findings: reports.reduce((n, r) => n + r.findings.length, 0),
        },
      })
    } catch (error) {
      let auditId: string | null = null
      let envelopeId: string | undefined
      if (options.recovery === true) {
        envelopeId = crypto.randomUUID()
      }
      if (config) {
        auditId = await writeAuditEntry(config, 'lint', { ...options }, {
          success: false,
          target: '*',
          error,
          ...(envelopeId && { recovery_ref: envelopeId }),
        })
      }
      if (envelopeId !== undefined) {
        const { emitRecoveryEnvelope } = await import('@/core/recovery')
        emitRecoveryEnvelope(
          error,
          { operation: 'lint' },
          { envelopeId, auditRef: auditId ?? undefined }
        )
      }
      console.error((error as Error).message)
      process.exit(1)
    }
  })
```

Registration in `src/program.ts` (two edits):

```ts
// with the other command imports (near line 24):
import { lintCommand } from './commands/lint'

// with the other addCommand calls (immediately after `program.addCommand(explainCommand)`, near line 279):
program.addCommand(lintCommand)
```

> If `emitRecoveryEnvelope`'s context type rejects `{ operation: 'lint' }` (operation may
> be a union of known command names), add `'lint'` to that union in `src/core/recovery`'s
> types — mirror how `'schema'` is declared. Same for `writeAuditEntry`'s command-name
> type if it is a union.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/commands/lint.test.ts`
Expected: PASS (5 tests).
Then smoke the CLI end-to-end without a DB: `bun run src/cli.ts --use staging lint "SELECT * FROM nonexistent" --format json` — in a dir with a v2 SQL `.dbcli` and `.dbcli/schemas/staging/` it prints a JSON report from that cache; without config it errors cleanly.
Then full suite: `bun test tests/unit` — expected all green.

- [ ] **Step 5: Commit**

```bash
git add src/commands/lint.ts src/program.ts tests/unit/commands/lint.test.ts
git commit -m "feat: add dbcli lint command with audit and recovery wiring"
```

---

### Task 9: Task-pack / guide integration

**Files:**
- Modify: `assets/tasks/diagnose-slow-query.json` (or `.yaml`/`.md` — match the actual builtin task-pack file format found in `assets/tasks/`; insert a lint step before the explain step)
- Modify: `src/core/guide` slow-query goal definition (locate with `grep -rn "slow-query" src/core/guide src/commands/guide.ts` — insert a `dbcli lint "<SQL>"` step before the explain step)
- Test: extend the existing pack/guide tests (locate with `grep -rln "diagnose-slow-query" tests/`)

**Interfaces:**
- Consumes: the `lint` command name only (steps are command strings with rationale).
- Produces: updated plan output — `skill tasks plan diagnose-slow-query` and `guide slow-query` both include a lint step.

- [ ] **Step 1: Locate the exact files and current step lists**

Run: `grep -rln "diagnose-slow-query" assets/ src/ tests/` and `grep -rn "slow-query" src/core/guide/ src/commands/guide.ts | head -20`
Read the matched task-pack definition and the guide goal definition to learn their exact step schema (id, command, rationale, risk fields).

- [ ] **Step 2: Write the failing test**

Extend the existing test for `diagnose-slow-query` (found in Step 1) with an assertion, matching the file's existing style:

```ts
test('diagnose-slow-query plan includes a lint step before explain', () => {
  // build the plan the same way neighboring tests in this file do
  const commands = plan.steps.map((s) => s.command)
  const lintIdx = commands.findIndex((c) => c.startsWith('dbcli lint'))
  const explainIdx = commands.findIndex((c) => c.includes('explain'))
  expect(lintIdx).toBeGreaterThan(-1)
  expect(lintIdx).toBeLessThan(explainIdx)
})
```

Add the equivalent assertion to the `guide slow-query` test file.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test <the two test files>`
Expected: FAIL — no lint step yet.

- [ ] **Step 4: Add the lint steps**

In the task-pack definition, insert before the explain step (adapt field names to the real schema):

```json
{
  "command": "dbcli lint \"{{query}}\" --format json",
  "rationale": "Static anti-pattern check first: catches non-sargable predicates, implicit casts, SELECT * and OR-fanout before spending an EXPLAIN round-trip.",
  "risk": "read-only"
}
```

In the guide slow-query goal, insert the analogous step with the same rationale.

- [ ] **Step 5: Run tests to verify they pass, then run the full suite**

Run: `bun test tests/` (unit + contract)
Expected: PASS. If a contract test over pack content fails, update its expected step count/content — the contract test is there to force exactly this conscious update.

- [ ] **Step 6: Commit**

```bash
git add -A assets/tasks src/core/guide tests
git commit -m "feat: insert lint step into diagnose-slow-query pack and slow-query guide"
```

---

### Task 10: Documentation (SKILL.md, reference.md, user docs, plugin sync)

**Files:**
- Modify: `assets/SKILL.md`, `assets/SKILL.zh-TW.md`, `assets/reference.md`
- Modify: `docs/user/en/index.md`, `docs/user/en/index.html`, `docs/user/zh-TW/index.md`, `docs/user/zh-TW/index.html`
- Modify: plugin copies via `bun run plugin:sync` (do not hand-edit plugin dirs)
- Test: `tests/unit/skill-assets/` + `tests/contract/` (run; update expectations where the contract intentionally pins content)

**Interfaces:**
- Consumes: final CLI surface from Task 8 (`lint` flags) and rule names from Task 6.

- [ ] **Step 1: Update `assets/SKILL.md`**

1. Command overview table — insert after the `explain` row:

```markdown
| `lint` | n/a | Static SQL anti-pattern advisor (no DB connection). 9 rules incl. schema-aware implicit-cast / NOT IN-nullable checks via the layered `.dbcli/schemas/` cache; global `--use <conn>` selects a named cache. Findings carry rewrite drafts + guarded `explain` verify commands (`--analyze` only for proven read-only SQL) — report-only, never executes. `--format text\|json\|markdown`, `--min-severity`, `--no-schema`, `--bulk`. Supports `--recovery`. |
```

2. "Slow endpoint or query" row in **Developer workflows** — change the path to:

```markdown
| Slow endpoint or query | `report --section perf` → task pack `analyze-table-perf` → `lint "<query>"` → `guide missing-index-for "<query>"`; use `proxy analyze` when logs exist. |
```

3. Slow-query canonical path (first bullet) — change to:

```markdown
- Known slow SQL → `skill tasks plan diagnose-slow-query --param query="<SQL>"` → `lint "<SQL>"` → `guide missing-index-for "<SQL>"`
```

4. Copy-paste command anchors — add `dbcli lint "<SQL>" --format json` after the `guide missing-index-for` anchor.

- [ ] **Step 2: Mirror the same three edits in `assets/SKILL.zh-TW.md`** (translate the new row/steps in Traditional Chinese, keeping command strings identical).

- [ ] **Step 3: Add the full `lint` block to `assets/reference.md`**

Place it after the `explain` section, following the sibling sections' structure: synopsis, the five lint-local flags with defaults plus the global `--use <conn>` selector, the 9 rule names with one-line descriptions, layered-cache and skip semantics (`blocked:` reasons), two examples (inline + `--bulk @glob`), and a JSON output sample trimmed to one finding.

- [ ] **Step 4: Update user docs (both languages, both formats)**

Add a `lint` entry to the command list in `docs/user/en/index.md` and `docs/user/zh-TW/index.md`, then mirror into the corresponding `index.html` sections following each file's existing markup patterns.

- [ ] **Step 5: Sync plugins and run all content tests**

```bash
bun run plugin:sync
bun test tests/unit/skill-assets tests/contract
```

Expected: contract tests fail on first run wherever they pin SKILL content — update the pinned expectations to include the lint row/steps (this is the intended conscious-update gate; lesson recorded in project memory: always run the content-contract tests after touching SKILL.md, don't trust parity alone).

- [ ] **Step 6: Full suite + commit**

```bash
bun test
git add -A assets docs plugins .claude-plugin .codex-plugin .cursor-plugin .agents .github/skills tests
git commit -m "docs: document dbcli lint across skill assets, user docs, and plugins"
```

---

## Verification (after all tasks)

1. `bun test` — entire suite green.
2. `bun run build` — build passes (dist-smoke locally may SIGTERM per known environment issue; `test:unit` + separate `build` is the clean signal, per project memory).
3. Manual smoke in a repo with a SQL `.dbcli`:
   - `bun run src/cli.ts lint "SELECT * FROM users WHERE LOWER(email) = 'a' OR name = 'b' LIMIT 10 OFFSET 5000" --format text` → expect select-star, non-sargable-where, or-to-union, missing-limit-offset findings; implicit-cast listed under Skipped when no schema cache.
   - `bun run src/cli.ts skill tasks plan diagnose-slow-query --param query="SELECT 1" --format json` → contains a `dbcli lint` step before explain.
4. Do NOT bump package.json version in this plan — release (1.40.0) is a separate step decided by the user.
