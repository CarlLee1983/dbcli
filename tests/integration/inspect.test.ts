import { describe, test, expect, beforeAll } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFile, readFile, mkdtemp, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let FIXTURE = FIXTURE_SRC

function run(
  args: string[],
  cwd = FIXTURE
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

/** What the fixture's config holds, and therefore what must never be published. */
const FIXTURE_SECRETS = { host: 'localhost', port: 5432 }

/**
 * Credential leaks in a parsed inspect snapshot, described by where they sit.
 *
 * Walks the parsed document rather than scanning the serialized text. That is
 * the whole point: a port is four digits, `audit_recent` carries UUIDs, and hex
 * collides — so `stdout.includes('5432')` answers a question nobody asked. A
 * leaf value that *is* the port, or a string that contains the host, is a leak;
 * `435432` inside an id is not.
 *
 * Credential field names are reported wherever they appear, because a key called
 * `password` in this output is a defect even when its value looks harmless — the
 * fixture's password is the single character `p`, which no value check can find.
 */
const CREDENTIAL_KEYS = new Set(['host', 'port', 'password', 'user', 'uri', 'connectionstring'])

function credentialLeaks(node: unknown, secrets: { host: string; port: number }): string[] {
  const leaks: string[] = []

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, path ? `${path}.${index}` : String(index)))
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key
        if (CREDENTIAL_KEYS.has(key.toLowerCase())) {
          leaks.push(`${childPath} is a credential field`)
        }
        walk(child, childPath)
      }
      return
    }
    if (value === secrets.port || value === String(secrets.port)) {
      leaks.push(`${path} is the port`)
      return
    }
    if (typeof value === 'string' && value.includes(secrets.host)) {
      leaks.push(`${path} contains the host`)
    }
  }

  walk(node, '')
  return leaks
}

beforeAll(async () => {
  // Copy fixture to a tmp dir so the cache-freshness mutation does not dirty
  // the committed fixture between test runs.
  const work = await mkdtemp(join(tmpdir(), 'dbcli-inspect-'))
  await cp(FIXTURE_SRC, work, { recursive: true })
  const idxPath = resolve(work, '.dbcli/schemas/index.json')
  const raw = JSON.parse(await readFile(idxPath, 'utf8'))
  raw.metadata.lastRefreshed = new Date().toISOString()
  await writeFile(idxPath, JSON.stringify(raw, null, 2))
  FIXTURE = work
})

describe('dbcli inspect (CLI)', () => {
  test('json with --no-connect emits stable shape', async () => {
    const { stdout, code } = await run(['inspect', '--format', 'json', '--no-connect'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.system).toBe('postgresql')
    expect(j.connection.database).toBe('fixture_app')
    expect(j.permission.level).toBe('query-only')
    expect(j.blacklist.tables).toBe(1)
    expect(j.blacklist.columnRules).toBe(2)
    expect(j.schemaCache.available).toBe(true)
    expect(j.schemaCache.stale).toBe(false)
    expect(j.snippets.count).toBeGreaterThan(0)
    expect(Array.isArray(j.suggestedCommands)).toBe(true)
    expect(j.suggestedCommands.length).toBeGreaterThan(0)
    expect(Array.isArray(j.hints)).toBe(true)
  })

  test('--for-agent collapses to brief json', async () => {
    const { stdout, code } = await run(['inspect', '--for-agent', '--no-connect'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.objects.sample).toBeUndefined()
    expect(j.snippets.intents).toEqual([])
    expect(j.suggestedCommands).toHaveLength(1)
  })

  test('markdown mode renders required sections', async () => {
    const { stdout, code } = await run(['inspect', '--format', 'markdown', '--no-connect'])
    expect(code).toBe(0)
    expect(stdout).toContain('# dbcli inspect')
    expect(stdout).toContain('## Connection')
    expect(stdout).toContain('## Suggested commands')
  })

  test('the leak criterion ignores a port that is only a substring of a random id', () => {
    // The reason this criterion is structural. `not.toContain('5432')` over the
    // whole document went red on CI once because an audit entry's UUID ended
    // `...435432`; the same commit passed on a re-run. Three ids of 32 hex
    // characters put that at roughly one run in 700 — rare enough to look like a
    // regression, common enough to keep costing a CI run and an investigation.
    const snapshot = {
      connection: { name: 'default', database: 'app', version: '16.4' },
      audit_recent: [
        { id: 'd234ec76-8833-4413-9d02-7c35f8435432', target: 'users' },
        { id: '3cfdce8a-378d-4d9e-a0a7-5ad8673d12a2', target: '*' },
      ],
    }
    expect(credentialLeaks(snapshot, FIXTURE_SECRETS)).toEqual([])
  })

  test('the leak criterion still catches a real leak, wherever it sits', () => {
    expect(
      credentialLeaks(
        { connection: { name: 'default', database: 'app', host: 'localhost' } },
        FIXTURE_SECRETS
      )
    ).toEqual(['connection.host is a credential field', 'connection.host contains the host'])

    expect(
      credentialLeaks({ hints: ['try dbcli query --host localhost'] }, FIXTURE_SECRETS)
    ).toEqual(['hints.0 contains the host'])

    expect(credentialLeaks({ objects: { count: 5432 } }, FIXTURE_SECRETS)).toEqual([
      'objects.count is the port',
    ])
  })

  test('NEVER leaks host / port / password into stdout', async () => {
    const { stdout } = await run(['inspect', '--format', 'json', '--no-connect'])
    const snapshot = JSON.parse(stdout)

    // The connection section is the only place a credential could legitimately
    // be near, so it is pinned by its whole key set: anything added to it fails
    // here until someone decides it is safe to publish.
    expect(Object.keys(snapshot.connection).sort()).toEqual(['database', 'name', 'version'])
    expect(credentialLeaks(snapshot, FIXTURE_SECRETS)).toEqual([])
  })

  test('no-config workspace exits 0 with degraded snapshot', async () => {
    const empty = resolve(import.meta.dir, '../fixtures/inspect/no-config')
    const { stdout, code } = await run(['inspect', '--format', 'json', '--no-connect'], empty)
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.system).toBeNull()
    expect(j.suggestedCommands).toContain('dbcli init')
  })

  test('inspect collector completes well under the 200ms audit-read gate (no-connect)', async () => {
    const { collectInspect } = await import('@/core/inspect')
    const start = performance.now()
    await collectInspect({
      workspace: FIXTURE,
      configPath: join(FIXTURE, '.dbcli'),
      noConnect: true,
    })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})
