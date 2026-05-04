import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseAdapter, ExecutionResult } from '@/adapters/types'
import { AdapterFactory } from '@/adapters'
import { configModule } from '@/core/config'
import { qCommand } from '@/commands/q'

class MockAdapter implements DatabaseAdapter {
  public lastSql = ''
  public lastParams: any[] = []
  async connect() {}
  async disconnect() {}
  async execute<T>(sql: string, params?: any[]): Promise<ExecutionResult<T>> {
    this.lastSql = sql
    this.lastParams = params ?? []
    return { rows: [{ dau: 42 }] as T[], affectedRows: 1 }
  }
  async listTables() {
    return []
  }
  async getTableSchema() {
    return { name: '', columns: [] }
  }
  async testConnection() {
    return true
  }
  async getServerVersion() {
    return 'test'
  }
}

let workdir = ''
let mock: MockAdapter
let logSpy: any
let exitSpy: any
let originalCwd = ''

beforeEach(() => {
  originalCwd = process.cwd()
  workdir = mkdtempSync(join(tmpdir(), 'q-test-'))
  mkdirSync(join(workdir, '.dbcli-shared/queries'), { recursive: true })
  writeFileSync(
    join(workdir, '.dbcli-shared/queries/dau.sql'),
    `-- ---\n-- name: DAU\n-- engine: postgres\n-- params:\n--   days:\n--     type: int\n--     default: 7\n-- ---\nSELECT COUNT(*) FROM events WHERE created_at > NOW() - (:days || ' days')::interval;`
  )
  process.chdir(workdir)
  mock = new MockAdapter()
  spyOn(AdapterFactory, 'createAdapter').mockReturnValue(mock as any)
  spyOn(configModule, 'read').mockResolvedValue({
    connection: {
      system: 'postgresql',
      host: 'h',
      port: 5432,
      user: 'u',
      password: '',
      database: 'd',
    },
    permission: 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
  } as any)
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
  exitSpy = spyOn(process, 'exit').mockImplementation(((_: number) => undefined) as any)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})

describe('dbcli q', () => {
  test('rewrites :name to $1 and binds default param', async () => {
    await qCommand('@dau', { format: 'json', noLimit: true })
    expect(mock.lastSql).toMatch(/\$1/)
    expect(mock.lastParams).toEqual([7])
    expect(logSpy).toHaveBeenCalled()
  })

  test('--dry-run prints SQL without executing', async () => {
    await qCommand('@dau', { dryRun: true })
    expect(mock.lastSql).toBe('')
    const printed = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(printed).toMatch(/SELECT/)
  })

  test('--param overrides default', async () => {
    await qCommand('@dau', { param: ['days=30'], format: 'json', noLimit: true })
    expect(mock.lastParams).toEqual([30])
  })

  test('unknown @name → exits 1', async () => {
    await qCommand('@missing', {})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
