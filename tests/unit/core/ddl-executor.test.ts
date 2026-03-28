import { test, expect, describe, beforeEach, mock } from 'bun:test'
import { DDLExecutor } from 'src/core/ddl-executor'
import { PostgreSQLDDLGenerator } from 'src/adapters/ddl/postgresql-ddl'
import type { DatabaseAdapter, TableSchema } from 'src/adapters/types'
import type { DDLOperation } from 'src/types/ddl'

// ── Mocks ────────────────────────────────────────────────────────────────

function createMockAdapter(): DatabaseAdapter {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    execute: mock(() => Promise.resolve([])),
    listTables: mock(() => Promise.resolve([])),
    getTableSchema: mock(() => Promise.resolve({
      name: 'test', columns: [], primaryKey: []
    } as TableSchema)),
    testConnection: mock(() => Promise.resolve(true)),
    getServerVersion: mock(() => Promise.resolve('15.0'))
  }
}

function createMockBlacklist(blacklistedTables: string[] = []) {
  return {
    isTableBlacklisted: (t: string) => blacklistedTables.includes(t),
    isColumnBlacklisted: () => false,
    getBlacklistedColumns: () => [],
    getBlacklistedTables: () => blacklistedTables
  }
}

function createMockSchemaCache() {
  return {
    invalidateTable: mock(() => {}),
    refreshTable: mock(() => {}),
    getTableSchema: mock(() => Promise.resolve(null)),
    initialize: mock(() => Promise.resolve()),
    findFieldsByName: mock(() => Promise.resolve([])),
    getStats: mock(() => ({ hotTables: 0, cachedTables: 0, cacheSize: 0, cacheHitRate: '0%', maxItems: 100, maxSize: 0 }))
  }
}

const createTableOp: DDLOperation = {
  kind: 'createTable',
  table: 'posts',
  columns: [
    { name: 'id', type: 'serial', primaryKey: true, nullable: false },
    { name: 'title', type: 'varchar(200)', nullable: false }
  ]
}

const dropTableOp: DDLOperation = { kind: 'dropTable', table: 'posts' }

// ── Permission checks ────────────────────────────────────────────────────

describe('DDLExecutor permission checks', () => {
  test('rejects query-only permission', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(), new PostgreSQLDDLGenerator(), 'query-only'
    )
    const result = await executor.execute(createTableOp)
    expect(result.status).toBe('error')
    expect(result.error).toContain('Permission denied')
    expect(result.error).toContain('query-only')
  })

  test('rejects read-write permission', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(), new PostgreSQLDDLGenerator(), 'read-write'
    )
    const result = await executor.execute(createTableOp)
    expect(result.status).toBe('error')
    expect(result.error).toContain('Permission denied')
  })

  test('rejects data-admin permission', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(), new PostgreSQLDDLGenerator(), 'data-admin'
    )
    const result = await executor.execute(createTableOp)
    expect(result.status).toBe('error')
  })

  test('allows admin permission', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(), new PostgreSQLDDLGenerator(), 'admin'
    )
    const result = await executor.execute(createTableOp)
    expect(result.status).toBe('success')
  })
})

// ── Blacklist checks ─────────────────────────────────────────────────────

describe('DDLExecutor blacklist checks', () => {
  test('blocks DDL on blacklisted table', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(),
      new PostgreSQLDDLGenerator(),
      'admin',
      createMockBlacklist(['secrets']) as any
    )
    const op: DDLOperation = { kind: 'dropTable', table: 'secrets' }
    const result = await executor.execute(op, { execute: true, force: true })
    expect(result.status).toBe('error')
    expect(result.error).toContain('blacklisted')
  })

  test('allows DDL on non-blacklisted table', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(),
      new PostgreSQLDDLGenerator(),
      'admin',
      createMockBlacklist(['secrets']) as any
    )
    const result = await executor.execute(createTableOp)
    expect(result.status).toBe('success')
  })

  test('skips blacklist check for enum operations (no table)', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(),
      new PostgreSQLDDLGenerator(),
      'admin',
      createMockBlacklist(['secrets']) as any
    )
    const op: DDLOperation = { kind: 'addEnum', definition: { name: 'status', values: ['a', 'b'] } }
    const result = await executor.execute(op)
    expect(result.status).toBe('success')
  })
})

// ── Dry-run mode ─────────────────────────────────────────────────────────

