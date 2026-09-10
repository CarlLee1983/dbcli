/**
 * SQLite 寫入路徑（DBCLI-035）
 *
 * 走的是 DataExecutor，也就是其他 SQL 引擎用的同一條路，所以這裡要證明的是
 * 「SQLite 沒有特殊性」：同樣的階梯、同樣的 --dry-run 語意、生成的 SQL 用
 * SQLite 的標準引號與佔位符。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { SQLiteAdapter } from '@/adapters/sqlite-adapter'
import { DataExecutor } from '@/core/data-executor'
import type { ConnectionOptions, TableSchema } from '@/adapters/types'

let workDir: string
let dbPath: string

const schema: TableSchema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
    { name: 'email', type: 'TEXT', nullable: false },
    { name: 'nickname', type: 'TEXT', nullable: true },
  ],
  columnCount: 3,
  rowCount: 0,
  tableType: 'table',
} as TableSchema

function options(): ConnectionOptions {
  return {
    system: 'sqlite',
    file: dbPath,
    host: '',
    port: 0,
    user: '',
    password: '',
    database: '',
  } as ConnectionOptions
}

async function connected(): Promise<SQLiteAdapter> {
  const adapter = new SQLiteAdapter(options())
  await adapter.connect()
  return adapter
}

function readRows(): { id: number; email: string; nickname: string | null }[] {
  const db = new Database(dbPath, { readonly: true })
  const rows = db.query('SELECT id, email, nickname FROM users ORDER BY id').all() as never
  db.close()
  return rows
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-sqlite-write-'))
  dbPath = join(workDir, 'app.sqlite')
  const seed = new Database(dbPath, { create: true })
  seed.run('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, nickname TEXT)')
  seed.run("INSERT INTO users (id, email, nickname) VALUES (1, 'a@example.com', 'a')")
  seed.close()
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('data-admin 的寫入', () => {
  test('insert 寫得進去並回報影響列數', async () => {
    const adapter = await connected()
    try {
      const executor = new DataExecutor(adapter, 'data-admin', 'sqlite')
      const result = await executor.executeInsert(
        'users',
        { id: 2, email: 'b@example.com', nickname: null },
        schema,
        { force: true }
      )

      expect(result.status).toBe('success')
      expect(result.rows_affected).toBe(1)
    } finally {
      await adapter.disconnect()
    }

    expect(readRows()).toHaveLength(2)
  })

  test('update 需要 where，且只改到指定的列', async () => {
    const adapter = await connected()
    try {
      const executor = new DataExecutor(adapter, 'data-admin', 'sqlite')
      const result = await executor.executeUpdate(
        'users',
        { nickname: 'renamed' },
        { id: 1 },
        schema,
        { force: true }
      )
      expect(result.status).toBe('success')
      expect(result.rows_affected).toBe(1)
    } finally {
      await adapter.disconnect()
    }

    expect(readRows()[0]?.nickname).toBe('renamed')
  })

  test('delete 移除指定的列', async () => {
    const adapter = await connected()
    try {
      const executor = new DataExecutor(adapter, 'data-admin', 'sqlite')
      const result = await executor.executeDelete('users', { id: 1 }, schema, { force: true })
      expect(result.status).toBe('success')
      expect(result.rows_affected).toBe(1)
    } finally {
      await adapter.disconnect()
    }

    expect(readRows()).toHaveLength(0)
  })
})

describe('--dry-run', () => {
  test('印出 SQLite 標準引號與 ? 佔位符，且不動檔案', async () => {
    const before = await stat(dbPath)
    const adapter = await connected()
    let sql = ''
    try {
      const executor = new DataExecutor(adapter, 'data-admin', 'sqlite')
      const result = await executor.executeInsert(
        'users',
        { id: 2, email: 'b@example.com', nickname: null },
        schema,
        { dryRun: true, force: true }
      )
      expect(result.status).toBe('dry_run')
      sql = result.sql ?? ''
    } finally {
      await adapter.disconnect()
    }

    expect(sql).toContain('"users"')
    expect(sql).toContain('"email"')
    expect(sql).not.toContain('`')
    expect(sql).toContain('?')
    expect(sql).not.toMatch(/\$\d/)

    const after = await stat(dbPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(readRows()).toHaveLength(1)
  })
})

describe('權限階梯與其他 SQL 引擎相同', () => {
  test('query-only 不能 insert', async () => {
    const adapter = await connected()
    try {
      const executor = new DataExecutor(adapter, 'query-only', 'sqlite')
      const result = await executor.executeInsert(
        'users',
        { id: 2, email: 'b@example.com' },
        schema,
        { force: true }
      )

      expect(result.status).toBe('error')
      expect(result.error).toMatch(/read-write/)
    } finally {
      await adapter.disconnect()
    }

    expect(readRows()).toHaveLength(1)
  })

  test('read-write 不能 delete', async () => {
    const adapter = await connected()
    try {
      const executor = new DataExecutor(adapter, 'read-write', 'sqlite')
      const result = await executor.executeDelete('users', { id: 1 }, schema, { force: true })

      expect(result.status).toBe('error')
      expect(result.error).toMatch(/data-admin/)
    } finally {
      await adapter.disconnect()
    }

    expect(readRows()).toHaveLength(1)
  })
})
