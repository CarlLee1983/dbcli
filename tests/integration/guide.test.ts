import { describe, test, expect, beforeAll, setDefaultTimeout } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFile, readFile, mkdtemp, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const FIXTURE_SRC = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')

// CLI integration cases shell out through Bun; full-suite load can exceed Bun's 5s default.
setDefaultTimeout(15_000)

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
  const work = await mkdtemp(join(tmpdir(), 'dbcli-guide-'))
  await cp(FIXTURE_SRC, work, { recursive: true })
  const idxPath = resolve(work, '.dbcli/schemas/index.json')
  const raw = JSON.parse(await readFile(idxPath, 'utf8'))
  raw.metadata.lastRefreshed = new Date().toISOString()
  await writeFile(idxPath, JSON.stringify(raw, null, 2))
  FIXTURE = work
})

describe('dbcli guide (CLI)', () => {
  test('json plan for slow-query emits stable shape', async () => {
    const { stdout, code } = await run(['guide', 'slow-query', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.goal).toBe('slow-query')
    expect(j.context.system).toBe('postgresql')
    expect(typeof j.generatedAt).toBe('string')
    expect(Array.isArray(j.steps)).toBe(true)
    expect(j.steps.length).toBeGreaterThan(0)
    expect(j.steps[0].command).toBe('dbcli inspect --for-agent')
    expect(j.steps.every((s: { risk: string }) => s.risk === 'readonly')).toBe(true)
  })

  test('--for-agent collapses to brief json', async () => {
    const { stdout, code } = await run(['guide', 'slow-query', '--for-agent'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    for (const step of j.steps as Array<Record<string, unknown>>) {
      expect(step.rationale).toBeUndefined()
      expect(step.expects).toBeUndefined()
      expect(typeof step.command).toBe('string')
      expect(step.risk).toBe('readonly')
    }
  })

  test('--list prints all six goals as JSON', async () => {
    const { stdout, code } = await run(['guide', '--list', '--format', 'json'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    const ids = (j.goals as Array<{ id: string }>).map((g) => g.id)
    expect(ids).toEqual([
      'slow-query',
      'capacity',
      'health',
      'index-usage',
      'permissions',
      'schema-overview',
    ])
  })

  test('--list markdown contains all six goal headings', async () => {
    const { stdout, code } = await run(['guide', '--list', '--format', 'markdown'])
    expect(code).toBe(0)
    expect(stdout).toContain('# dbcli guide goals')
    for (const id of [
      'slow-query',
      'capacity',
      'health',
      'index-usage',
      'permissions',
      'schema-overview',
    ]) {
      expect(stdout).toContain(`\`${id}\``)
    }
  })

  test('missing goal exits non-zero with helpful error', async () => {
    const { stderr, code } = await run(['guide', '--format', 'json'])
    expect(code).not.toBe(0)
    expect(stderr).toContain('Missing goal')
  })

  test('unknown goal exits non-zero', async () => {
    const { stderr, code } = await run(['guide', 'bogus', '--format', 'json'])
    expect(code).not.toBe(0)
    expect(stderr).toContain("Unknown guide goal 'bogus'")
  })

  test('markdown mode renders required headings', async () => {
    const { stdout, code } = await run(['guide', 'capacity', '--format', 'markdown'])
    expect(code).toBe(0)
    expect(stdout).toContain('# dbcli guide: capacity')
    expect(stdout).toContain('## Context')
    expect(stdout).toContain('## Plan')
  })

  test('NEVER leaks host / port / password into stdout', async () => {
    const { stdout } = await run(['guide', 'slow-query', '--format', 'json'])
    expect(stdout).not.toContain('localhost')
    expect(stdout).not.toContain('5432')
    expect(stdout).not.toContain('"password"')
    expect(stdout).not.toContain('"host"')
  })

  test('no-config workspace exits 0 with dbcli-init bootstrap plan', async () => {
    const empty = resolve(import.meta.dir, '../fixtures/inspect/no-config')
    const { stdout, code } = await run(['guide', 'health', '--format', 'json'], empty)
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.context.system).toBeNull()
    expect(j.steps).toHaveLength(1)
    expect(j.steps[0].command).toBe('dbcli init')
  })
})
