/**
 * `dbcli capabilities` / `dbcli capabilities check` — integration tests
 * (DBCLI-PLAT-002 / DBCLI-PLAT-003).
 *
 * Every case runs the real CLI in a temporary directory with no database
 * reachable, which is what makes "discovery never connects" observable rather
 * than merely asserted: if any path opened a socket these would hang or fail.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeV2Config } from '@/core/config-v2'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const workDirs: string[] = []

afterEach(async () => {
  await Promise.all(workDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function sanitizeEnv(): NodeJS.ProcessEnv {
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

function run(
  args: string[],
  workDir: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd: workDir, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (buffer) => (stdout += buffer.toString()))
    child.stderr.on('data', (buffer) => (stderr += buffer.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

/**
 * Every path under `dir`, recursively.
 *
 * A non-recursive `readdir` would let a write into `.dbcli/` pass a test named
 * "mutates nothing on disk" — precisely the write this command must not make.
 */
async function treeOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.map((entry) => join(entry.parentPath, entry.name)).sort()
}

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-capabilities-'))
  workDirs.push(dir)
  return dir
}

/**
 * A v1 single-file config. Written with an unreachable host on purpose: every
 * assertion below must hold without anything listening on it.
 */
async function dirWithConfig(
  system: string,
  permission: string
): Promise<{ dir: string; configPath: string }> {
  const dir = await emptyDir()
  const configPath = join(dir, 'dbcli.json')
  await writeFile(
    configPath,
    JSON.stringify({
      connection: {
        system,
        host: '203.0.113.1',
        port: 5432,
        user: 'nobody',
        password: 'unused-secret-value',
        database: 'nothing',
      },
      permission,
      metadata: { createdAt: '2026-09-03T00:00:00.000Z', version: '1.0' },
    })
  )
  return { dir, configPath }
}

describe('dbcli capabilities', () => {
  test('--format json emits a parseable, versioned catalog', async () => {
    const dir = await emptyDir()
    const { stdout, code } = await run(['capabilities', '--format', 'json'], dir)

    expect(code).toBe(0)
    const catalog = JSON.parse(stdout)
    expect(catalog.schemaVersion).toBe(1)
    expect(Array.isArray(catalog.capabilities)).toBe(true)
    expect(catalog.capabilities.length).toBeGreaterThan(0)
    expect(catalog.capabilities.map((c: { id: string }) => c.id)).toContain('schema.read')
  })

  test('the JSON catalog is byte-identical across invocations', async () => {
    const dir = await emptyDir()
    const first = await run(['capabilities', '--format', 'json'], dir)
    const second = await run(['capabilities', '--format', 'json'], dir)
    expect(first.stdout).toBe(second.stdout)
  })

  test('--format markdown emits a table', async () => {
    const dir = await emptyDir()
    const { stdout, code } = await run(['capabilities', '--format', 'markdown'], dir)
    expect(code).toBe(0)
    expect(stdout).toContain('| id | risk | command | permission | connection | engines |')
    expect(stdout).toContain('`schema.read`')
  })

  test('the default output is human-readable, not JSON', async () => {
    const dir = await emptyDir()
    const { stdout, code } = await run(['capabilities'], dir)
    expect(code).toBe(0)
    expect(stdout).toContain('dbcli capability contract v1')
    expect(stdout).toContain('not permission to run it')
    expect(() => JSON.parse(stdout)).toThrow()
  })

  test('an unknown format is refused', async () => {
    const dir = await emptyDir()
    const { code, stderr } = await run(['capabilities', '--format', 'yaml'], dir)
    expect(code).toBe(2)
    expect(stderr).toContain('Error:')
  })

  test('listing touches nothing on disk', async () => {
    const dir = await emptyDir()
    await run(['capabilities', '--format', 'json'], dir)
    expect(await treeOf(dir)).toEqual([])
  })

  test('the catalog exposes no credential, host or endpoint', async () => {
    const dir = await emptyDir()
    const { stdout } = await run(['capabilities', '--format', 'json'], dir)
    expect(stdout).not.toMatch(/localhost|127\.0\.0\.1|:\/\/|"host"|"port"|password/i)
  })
})

