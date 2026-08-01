import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterFactory } from '@/adapters'
import type { DatabaseAdapter, ExecutionResult, SqlConnectionOptions } from '@/adapters/types'
import { buildProgram } from '@/program'

class IntegrationAdapter implements DatabaseAdapter {
  disconnected = false

  constructor(private readonly connection: string) {}

  async connect() {}
  async disconnect() { this.disconnected = true }
  async execute<T>(): Promise<ExecutionResult<T>> {
    return { rows: [{ connection: this.connection }] as T[], affectedRows: 1 }
  }
  async listTables() { return [] }
  async getTableSchema() { return { name: 'result', columns: [] } }
  async testConnection() { return true }
  async getServerVersion() { return 'test' }
}

describe('multi-connection query integration', () => {
  let workDir: string
  let configPath: string
  let createAdapterSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>
  let originalExitCode: number | string | null | undefined

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-query-multi-integration-'))
    configPath = join(workDir, '.dbcli')
    await mkdir(configPath, { recursive: true })
    const connection = (name: string) => ({
      system: 'postgresql',
      host: name,
      port: 5432,
      user: 'test',
      password: 'test',
      database: name,
    })
    await Bun.write(
      join(configPath, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'primary',
        connections: {
          primary: connection('primary'),
          staging: connection('staging'),
        },
        schema: {},
        metadata: { version: '2.0' },
        blacklist: { tables: [], columns: {} },
        audit: { enabled: false, rotation: { max_bytes: 1024, max_entries: 10 } },
      })
    )
    originalExitCode = process.exitCode
    process.exitCode = undefined
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    createAdapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
  })

  afterEach(async () => {
    process.exitCode = originalExitCode
    createAdapterSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    await rm(workDir, { recursive: true, force: true })
  })

  test('command-local --use fans out through real config resolution without mutating the default', async () => {
    const adapters = {
      primary: new IntegrationAdapter('primary'),
      staging: new IntegrationAdapter('staging'),
    }
    createAdapterSpy.mockImplementation((options: SqlConnectionOptions) =>
      adapters[options.host as keyof typeof adapters]
    )
    const before = await Bun.file(join(configPath, 'config.json')).text()

    await buildProgram().parseAsync([
      'bun',
      'dbcli',
      '--config',
      configPath,
      'query',
      '--use',
      'primary,staging',
      'SELECT 1',
      '--format',
      'json',
    ])

    const output = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
      results: Array<{ connection: string; status: string; rows: unknown[] }>
    }
    expect(output.results.map(({ connection, status }) => ({ connection, status }))).toEqual([
      { connection: 'primary', status: 'ok' },
      { connection: 'staging', status: 'ok' },
    ])
    expect(output.results.map((result) => result.rows[0])).toEqual([
      { connection: 'primary' },
      { connection: 'staging' },
    ])
    expect(process.exitCode).toBe(0)
    expect(adapters.primary.disconnected).toBe(true)
    expect(adapters.staging.disconnected).toBe(true)
    expect(await Bun.file(join(configPath, 'config.json')).text()).toBe(before)
  })
})