describe('DDLExecutor dry-run', () => {
  test('default is dry-run (no execute option)', async () => {
    const adapter = createMockAdapter()
    const executor = new DDLExecutor(adapter, new PostgreSQLDDLGenerator(), 'admin')
    const result = await executor.execute(createTableOp)
    expect(result.status).toBe('success')
    expect(result.dryRun).toBe(true)
    expect(result.sql).toContain('CREATE TABLE')
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  test('execute: true runs SQL', async () => {
    const adapter = createMockAdapter()
    const executor = new DDLExecutor(adapter, new PostgreSQLDDLGenerator(), 'admin')
    const result = await executor.execute(createTableOp, { execute: true })
    expect(result.status).toBe('success')
    expect(result.dryRun).toBe(false)
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('dry-run returns generated SQL', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(), new PostgreSQLDDLGenerator(), 'admin'
    )
    const result = await executor.execute(createTableOp)
    expect(result.sql).toContain('"posts"')
    expect(result.sql).toContain('"id" SERIAL')
    expect(result.sql).toContain('"title" VARCHAR(200)')
  })
})

// ── Destructive operations ───────────────────────────────────────────────

describe('DDLExecutor destructive operations', () => {
  test('DROP TABLE with force skips confirmation', async () => {
    const adapter = createMockAdapter()
    const executor = new DDLExecutor(adapter, new PostgreSQLDDLGenerator(), 'admin')
    const result = await executor.execute(dropTableOp, { execute: true, force: true })
    expect(result.status).toBe('success')
    expect(result.dryRun).toBe(false)
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('non-destructive ops dont need force', async () => {
    const adapter = createMockAdapter()
    const executor = new DDLExecutor(adapter, new PostgreSQLDDLGenerator(), 'admin')
    const result = await executor.execute(createTableOp, { execute: true })
    expect(result.status).toBe('success')
    expect(adapter.execute).toHaveBeenCalled()
  })
})

// ── Schema refresh ───────────────────────────────────────────────────────

describe('DDLExecutor schema refresh', () => {
  test('refreshes schema after CREATE TABLE', async () => {
    const cache = createMockSchemaCache()
    const executor = new DDLExecutor(
      createMockAdapter(),
      new PostgreSQLDDLGenerator(),
      'admin',
      undefined,
      cache as any
    )
    await executor.execute(createTableOp, { execute: true })
    expect(cache.refreshTable).toHaveBeenCalledWith('posts', expect.any(Object))
  })

  test('invalidates schema after DROP TABLE', async () => {
    const cache = createMockSchemaCache()
    const executor = new DDLExecutor(
      createMockAdapter(),
      new PostgreSQLDDLGenerator(),
      'admin',
      undefined,
      cache as any
    )
    await executor.execute(dropTableOp, { execute: true, force: true })
    expect(cache.invalidateTable).toHaveBeenCalledWith('posts')
  })

  test('no cache does not error', async () => {
    const executor = new DDLExecutor(
      createMockAdapter(),
      new PostgreSQLDDLGenerator(),
      'admin'
    )
    const result = await executor.execute(createTableOp, { execute: true })
    expect(result.status).toBe('success')
  })
})

// ── SQL generation delegation ────────────────────────────────────────────

describe('DDLExecutor SQL generation', () => {
  const executor = new DDLExecutor(
    createMockAdapter(), new PostgreSQLDDLGenerator(), 'admin'
  )

  test('addColumn', async () => {
    const op: DDLOperation = {
      kind: 'addColumn', table: 'users',
      column: { name: 'bio', type: 'text', nullable: true }
    }
    const result = await executor.execute(op)
    expect(result.sql).toContain('ADD COLUMN "bio" TEXT')
  })

  test('dropColumn', async () => {
    const op: DDLOperation = { kind: 'dropColumn', table: 'users', column: 'bio' }
    const result = await executor.execute(op)
    expect(result.sql).toContain('DROP COLUMN "bio"')
  })

  test('alterColumn', async () => {
    const op: DDLOperation = {
      kind: 'alterColumn',
      options: { table: 'users', column: 'name', type: 'varchar(200)' }
    }
    const result = await executor.execute(op)
    expect(result.sql).toContain('TYPE VARCHAR(200)')
  })

  test('addIndex', async () => {
    const op: DDLOperation = {
      kind: 'addIndex',
      index: { table: 'users', columns: ['email'], unique: true }
    }
    const result = await executor.execute(op)
    expect(result.sql).toContain('CREATE UNIQUE INDEX')
  })

  test('addConstraint FK', async () => {
    const op: DDLOperation = {
      kind: 'addConstraint',
      constraint: {
        table: 'orders', type: 'foreign_key',
        column: 'user_id', references: { table: 'users', column: 'id' },
        onDelete: 'cascade'
      }
    }
    const result = await executor.execute(op)
    expect(result.sql).toContain('FOREIGN KEY')
    expect(result.sql).toContain('ON DELETE CASCADE')
  })

  test('addEnum', async () => {
    const op: DDLOperation = {
      kind: 'addEnum',
      definition: { name: 'status', values: ['active', 'inactive'] }
    }
    const result = await executor.execute(op)
    expect(result.sql).toContain('CREATE TYPE "status" AS ENUM')
  })

  test('warnings are passed through', async () => {
    const op: DDLOperation = { kind: 'alterEnum', name: 'status', addValue: 'archived' }
    const result = await executor.execute(op)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

// ── Error handling ───────────────────────────────────────────────────────

describe('DDLExecutor error handling', () => {
  test('adapter execute failure returns error result', async () => {
    const adapter = createMockAdapter()
    ;(adapter.execute as any).mockImplementation(() => {
      throw new Error('syntax error')
    })
    const executor = new DDLExecutor(adapter, new PostgreSQLDDLGenerator(), 'admin')
    const result = await executor.execute(createTableOp, { execute: true })
    expect(result.status).toBe('error')
    expect(result.error).toContain('syntax error')
  })
})
