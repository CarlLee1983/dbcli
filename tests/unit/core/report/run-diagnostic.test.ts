import { describe, test, expect } from 'bun:test'
import { runDiagnostic } from '@/core/report/run-diagnostic'
import type { ResolvedSnippet } from '@/core/saved-queries'
import type { DatabaseAdapter, ExecutionResult } from '@/adapters/types'

function snippet(meta: Partial<ResolvedSnippet['query']['meta']> = {}): ResolvedSnippet {
  return {
    query: {
      meta: {
        name: '@diag/db-size',
        key: '@diag/db-size',
        description: 'Database size',
        engine: ['postgres'],
        params: [],
        tags: [],
        intent: 'capacity.size',
        ...meta,
      },
      sqlBody: 'SELECT 1 AS one, 2 AS two',
      file: 'assets/db-size.postgres.sql',
      source: 'builtin',
    },
    hasLocalOverride: false,
  }
}

function adapterReturning<T>(result: ExecutionResult<T>): DatabaseAdapter {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    execute: async () => result as never,
    listTables: async () => [],
    getTableSchema: async () => ({ name: 't', columns: [] }),
    testConnection: async () => true,
    getServerVersion: async () => '16.4',
  }
}

describe('runDiagnostic', () => {
  test('returns ok evidence with truncated rows + duration', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i }))
    const adapter = adapterReturning({ rows, affectedRows: 0 })
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('ok')
    expect(ev.rowCount).toBe(100)
    expect(ev.rows.length).toBe(10)
    expect(ev.snippet).toBe('@diag/db-size')
    expect(ev.intent).toBe('capacity.size')
    expect(ev.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('returns no-data when adapter returns zero rows', async () => {
    const adapter = adapterReturning({
      rows: [] as Array<Record<string, unknown>>,
      affectedRows: 0,
    })
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('no-data')
    expect(ev.rowCount).toBe(0)
    expect(ev.rows).toEqual([])
  })

  test('returns error evidence when adapter.execute throws', async () => {
    const adapter: DatabaseAdapter = {
      ...adapterReturning({ rows: [], affectedRows: 0 }),
      execute: async () => {
        throw new Error('boom')
      },
    }
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('error')
    expect(ev.reason).toContain('boom')
    expect(ev.rows).toEqual([])
  })

  test('returns timeout evidence when execute exceeds timeoutMs', async () => {
    const adapter: DatabaseAdapter = {
      ...adapterReturning({ rows: [], affectedRows: 0 }),
      execute: () => new Promise(() => undefined),
    }
    const ev = await runDiagnostic({
      snippet: snippet(),
      adapter,
      engine: 'postgres',
      timeoutMs: 30,
      maxRows: 10,
    })
    expect(ev.status).toBe('timeout')
    expect(ev.reason).toContain('30ms')
  })

  test('returns skipped when prepareExecution rejects (engine mismatch)', async () => {
    const adapter = adapterReturning({ rows: [], affectedRows: 0 })
    const ev = await runDiagnostic({
      snippet: snippet({ engine: ['mysql'] }),
      adapter,
      engine: 'postgres',
      timeoutMs: 1000,
      maxRows: 10,
    })
    expect(ev.status).toBe('skipped')
    expect(ev.reason).toBeDefined()
  })
})
