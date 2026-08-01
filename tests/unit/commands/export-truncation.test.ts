/**
 * export must never silently drop rows.
 *
 * An export whose row cap was chosen by dbcli (query-only auto-limit) and that
 * actually hit the cap writes an incomplete file with nowhere to record the
 * fact — jsonl and mongo json are bare shapes. So dbcli fails closed and makes
 * the caller state the intent with --no-limit or --limit N.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { AdapterFactory } from '@/adapters'
import { exportCommand } from '@/commands/export'

const sqlConnection = {
  system: 'mysql' as const,
  host: 'h',
  port: 3306,
  user: 'u',
  password: '',
  database: 'd',
}

const mongoConnection = {
  system: 'mongodb' as const,
  uri: 'mongodb://localhost:27017/testdb',
  host: '',
  port: 27017,
  user: '',
  password: '',
  database: 'testdb',
}

const elasticsearchConnection = {
  system: 'elasticsearch' as const,
  host: 'localhost',
  port: 9200,
  user: '',
  password: '',
  database: '',
}

function rowsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: i }))
}

function makeAdapter(rowCount: number) {
  const state = { lastSql: '', lastLimit: undefined as number | undefined }
  return {
    state,
    async connect() {},
    async disconnect() {},
    async execute(sql: string, _params?: unknown[], opts?: { limit?: number }) {
      state.lastSql = sql
      state.lastLimit = opts?.limit
      // Emulate the server honouring whatever LIMIT/limit dbcli asked for.
      const requested =
        opts?.limit ?? Number(sql.match(/LIMIT\s+(\d+)\s*$/i)?.[1] ?? Number.POSITIVE_INFINITY)
      return {
        rows: rowsOf(Math.min(rowCount, requested)),
        affectedRows: Math.min(rowCount, requested),
      }
    },
  }
}

describe('export fails closed on dbcli-owned truncation', () => {
  let configSpy: any
  let sqlSpy: any
  let mongoSpy: any
  let elasticsearchSpy: any
  let logSpy: any
  let errSpy: any
  let stdout: string[]

  beforeEach(() => {
    stdout = []
    logSpy = spyOn(console, 'log').mockImplementation((m: any) => {
      stdout.push(String(m))
    })
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    configSpy?.mockRestore()
    sqlSpy?.mockRestore()
    mongoSpy?.mockRestore()
    elasticsearchSpy?.mockRestore()
    logSpy.mockRestore()
    errSpy.mockRestore()
  })

  function mockConfig(connection: unknown, permission = 'query-only') {
    configSpy = spyOn(configModule, 'read').mockResolvedValue({
      connection,
      permission,
      schema: {},
      metadata: { version: '1.0' },
      blacklist: { tables: [], columns: {} },
    } as any)
  }

  describe('SQL export', () => {
    test('rejects an export that hit the auto-limit', async () => {
      mockConfig(sqlConnection)
      const adapter = makeAdapter(1500)
      sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)

      await expect(exportCommand('SELECT * FROM bet_log', { format: 'json' })).rejects.toThrow(
        /auto-limit/i
      )
      expect(stdout.join('')).toBe('')
    })

    test('accepts an export that exactly fills the auto-limit', async () => {
      mockConfig(sqlConnection)
      const adapter = makeAdapter(1000)
      sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)

      await exportCommand('SELECT * FROM bet_log', { format: 'json' })
      const payload = JSON.parse(stdout.join('\n'))
      expect(payload.rowCount).toBe(1000)
      expect(payload.metadata.truncated).toBe(false)
    })

    test('--no-limit exports everything without the cap', async () => {
      mockConfig(sqlConnection)
      const adapter = makeAdapter(1500)
      sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)

      await exportCommand('SELECT * FROM bet_log', { format: 'json', noLimit: true })
      const payload = JSON.parse(stdout.join('\n'))
      expect(payload.rowCount).toBe(1500)
    })

    test('an explicit --limit is an accepted cap, not a silent one', async () => {
      mockConfig(sqlConnection)
      const adapter = makeAdapter(1500)
      sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)

      await exportCommand('SELECT * FROM bet_log', { format: 'json', limit: 500 })
      const payload = JSON.parse(stdout.join('\n'))
      expect(payload.rowCount).toBe(500)
      expect(payload.metadata.truncated).toBe(true)
    })

    test('csv records the accepted cap as a comment line', async () => {
      mockConfig(sqlConnection)
      const adapter = makeAdapter(1500)
      sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)

      await exportCommand('SELECT * FROM bet_log', { format: 'csv', limit: 500 })
      expect(stdout.join('\n')).toContain('# truncated; limit 500')
    })

    test('HTML records the accepted cap in the dashboard payload', async () => {
      mockConfig(sqlConnection)
      const adapter = makeAdapter(1500)
      sqlSpy = spyOn(AdapterFactory, 'createSqlAdapter').mockReturnValue(adapter as any)

      await exportCommand('SELECT * FROM bet_log', { format: 'html', limit: 500 })
      expect(stdout.join('\n')).toContain('"appliedLimit":{"truncated":true,"limitApplied":500}')
    })
  })

  describe('MongoDB export', () => {
    test('rejects an export that hit the auto-limit', async () => {
      mockConfig(mongoConnection)
      const adapter = makeAdapter(1500)
      mongoSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)

      await expect(
        exportCommand('{"station_code":"x"}', { format: 'json', collection: 'raw_bet_log' })
      ).rejects.toThrow(/auto-limit/i)
      expect(stdout.join('')).toBe('')
    })

    test('exactly 1000 documents exports cleanly', async () => {
      mockConfig(mongoConnection)
      const adapter = makeAdapter(1000)
      mongoSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)

      await exportCommand('{"station_code":"x"}', { format: 'json', collection: 'raw_bet_log' })
      expect(JSON.parse(stdout.join('\n'))).toHaveLength(1000)
    })

    test('--no-limit exports everything', async () => {
      mockConfig(mongoConnection)
      const adapter = makeAdapter(1500)
      mongoSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)

      await exportCommand('{"station_code":"x"}', {
        format: 'json',
        collection: 'raw_bet_log',
        noLimit: true,
      })
      expect(JSON.parse(stdout.join('\n'))).toHaveLength(1500)
    })

    test('the lookahead row never reaches the exported file', async () => {
      mockConfig(mongoConnection)
      const adapter = makeAdapter(1500)
      mongoSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)

      await exportCommand('{"station_code":"x"}', {
        format: 'json',
        collection: 'raw_bet_log',
        limit: 500,
      })
      expect(JSON.parse(stdout.join('\n'))).toHaveLength(500)
    })

    test('HTML records the accepted cap in the dashboard payload', async () => {
      mockConfig(mongoConnection)
      const adapter = makeAdapter(1500)
      mongoSpy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(adapter as any)

      await exportCommand('{"station_code":"x"}', {
        format: 'html',
        collection: 'raw_bet_log',
        limit: 500,
      })
      expect(stdout.join('\n')).toContain('"appliedLimit":{"truncated":true,"limitApplied":500}')
    })
  })

  describe('Elasticsearch export', () => {
    test('HTML records the accepted cap in the dashboard payload', async () => {
      mockConfig(elasticsearchConnection)
      const adapter = makeAdapter(1500)
      elasticsearchSpy = spyOn(AdapterFactory, 'createElasticsearchAdapter').mockReturnValue(
        adapter as any
      )

      await exportCommand('{"query":{"match_all":{}}}', {
        format: 'html',
        index: 'events',
        limit: 500,
      })
      expect(stdout.join('\n')).toContain('"appliedLimit":{"truncated":true,"limitApplied":500}')
    })
  })
})
