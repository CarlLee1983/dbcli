/**
 * Process-level harness for the query / saved-query agent-output tests: a
 * throwaway workspace holding a v1 `.dbcli` config, saved queries under
 * `.dbcli-shared/queries`, and a spawn helper that runs the real CLI.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  MYSQL_DATABASE,
  MYSQL_HOST,
  MYSQL_PASSWORD,
  MYSQL_PORT,
  MYSQL_USER,
  PG_DATABASE,
  PG_HOST,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
} from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

export interface CliResult {
  stdout: string
  stderr: string
  code: number
}

export type TestEngine = 'postgresql' | 'mysql'

export function connectionFor(engine: TestEngine): Record<string, unknown> {
  return engine === 'postgresql'
    ? {
        system: 'postgresql',
        host: PG_HOST,
        port: PG_PORT,
        user: PG_USER,
        password: PG_PASSWORD,
        database: PG_DATABASE,
      }
    : {
        system: 'mysql',
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
      }
}

export interface WorkspaceSpec {
  connection: Record<string, unknown>
  permission: 'query-only' | 'read-write' | 'data-admin' | 'admin'
  blacklist?: { tables?: string[]; columns?: Record<string, string[]> }
  queries?: Record<string, string>
}

/** A workspace directory; `dispose()` removes it. */
export function createWorkspace(spec: WorkspaceSpec): { dir: string; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dbcli-agent-output-'))
  mkdirSync(join(dir, '.dbcli-shared/queries'), { recursive: true })
  for (const [name, body] of Object.entries(spec.queries ?? {})) {
    writeFileSync(join(dir, '.dbcli-shared/queries', `${name}.sql`), body)
  }
  mkdirSync(join(dir, '.dbcli'), { recursive: true })
  writeFileSync(
    join(dir, '.dbcli', 'config.json'),
    JSON.stringify({
      version: 2,
      default: 'main',
      connections: { main: { ...spec.connection, permission: spec.permission } },
      schema: {},
      schemas: {},
      metadata: { version: '1.0', createdAt: '2026-11-20T00:00:00.000Z' },
      blacklist: { tables: spec.blacklist?.tables ?? [], columns: spec.blacklist?.columns ?? {} },
      audit: {
        enabled: true,
        strict: false,
        rotation: { max_bytes: 10_485_760, max_entries: 1000 },
      },
    })
  )
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(key)) continue
    if (key === 'DATABASE_URL') continue
    out[key] = value
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

export function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizedEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (buffer) => (stdout += buffer.toString()))
    child.stderr.on('data', (buffer) => (stderr += buffer.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

/** Run a statement on the test server directly (fixture setup / teardown only). */
export async function execDirect(engine: TestEngine, sql: string): Promise<void> {
  const { AdapterFactory } = await import('@/adapters')
  const adapter = AdapterFactory.createAdapterWithoutRules(
    connectionFor(engine) as unknown as Parameters<
      typeof AdapterFactory.createAdapterWithoutRules
    >[0]
  )
  await adapter.connect()
  try {
    await adapter.execute(sql)
  } finally {
    await adapter.disconnect()
  }
}
