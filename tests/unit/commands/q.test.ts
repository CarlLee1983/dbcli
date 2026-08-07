import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  spyOn,
  mock as bunMock,
} from 'bun:test'
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
  /** When set, execute() returns this many synthetic rows instead of the default single row. */
  public rowsToReturn: number | undefined
  async connect() {}
  async disconnect() {}
  async execute<T>(sql: string, params?: any[]): Promise<ExecutionResult<T>> {
    this.lastSql = sql
    this.lastParams = params ?? []
    if (this.rowsToReturn !== undefined) {
      const rows = Array.from({ length: this.rowsToReturn }, (_, i) => ({ dau: i }))
      return { rows: rows as T[], affectedRows: rows.length }
    }
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

// Restore spies (AdapterFactory.createAdapter, config.read, console.log,
// process.exit) once this file completes so they do not leak into later test
// files. Bun's spyOn persists across files in the same process; without this
// the mocked createAdapter/process.exit pollute factory/insert-plan/delete-plan
// tests when bun runs files in a different order (e.g. Linux CI vs macOS).
afterAll(() => {
  bunMock.restore()
})

describe('dbcli q', () => {
  test('rewrites :name to $1 and binds default param', async () => {
    await qCommand('@dau', { format: 'json', noLimit: true })
    expect(mock.lastSql).toMatch(/\$1/)
    expect(mock.lastParams).toEqual([7])
    expect(logSpy).toHaveBeenCalled()
  })

  describe('passive slow-query advisory', () => {
    /**
     * `q` measures its own elapsed time, so the mock adapter has to actually
     * take time. The assertion is one-sided (advisory present at a 1ms
     * threshold after a 25ms delay) rather than a duration bound, so it does
     * not depend on how fast the host is.
     */
    test('attaches the advisory to the formatted result once the threshold is crossed', async () => {
      const slowExecute = spyOn(mock, 'execute').mockImplementation(async (sql: string) => {
        await Bun.sleep(25)
        return { rows: [{ dau: 42 }], affectedRows: 1, sql } as any
      })

      logSpy.mockClear()
      await qCommand('@dau', { format: 'json', noLimit: true, slowMs: 1 })

      const printed = logSpy.mock.calls.at(-1)!.join(' ')
      expect(JSON.parse(printed).metadata.performanceAdvisory).toMatchObject({
        code: 'SLOW_QUERY',
        thresholdMs: 1,
      })
      slowExecute.mockRestore()
    })

    test('suppresses the advisory under --recovery even past the threshold', async () => {
      const slowExecute = spyOn(mock, 'execute').mockImplementation(async (sql: string) => {
        await Bun.sleep(25)
        return { rows: [{ dau: 42 }], affectedRows: 1, sql } as any
      })

      logSpy.mockClear()
      await qCommand('@dau', { format: 'json', noLimit: true, slowMs: 1, recovery: true })

      const printed = logSpy.mock.calls.at(-1)!.join(' ')
      expect(JSON.parse(printed).metadata?.performanceAdvisory).toBeUndefined()
      slowExecute.mockRestore()
    })
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

  describe('snippet guard truncation is reported in the result itself', () => {
    // console.log spy call history accumulates across tests in this file, so
    // always read the output this test produced rather than joining them all.
    const lastPrinted = () => String(logSpy.mock.calls.at(-1)?.[0] ?? '')

    test('json marks truncated and trims the lookahead row', async () => {
      // Guard fetches 1001; the extra row proves the snippet had more to give.
      mock.rowsToReturn = 1001
      await qCommand('@dau', { format: 'json' })
      const payload = JSON.parse(lastPrinted())
      expect(payload.rowCount).toBe(1000)
      expect(payload.rows).toHaveLength(1000)
      expect(payload.metadata.truncated).toBe(true)
      expect(payload.metadata.limit_applied).toBe(1000)
    })

    test('exactly 1000 rows is not reported as truncated', async () => {
      mock.rowsToReturn = 1000
      await qCommand('@dau', { format: 'json' })
      const payload = JSON.parse(lastPrinted())
      expect(payload.rowCount).toBe(1000)
      expect(payload.metadata.truncated).toBe(false)
    })

    test('table footer states the truncation', async () => {
      mock.rowsToReturn = 1001
      await qCommand('@dau', { format: 'table' })
      expect(lastPrinted()).toContain('Rows: 1000 (truncated; limit 1000)')
    })

    test('HTML carries snippet-guard truncation into the dashboard payload', async () => {
      mock.rowsToReturn = 1001
      await qCommand('@dau', { format: 'html' })
      expect(lastPrinted()).toContain('"appliedLimit":{"truncated":true,"limitApplied":1000}')
    })

    test('--no-limit leaves rows untouched and reports no truncation', async () => {
      mock.rowsToReturn = 1500
      await qCommand('@dau', { format: 'json', noLimit: true })
      const payload = JSON.parse(lastPrinted())
      expect(payload.rowCount).toBe(1500)
      expect(payload.metadata.truncated).toBeUndefined()
    })
  })
})
