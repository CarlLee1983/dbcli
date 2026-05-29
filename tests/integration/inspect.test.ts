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

  test('NEVER leaks host / port / password into stdout', async () => {
    const { stdout } = await run(['inspect', '--format', 'json', '--no-connect'])
    expect(stdout).not.toContain('localhost')
    expect(stdout).not.toContain('5432')
    expect(stdout).not.toContain('"password"')
    expect(stdout).not.toContain('"host"')
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
