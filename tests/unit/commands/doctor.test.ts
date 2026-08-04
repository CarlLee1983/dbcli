import { describe, test, expect, spyOn } from 'bun:test'
import {
  runDoctorChecks,
  resolveSchemaLastUpdated,
  collectMongoDoctorResults,
  buildDoctorRemediationPlan,
  type DoctorResult,
} from '../../../src/commands/doctor'
import type { RuntimeInfo } from '@/utils/runtime-info'
import { AdapterFactory } from '@/adapters'

describe('doctor checks', () => {
  test('checkRuntime reports executable provenance and package mismatch remediation', () => {
    const info: RuntimeInfo = {
      executablePath: '/usr/local/bin/bun',
      launcherPath: '/opt/dbcli/dist/cli.mjs',
      packageRoot: '/opt/dbcli',
      packageVersion: '1.44.0',
      packageFileVersion: '1.44.1',
      runtimeName: 'bun',
      runtimeVersion: '1.3.10',
      source: 'installed',
      versionMismatch: true,
    }
    const result = runDoctorChecks.checkRuntime(info)
    expect(result.status).toBe('warn')
    expect(result.message).toContain('bundle/package mismatch')
    expect(result.details).toMatchObject({
      source: 'installed',
      executablePath: '/usr/local/bin/bun',
      packageVersion: '1.44.0',
      packageFileVersion: '1.44.1',
      versionMismatch: true,
    })
    expect(result.remediation).toEqual({ command: 'dbcli upgrade', risk: 'interactive' })
  })

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
    expect(result.remediation).toEqual({ command: 'dbcli init', risk: 'interactive' })
  })

  test('checkBlacklistCompleteness warns about sensitive column names', () => {
    const columns = new Map<string, string[]>([['users', ['id', 'email', 'password_hash', 'name']]])
    const blacklistedColumns = new Map<string, Set<string>>()
    const result = runDoctorChecks.checkBlacklistCompleteness(columns, blacklistedColumns)
    expect(result.status).toBe('warn')
    expect(result.message).toContain('password_hash')
  })

  test('checkBlacklistCompleteness passes when sensitive columns are protected', () => {
    const columns = new Map<string, string[]>([['users', ['id', 'email', 'password_hash']]])
    const blacklistedColumns = new Map<string, Set<string>>([['users', new Set(['password_hash'])]])
    const result = runDoctorChecks.checkBlacklistCompleteness(columns, blacklistedColumns)
    expect(result.status).toBe('pass')
  })

  test('buildDoctorRemediationPlan emits review-before-apply candidates', () => {
    const steps = buildDoctorRemediationPlan([
      {
        group: 'Configuration',
        label: 'Blacklist completeness',
        status: 'warn',
        message: 'Consider protecting: users.password_hash',
      },
      {
        group: 'Connection & Data',
        label: 'Schema cache',
        status: 'warn',
        message: 'No schema cache found — run "dbcli schema --refresh"',
      },
    ])
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'blacklist-candidate',
        dryRun: 'dbcli schema users --format json',
        apply: 'dbcli blacklist column add users.password_hash',
        requiresHumanConfirmation: true,
      }),
      expect.objectContaining({
        kind: 'schema-refresh',
        apply: 'dbcli schema --refresh',
        requiresHumanConfirmation: true,
      }),
    ])
  })

  test('shell-quotes DB-derived blacklist identifiers in remediation commands', () => {
    const steps = buildDoctorRemediationPlan([
      {
        group: 'Configuration',
        label: 'Blacklist completeness',
        status: 'warn',
        message: 'Consider protecting: users; touch /tmp/dbcli-pwned.password_hash',
      },
    ])

    expect(steps).toEqual([
      expect.objectContaining({
        dryRun: "dbcli schema 'users; touch /tmp/dbcli-pwned' --format json",
        apply: "dbcli blacklist column add 'users; touch /tmp/dbcli-pwned.password_hash'",
      }),
    ])
  })

  test('buildDoctorRemediationPlan emits bounded sample plan then query candidates', () => {
    const steps = buildDoctorRemediationPlan([
      {
        group: 'Connection & Data',
        label: 'Large tables',
        status: 'warn',
        message: 'Large tables: audit_log (5.0M rows)',
        details: {
          system: 'postgresql',
          largeTables: [{ name: 'audit_log', estimatedRowCount: 5_000_000 }],
        },
      },
    ])

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'bounded-sample',
        dryRun: "dbcli plan 'SELECT * FROM audit_log LIMIT 100' --format json",
        apply: "dbcli query 'SELECT * FROM audit_log LIMIT 100' --format json",
        requiresHumanConfirmation: true,
      }),
    ])
  })

  test('uses schema preflight for MongoDB and Elasticsearch bounded samples', () => {
    const results = (system: 'mongodb' | 'elasticsearch') => [
      {
        group: 'Connection & Data',
        label: 'Large tables',
        status: 'warn' as const,
        message: 'Large tables: events (2.0M rows)',
        details: { system, largeTables: [{ name: 'events', estimatedRowCount: 2_000_000 }] },
      },
    ]

    const mongoStep = buildDoctorRemediationPlan(results('mongodb'))[0]
    expect(mongoStep?.dryRun).toBe('dbcli schema events --format json')
    expect(mongoStep?.apply).toBe("dbcli query '{}' --collection events --limit 100 --format json")

    const elasticsearchStep = buildDoctorRemediationPlan(results('elasticsearch'))[0]
    expect(elasticsearchStep?.dryRun).toBe('dbcli schema events --format json')
    expect(elasticsearchStep?.apply).toBe(
      `dbcli query '{"query":{"match_all":{}}}' --collection events --limit 100 --format json`
    )
  })

  test('does not generate executable SQL for hostile large-table identifiers', () => {
    const steps = buildDoctorRemediationPlan([
      {
        group: 'Connection & Data',
        label: 'Large tables',
        status: 'warn',
        message: 'Large tables: audit; DROP TABLE users (5.0M rows)',
        details: {
          system: 'postgresql',
          largeTables: [{ name: 'audit; DROP TABLE users', estimatedRowCount: 5_000_000 }],
        },
      },
    ])

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'bounded-sample',
        dryRun: "dbcli schema 'audit; DROP TABLE users' --format json",
        requiresHumanConfirmation: true,
      }),
    ])
    expect(steps[0]?.apply).toBeUndefined()
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
    const tables = [{ name: 'users', estimatedRowCount: 500 }]
    const result = runDoctorChecks.checkLargeTables(tables)
    expect(result.status).toBe('pass')
  })

  test('checkMongoSrvConnectivity passes when SRV lookup succeeds directly', async () => {
    const result = await runDoctorChecks.checkMongoSrvConnectivity(
      'mongodb+srv://user:pass@cluster.example.mongodb.net/mydb',
      {
        resolveSrvFn: (async () => [
          { name: 'a.example.com', port: 27017, priority: 0, weight: 0 },
        ]) as typeof import('dns/promises').resolveSrv,
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
        fetchFn: (async () =>
          new Response(
            JSON.stringify({ Status: 0, Answer: [{ data: '0 0 27017 a.example.com.' }] })
          )) as unknown as typeof fetch,
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
        fetchFn: (async () => {
          throw new Error('Unable to connect. Is the computer able to access the url?')
        }) as unknown as typeof fetch,
      }
    )

    expect(result).not.toBeNull()
    expect(result?.status).toBe('error')
    expect(result?.message).toContain('DNS-over-HTTPS fallback also failed')
  })

  test('formatTextOutput produces expected structure', () => {
    const results: DoctorResult[] = [
      {
        group: 'Environment',
        label: 'Bun version',
        status: 'pass',
        message: 'Bun v1.3.3 (meets >= 1.3.3)',
      },
      {
        group: 'Configuration',
        label: 'Config exists',
        status: 'warn',
        message: 'Schema cache is 12 days old',
      },
      {
        group: 'Connection & Data',
        label: 'Connection',
        status: 'error',
        message: 'Connection refused',
      },
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
      message:
        'Direct SRV DNS lookup failed in this shell, but DNS-over-HTTPS fallback resolved cluster.example.mongodb.net.',
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

    expect(
      results.some((result) => result.label === 'MongoDB SRV lookup' && result.status === 'warn')
    ).toBe(true)
    expect(
      results.some((result) => result.label === 'Connection' && result.status === 'pass')
    ).toBe(true)
    expect(
      results.some((result) => result.label === 'Collections' && result.status === 'pass')
    ).toBe(true)
    spy.mockRestore()
    srvSpy.mockRestore()
  })

  test('collectMongoDoctorResults reports schema cache freshness using standard rules when schemaLastUpdated is present', async () => {
    const adapter = {
      connect: async () => {},
      disconnect: async () => {},
      getServerVersion: async () => '7.0.0',
      listTables: async () => [{ name: 'users', columns: [], estimatedRowCount: 1 }],
      getTableSchema: async () => ({ name: 'users', columns: [], tableType: 'table' as const }),
      listCollections: async () => [{ name: 'users', documentCount: 1 }],
      testConnection: async () => true,
      execute: async () => ({ rows: [], affectedRows: 0 }),
    }
    const spy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      adapter as unknown as ReturnType<typeof AdapterFactory.createMongoDBAdapter>
    )
    const srvSpy = spyOn(runDoctorChecks, 'checkMongoSrvConnectivity').mockResolvedValue(null)

    const fresh = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const results = await collectMongoDoctorResults({
      connection: {
        system: 'mongodb',
        uri: 'mongodb://localhost:27017/testdb',
        host: 'localhost',
        port: 27017,
        user: '',
        password: '',
        database: 'testdb',
      },
      metadata: { schemaLastUpdated: fresh },
    })

    const cache = results.find((r) => r.label === 'Schema cache')
    expect(cache).toBeDefined()
    expect(cache!.status).toBe('pass')
    expect(cache!.message).not.toMatch(/not tracked/i)

    spy.mockRestore()
    srvSpy.mockRestore()
  })

  test('collectMongoDoctorResults emits standard empty-cache message (not "not tracked") when metadata lacks schemaLastUpdated', async () => {
    const adapter = {
      connect: async () => {},
      disconnect: async () => {},
      getServerVersion: async () => '7.0.0',
      listTables: async () => [{ name: 'users', columns: [], estimatedRowCount: 0 }],
      getTableSchema: async () => ({ name: 'users', columns: [], tableType: 'table' as const }),
      listCollections: async () => [{ name: 'users', documentCount: 0 }],
      testConnection: async () => true,
      execute: async () => ({ rows: [], affectedRows: 0 }),
    }
    const spy = spyOn(AdapterFactory, 'createMongoDBAdapter').mockReturnValue(
      adapter as unknown as ReturnType<typeof AdapterFactory.createMongoDBAdapter>
    )
    const srvSpy = spyOn(runDoctorChecks, 'checkMongoSrvConnectivity').mockResolvedValue(null)

    const results = await collectMongoDoctorResults({
      connection: {
        system: 'mongodb',
        uri: 'mongodb://localhost:27017/testdb',
        host: 'localhost',
        port: 27017,
        user: '',
        password: '',
        database: 'testdb',
      },
      metadata: {},
    })

    const cache = results.find((r) => r.label === 'Schema cache')
    expect(cache).toBeDefined()
    expect(cache!.message).not.toMatch(/not tracked/i)
    expect(cache!.message).toMatch(/No schema cache|schema --refresh/i)

    spy.mockRestore()
    srvSpy.mockRestore()
  })
})
