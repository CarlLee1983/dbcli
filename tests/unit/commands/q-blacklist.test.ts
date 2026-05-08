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
  constructor(private rows: Record<string, unknown>[]) {}
  async connect() {}
  async disconnect() {}
  async execute<T>(sql: string, params?: any[]): Promise<ExecutionResult<T>> {
    this.lastSql = sql
    this.lastParams = params ?? []
    return { rows: this.rows as T[], affectedRows: this.rows.length }
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
let errSpy: any
let exitSpy: any
let originalCwd = ''

function writeSnippet(name: string, body: string) {
  writeFileSync(
    join(workdir, '.dbcli-shared/queries', `${name}.sql`),
    `-- ---\n-- name: ${name}\n-- engine: postgres\n-- ---\n${body}`
  )
}

function setConfig(blacklist: { tables?: string[]; columns?: Record<string, string[]> }) {
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
    blacklist: { tables: blacklist.tables ?? [], columns: blacklist.columns ?? {} },
  } as any)
}

beforeEach(() => {
  originalCwd = process.cwd()
  workdir = mkdtempSync(join(tmpdir(), 'q-blacklist-'))
  mkdirSync(join(workdir, '.dbcli-shared/queries'), { recursive: true })
  process.chdir(workdir)
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
  errSpy = spyOn(console, 'error').mockImplementation(() => {})
  exitSpy = spyOn(process, 'exit').mockImplementation(((_: number) => undefined) as any)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
  logSpy.mockRestore()
  errSpy.mockRestore()
  exitSpy.mockRestore()
})

describe('dbcli q — blacklist enforcement (regression for 1.10.0 bypass)', () => {
  test('blocks snippet whose target table is blacklisted', async () => {
    writeSnippet('users-leak', 'SELECT id, email FROM users')
    setConfig({ tables: ['users'] })
    mock = new MockAdapter([{ id: 1, email: 'a@b.c' }])
    spyOn(AdapterFactory, 'createAdapter').mockReturnValue(mock as any)

    await qCommand('@users-leak', { format: 'json', noLimit: true })

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(mock.lastSql).toBe('') // never executed
    const errors = errSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(errors).toMatch(/users/)
  })

  test('redacts blacklisted columns from snippet result rows', async () => {
    writeSnippet('users-list', 'SELECT id, email, password_hash FROM users')
    setConfig({ columns: { users: ['password_hash'] } })
    mock = new MockAdapter([{ id: 1, email: 'a@b.c', password_hash: 'SECRET' }])
    spyOn(AdapterFactory, 'createAdapter').mockReturnValue(mock as any)

    await qCommand('@users-list', { format: 'json', noLimit: true })

    expect(exitSpy).not.toHaveBeenCalled()
    const printed = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(printed).not.toMatch(/SECRET/)
    expect(printed).not.toMatch(/password_hash/)
    expect(printed).toMatch(/a@b\.c/)
  })

  test('allows snippet when target table is not blacklisted', async () => {
    writeSnippet('events-count', 'SELECT COUNT(*) AS n FROM events')
    setConfig({ tables: ['users'] })
    mock = new MockAdapter([{ n: 42 }])
    spyOn(AdapterFactory, 'createAdapter').mockReturnValue(mock as any)

    await qCommand('@events-count', { format: 'json', noLimit: true })

    expect(exitSpy).not.toHaveBeenCalled()
    expect(mock.lastSql).toMatch(/COUNT/)
  })
})
