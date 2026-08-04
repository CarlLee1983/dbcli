import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
let work = ''

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((done) => {
    const child = spawn('bun', ['run', CLI, '--config', work, ...args], {
      cwd: work,
      env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += String(chunk)))
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))
    child.on('close', (code) => done({ stdout, stderr, code: code ?? 1 }))
  })
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'dbcli-backfill-artifact-'))
  await writeFile(join(work, 'config.json'), JSON.stringify({
    version: 2,
    default: 'demo',
    connections: {
      demo: { system: 'postgresql', host: 'demo.db', port: 5432, user: 'x', password: 'secret', database: 'catalog', permission: 'query-only', environment: 'demo' },
      prod: { system: 'postgresql', host: 'prod.db', port: 5432, user: 'x', password: 'secret', database: 'app', permission: 'read-write', environment: 'prod' },
    },
  }), 'utf8')
  await writeFile(join(work, 'catalog.json'), JSON.stringify({
    table: 'accounts', keyColumns: ['id'], rows: [{ id: 1, tier: 'pro' }],
    verifyQuery: 'SELECT count(*) AS n FROM accounts WHERE tier IS NULL', expect: 'value == 0',
  }), 'utf8')
})

afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }) })

describe('backfill artifact command', () => {
  test('writes a source-to-SQL artifact without connecting or exposing credentials', async () => {
    const out = join(work, 'review.json')
    const result = await run(['backfill', 'artifact', '--source', 'catalog.json', '--source-use', 'demo', '--target-use', 'prod', '--out', out])
    expect(result.code).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.path).toBe(out)
    const artifact = JSON.parse(await readFile(out, 'utf8'))
    expect(artifact.targetIdentity).toMatchObject({ name: 'prod', environment: 'prod', database: 'app' })
    expect(artifact.statements[0].sql).toBe("UPDATE accounts SET tier = 'pro' WHERE id = 1")
    expect(JSON.stringify(artifact)).not.toContain('secret')
    expect(artifact.execution.mode).toBe('dry-run')
  })
})
