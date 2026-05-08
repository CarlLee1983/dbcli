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
  const work = await mkdtemp(join(tmpdir(), 'dbcli-report-'))
  await cp(FIXTURE_SRC, work, { recursive: true })
  const idxPath = resolve(work, '.dbcli/schemas/index.json')
  const raw = JSON.parse(await readFile(idxPath, 'utf8'))
  raw.metadata.lastRefreshed = new Date().toISOString()
  await writeFile(idxPath, JSON.stringify(raw, null, 2))
  FIXTURE = work
})

describe('dbcli report (CLI)', () => {
  test('json with --no-connect emits stable shape', async () => {
    const { stdout, code } = await run(['report', '--format', 'json', '--no-connect'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.schemaVersion).toBe(1)
    expect(j.context.system).toBe('postgresql')
    expect(j.sections).toEqual([])
    expect(typeof j.generatedAt).toBe('string')
    expect(Array.isArray(j.warnings)).toBe(true)
    expect(j.warnings.some((w: { message: string }) => /no-connect/.test(w.message))).toBe(true)
    expect(Array.isArray(j.suggestedCommands)).toBe(true)
  })

  test('--for-agent collapses to brief json', async () => {
    const { stdout, code } = await run(['report', '--for-agent', '--no-connect'])
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.sections).toEqual([])
    expect(j.suggestedCommands.length).toBeLessThanOrEqual(3)
  })

  test('--section validation rejects unknown values', async () => {
    const { stderr, code } = await run([
      'report',
      '--section',
      'health,bogus',
      '--format',
      'json',
      '--no-connect',
    ])
    expect(code).not.toBe(0)
    expect(stderr).toContain("Unknown report section 'bogus'")
  })

  test('markdown mode renders required headings', async () => {
    const { stdout, code } = await run(['report', '--format', 'markdown', '--no-connect'])
    expect(code).toBe(0)
    expect(stdout).toContain('# dbcli report')
    expect(stdout).toContain('## Context')
    expect(stdout).toContain('## Suggested commands')
  })

  test('NEVER leaks host / port / password into stdout', async () => {
    const { stdout } = await run(['report', '--format', 'json', '--no-connect'])
    expect(stdout).not.toContain('localhost')
    expect(stdout).not.toContain('5432')
    expect(stdout).not.toContain('"password"')
    expect(stdout).not.toContain('"host"')
  })

  test('no-config workspace exits 0 with degraded snapshot', async () => {
    const empty = resolve(import.meta.dir, '../fixtures/inspect/no-config')
    const { stdout, code } = await run(
      ['report', '--format', 'json', '--no-connect'],
      empty
    )
    expect(code).toBe(0)
    const j = JSON.parse(stdout)
    expect(j.context.system).toBeNull()
    expect(j.sections).toEqual([])
    expect(j.suggestedCommands).toContain('dbcli init')
  })
})
