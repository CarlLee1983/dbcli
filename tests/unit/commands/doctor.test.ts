import { describe, test, expect, spyOn } from 'bun:test'
import {
  runDoctorChecks,
  resolveSchemaLastUpdated,
  collectMongoDoctorResults,
  type DoctorResult,
} from '../../../src/commands/doctor'
import { AdapterFactory } from '@/adapters'

describe('doctor checks', () => {
  test('resolveSchemaLastUpdated prefers index metadata.lastRefreshed', () => {
    const ts = '2026-04-01T12:00:00.000Z'
    expect(
      resolveSchemaLastUpdated(
        { metadata: { lastRefreshed: ts }, hotTables: [], tables: {} },
        { schemaLastUpdated: '2026-03-01T00:00:00.000Z' }
      )
    ).toBe(ts)
  })

  test('resolveSchemaLastUpdated falls back to config schemaLastUpdated when no index', () => {
    const ts = '2026-04-20T08:00:00.000Z'
    expect(resolveSchemaLastUpdated(null, { schemaLastUpdated: ts })).toBe(ts)
  })

  test('checkBunVersion passes when version meets requirement', () => {
    const result = runDoctorChecks.checkBunVersion('1.3.3', '1.3.3')
    expect(result.status).toBe('pass')
  })

  test('checkBunVersion fails when version is too old', () => {
    const result = runDoctorChecks.checkBunVersion('1.2.0', '1.3.3')
    expect(result.status).toBe('error')
  })

  test('checkConfigExists passes when config file exists', async () => {
    const result = await runDoctorChecks.checkConfigExists('.dbcli', async () => true)
    expect(result.status).toBe('pass')
  })

  test('checkConfigExists fails when config file missing', async () => {
    const result = await runDoctorChecks.checkConfigExists('.dbcli', async () => false)
    expect(result.status).toBe('error')
  })

  test('checkBlacklistCompleteness warns about sensitive column names', () => {
    const columns = new Map<string, string[]>([
      ['users', ['id', 'email', 'password_hash', 'name']]
    ])
    const blacklistedColumns = new Map<string, Set<string>>()
    const result = runDoctorChecks.checkBlacklistCompleteness(columns, blacklistedColumns)
    expect(result.status).toBe('warn')
    expect(result.message).toContain('password_hash')
  })

  test('checkBlacklistCompleteness passes when sensitive columns are protected', () => {
    const columns = new Map<string, string[]>([
      ['users', ['id', 'email', 'password_hash']]
    ])
    const blacklistedColumns = new Map<string, Set<string>>([
      ['users', new Set(['password_hash'])]
    ])
    const result = runDoctorChecks.checkBlacklistCompleteness(columns, blacklistedColumns)
    expect(result.status).toBe('pass')
  })

  test('checkSchemaCacheFreshness warns when cache is older than 7 days', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const result = runDoctorChecks.checkSchemaCacheFreshness(eightDaysAgo)
    expect(result.status).toBe('warn')
  })

  test('checkSchemaCacheFreshness passes when cache is fresh', () => {
    const now = new Date().toISOString()
    const result = runDoctorChecks.checkSchemaCacheFreshness(now)
    expect(result.status).toBe('pass')
  })

  test('checkSchemaCacheFreshness warns when no cache exists', () => {
    const result = runDoctorChecks.checkSchemaCacheFreshness(null)
    expect(result.status).toBe('warn')
  })

  test('checkLargeTables warns about tables with > 1M rows', () => {
    const tables = [
      { name: 'users', estimatedRowCount: 500 },
      { name: 'logs', estimatedRowCount: 5_000_000 },
      { name: 'orders', estimatedRowCount: 2_000_000 },
    ]
    const result = runDoctorChecks.checkLargeTables(tables)
    expect(result.status).toBe('warn')
    expect(result.message).toContain('logs')
    expect(result.message).toContain('orders')
    expect(result.message).not.toContain('users')
  })

  test('checkLargeTables passes when no large tables', () => {
    const tables = [
      { name: 'users', estimatedRowCount: 500 },
    ]
    const result = runDoctorChecks.checkLargeTables(tables)
    expect(result.status).toBe('pass')
  })

  test('checkMongoSrvConnectivity passes when SRV lookup succeeds directly', async () => {
    const result = await runDoctorChecks.checkMongoSrvConnectivity(
      'mongodb+srv://user:pass@cluster.example.mongodb.net/mydb',
      {
        resolveSrvFn: async () => [{ name: 'a.example.com', port: 27017 }],
      }
    )

    expect(result).not.toBeNull()
    expect(result?.status).toBe('pass')
    expect(result?.message).toContain('reachable')
  })

  test('checkMongoSrvConnectivity warns when direct SRV lookup fails but DoH fallback works', async () => {
    const result = await runDoctorChecks.checkMongoSrvConnectivity(
      'mongodb+srv://user:pass@cluster.example.mongodb.net/mydb',
      {
        resolveSrvFn: async () => {
          const error = new Error('querySrv ECONNREFUSED _mongodb._tcp.cluster.example.mongodb.net')
          ;(error as { code?: string }).code = 'ECONNREFUSED'
          throw error
        },
        fetchFn: async () =>
          new Response(JSON.stringify({ Status: 0, Answer: [{ data: '0 0 27017 a.example.com.' }] })),
      }
    )

    expect(result).not.toBeNull()
    expect(result?.status).toBe('warn')
    expect(result?.message).toContain('DNS-over-HTTPS')
  })

  test('checkMongoSrvConnectivity errors when direct and fallback lookups fail', async () => {
    const result = await runDoctorChecks.checkMongoSrvConnectivity(
      'mongodb+srv://user:pass@cluster.example.mongodb.net/mydb',
      {
        resolveSrvFn: async () => {
          const error = new Error('querySrv ECONNREFUSED _mongodb._tcp.cluster.example.mongodb.net')
          ;(error as { code?: string }).code = 'ECONNREFUSED'
          throw error
        },
        fetchFn: async () => {
          throw new Error('Unable to connect. Is the computer able to access the url?')
        },
      }
    )

    expect(result).not.toBeNull()
    expect(result?.status).toBe('error')
    expect(result?.message).toContain('DNS-over-HTTPS fallback also failed')
  })

  test('formatTextOutput produces expected structure', () => {
    const results: DoctorResult[] = [
      { group: 'Environment', label: 'Bun version', status: 'pass', message: 'Bun v1.3.3 (meets >= 1.3.3)' },
      { group: 'Configuration', label: 'Config exists', status: 'warn', message: 'Schema cache is 12 days old' },
      { group: 'Connection & Data', label: 'Connection', status: 'error', message: 'Connection refused' },
    ]
    const output = runDoctorChecks.formatTextOutput(results, '0.4.0-beta')
    expect(output).toContain('dbcli doctor v0.4.0-beta')
    expect(output).toContain('Environment')
    expect(output).toContain('Configuration')
    expect(output).toContain('Connection & Data')
    expect(output).toContain('1 passed')
    expect(output).toContain('1 warning')
    expect(output).toContain('1 error')
  })

  test('collectMongoDoctorResults returns MongoDB-specific checks', async () => {
    const adapter = {
      connect: async () => {},
      disconnect: async () => {},
      getServerVersion: async () => '7.0.0',
      listCollections: async () => [{ name: 'users', documentCount: 2 }],
      testConnection: async () => true,
      execute: async () => ({ rows: [], affectedRows: 0 }),
    }

    const spy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      adapter as unknown as ReturnType<typeof AdapterFactory.createMongoDBAdapter>
    )
    const srvSpy = spyOn(runDoctorChecks, 'checkMongoSrvConnectivity').mockResolvedValue({
      group: 'Environment',
      label: 'MongoDB SRV lookup',
      status: 'warn',
      message: 'Direct SRV DNS lookup failed in this shell, but DNS-over-HTTPS fallback resolved cluster.example.mongodb.net.',
    })
    const results = await collectMongoDoctorResults({
      connection: {
        system: 'mongodb',
        uri: 'mongodb+srv://user:pass@cluster.example.mongodb.net/testdb',
        host: '',
        port: 27017,
        user: '',
        password: '',
        database: 'testdb',
      },
      metadata: {},
    })

    expect(results.some((result) => result.label === 'MongoDB SRV lookup' && result.status === 'warn')).toBe(true)
    expect(results.some((result) => result.label === 'Connection' && result.status === 'pass')).toBe(true)
    expect(results.some((result) => result.label === 'Collections' && result.status === 'pass')).toBe(true)
    spy.mockRestore()
    srvSpy.mockRestore()
  })
})