describe('dbcli capabilities check', () => {
  test('reports available for a supported engine and sufficient permission', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'query-only')
    const { stdout, code } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read,query.read',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(0)
    const report = JSON.parse(stdout)
    expect(report.ok).toBe(true)
    expect(report.schemaVersion).toBe(1)
    expect(report.context.engine).toBe('postgresql')
    expect(report.context.permission).toBe('query-only')
    expect(report.results.every((r: { status: string }) => r.status === 'available')).toBe(true)
  })

  test('an unsupported engine is unavailable with a non-zero exit', async () => {
    const { dir, configPath } = await dirWithConfig('redis', 'admin')
    const { stdout, code } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'data.health-check',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.ok).toBe(false)
    expect(report.results[0].status).toBe('unavailable')
    expect(report.results[0].reason).toBe('engine')
  })

  test('an insufficient permission is unavailable, never available', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'query-only')
    const { stdout, code } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'data.delete',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.results[0].status).toBe('unavailable')
    expect(report.results[0].reason).toBe('permission')
  })

  test('an unknown capability fails closed', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'admin')
    const { stdout, code } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.reed',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.results[0].status).toBe('unknown')
    expect(report.results[0].reason).toBe('unknown-capability')
  })

  test('a missing config reports context unavailable rather than assuming a default', async () => {
    const dir = await emptyDir()
    const { stdout, code } = await run(
      ['capabilities', 'check', '--require', 'schema.read', '--format', 'json'],
      dir
    )

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.context).toBeNull()
    expect(report.results[0].status).toBe('unavailable')
    expect(report.results[0].reason).toBe('context-unavailable')
    // The default config is a localhost PostgreSQL at query-only. Reporting it
    // would say a database nobody configured supports this.
    expect(stdout).not.toContain('postgresql')
  })

  test('an empty --require is refused with the input exit code', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'admin')
    const { code, stderr } = await run(
      ['--config', configPath, 'capabilities', 'check', '--require', '', '--format', 'json'],
      dir
    )
    expect(code).toBe(2)
    expect(stderr).toContain('Error:')
  })

  test('a duplicate id is de-duplicated and reported as a warning', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'admin')
    const { stdout, code } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read,schema.read',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(0)
    const report = JSON.parse(stdout)
    expect(report.required).toEqual(['schema.read'])
    expect(report.results).toHaveLength(1)
    expect(report.warnings.join(' ')).toContain('Duplicate')
  })

  test('the root --use selector is honoured and named in the report', async () => {
    const dir = await emptyDir()
    const configDir = join(dir, 'store')
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'primary',
        connections: {
          primary: {
            system: 'postgresql',
            host: '203.0.113.1',
            port: 5432,
            user: 'u',
            password: 'p',
            database: 'd',
            permission: 'query-only',
          },
          cache: {
            system: 'redis',
            host: '203.0.113.2',
            port: 6379,
            user: '',
            password: '',
            database: '0',
            permission: 'query-only',
          },
        },
        schema: {},
        schemas: {},
        metadata: { version: '1.0', createdAt: '2026-09-03T00:00:00.000Z' },
        blacklist: { tables: [], columns: {} },
        audit: {
          enabled: true,
          strict: false,
          rotation: { max_bytes: 10_485_760, max_entries: 1000 },
        },
      })
    )

    const { stdout, code } = await run(
      [
        '--config',
        configDir,
        '--use',
        'cache',
        'capabilities',
        'check',
        '--require',
        'data.health-check',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.context.engine).toBe('redis')
    expect(report.context.connectionName).toBe('cache')
    expect(report.results[0].reason).toBe('engine')
  })

  test('a v2 default connection is named even with no --use', async () => {
    // The verdict must be attributable to the connection that produced it. With
    // a v2 config and no selector, a named connection *is* in effect.
    const dir = await emptyDir()
    const configDir = join(dir, 'store')
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'primary',
        connections: {
          primary: {
            system: 'postgresql',
            host: '203.0.113.1',
            port: 5432,
            user: 'u',
            password: 'p',
            database: 'd',
            permission: 'query-only',
          },
        },
        schema: {},
        schemas: {},
        metadata: { version: '1.0', createdAt: '2026-09-04T00:00:00.000Z' },
        blacklist: { tables: [], columns: {} },
        audit: {
          enabled: true,
          strict: false,
          rotation: { max_bytes: 10_485_760, max_entries: 1000 },
        },
      })
    )

    const { stdout, code } = await run(
      [
        '--config',
        configDir,
        'capabilities',
        'check',
        '--require',
        'schema.read',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(0)
    expect(JSON.parse(stdout).context.connectionName).toBe('primary')
  })

  test('a v1 single-connection config reports no connection name', async () => {
    const { dir, configPath } = await dirWithConfig('mysql', 'read-write')
    const { stdout } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read',
        '--format',
        'json',
      ],
      dir
    )
    const report = JSON.parse(stdout)
    expect(report.context.engine).toBe('mysql')
    expect(report.context.connectionName).toBeNull()
  })

  test('an unresolvable env-ref says the config exists, not that it is missing', async () => {
    // The config is present and fine; only its `{"$env":...}` password points at
    // an unset variable — a credential this command never needs. Reporting "no
    // configuration was found" here was the contract stating a falsehood.
    const dir = await emptyDir()
    const configPath = join(dir, 'envref.json')
    await writeFile(
      configPath,
      JSON.stringify({
        connection: {
          system: 'postgresql',
          host: '203.0.113.1',
          port: 5432,
          user: 'u',
          password: { $env: 'DBCLI_TEST_NEVER_SET_PASSWORD' },
          database: 'd',
        },
        permission: 'read-write',
        metadata: { createdAt: '2026-09-04T00:00:00.000Z', version: '1.0' },
      })
    )

    const { stdout, code } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read',
        '--format',
        'json',
      ],
      dir
    )

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.results[0].reason).toBe('context-unresolvable')
    expect(report.warnings.join(' ')).toContain('could not be resolved')
    expect(report.warnings.join(' ')).not.toContain('No dbcli configuration was found')
  })

  test('an unresolvable config leaks no filesystem path', async () => {
    const dir = await emptyDir()
    const configPath = join(dir, 'broken.json')
    await writeFile(configPath, '{ this is not json')

    const { stdout } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read',
        '--format',
        'json',
      ],
      dir
    )
    expect(stdout).not.toContain(dir)
    expect(stdout).not.toContain('broken.json')
    expect(JSON.parse(stdout).results[0].reason).toBe('context-unresolvable')
  })

  test('agent mode refuses a configuration-changing capability regardless of permission', async () => {
    // DBCLI_AGENT_MODE=1 blocks every config write unconditionally, so
    // reporting `available` for `connection.select` at admin would be a promise
    // the very next command breaks.
    //
    // The config is written through `writeV2Config` rather than `writeFile` so
    // it carries a real integrity record: agent mode both requires one and
    // refuses legacy single-file configs, so a hand-written v1 fixture never
    // reaches the code under test.
    const dir = await emptyDir()
    const configDir = join(dir, 'store')
    await mkdir(configDir, { recursive: true })
    await writeV2Config(configDir, {
      version: 2,
      default: 'primary',
      connections: {
        primary: {
          system: 'postgresql',
          host: '203.0.113.1',
          port: 5432,
          user: 'u',
          password: 'p',
          database: 'd',
          permission: 'admin',
        },
      },
      schema: {},
      schemas: {},
      metadata: { version: '1.0', createdAt: '2026-09-04T00:00:00.000Z' },
      blacklist: { tables: [], columns: {} },
      audit: {
        enabled: true,
        strict: false,
        rotation: { max_bytes: 10_485_760, max_entries: 1000 },
      },
    } as never)

    const child = spawn(
      'bun',
      [
        'run',
        CLI,
        '--config',
        configDir,
        'capabilities',
        'check',
        '--require',
        'connection.select,schema.read',
        '--format',
        'json',
      ],
      { cwd: dir, env: { ...sanitizeEnv(), DBCLI_AGENT_MODE: '1' } }
    )
    let stdout = ''
    child.stdout.on('data', (buffer) => (stdout += buffer.toString()))
    const code: number = await new Promise((res) => child.on('close', (c) => res(c ?? 0)))

    expect(code).toBe(1)
    const report = JSON.parse(stdout)
    expect(report.context.agentMode).toBe(true)
    const byId = Object.fromEntries(
      report.results.map((r: { id: string; status: string; reason: string | null }) => [
        r.id,
        [r.status, r.reason],
      ])
    )
    expect(byId['connection.select']).toEqual(['unavailable', 'agent-mode'])
    expect(byId['schema.read']).toEqual(['available', null])
    expect(report.warnings.join(' ')).toContain('DBCLI_AGENT_MODE=1')
  })

  test('agent mode is reported as false when the flag is unset', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'admin')
    const { stdout } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'connection.select',
        '--format',
        'json',
      ],
      dir
    )
    const report = JSON.parse(stdout)
    expect(report.context.agentMode).toBe(false)
    expect(report.results[0].status).toBe('available')
  })

  test('checking mutates nothing on disk', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'query-only')
    const before = await readdir(dir)
    await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read',
        '--format',
        'json',
      ],
      dir
    )
    expect(await readdir(dir)).toEqual(before)
  })

  test('the report never echoes the configured credential or endpoint', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'admin')
    const { stdout } = await run(
      [
        '--config',
        configPath,
        'capabilities',
        'check',
        '--require',
        'schema.read',
        '--format',
        'json',
      ],
      dir
    )
    expect(stdout).not.toContain('unused-secret-value')
    expect(stdout).not.toContain('203.0.113.1')
    expect(stdout).not.toContain('nobody')
  })

  test('the default output is human-readable and still exits non-zero on failure', async () => {
    const { dir, configPath } = await dirWithConfig('postgresql', 'query-only')
    const { stdout, code } = await run(
      ['--config', configPath, 'capabilities', 'check', '--require', 'data.delete'],
      dir
    )
    expect(code).toBe(1)
    expect(stdout).toContain('unavailable')
    expect(stdout).toContain('Some requirements are not met.')
  })
})
