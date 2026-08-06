import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let workspace: string

async function run(stdin: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = Bun.spawn({
    cmd: ['bun', 'run', CLI, '--config', join(workspace, 'config.json'), 'semantic', 'draft', 'validate', '--input', '-', '--format', 'json'],
    cwd: workspace,
    env: { ...process.env, NODE_ENV: 'test', DBCLI_NO_UPDATE_CHECK: '1', HOME: workspace },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  child.stdin.write(stdin)
  child.stdin.end()
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-semantic-draft-'))
  await mkdir(join(workspace, '.dbcli', 'queries'), { recursive: true })
  await Bun.write(
    join(workspace, 'config.json'),
    JSON.stringify({
      connection: {
        system: 'postgresql',
        host: 'unreachable.invalid',
        port: 5432,
        user: 'test',
        database: 'test',
      },
      permission: 'query-only',
      blacklist: { tables: [], columns: { orders: ['secret'] } },
      schema: {
        orders: {
          name: 'orders',
          columns: [{ name: 'created_at', type: 'timestamp', nullable: false }],
        },
      },
    })
  )
  await Bun.write(
    join(workspace, 'dbcli.semantic.json'),
    JSON.stringify({
      version: 1,
      models: [{ name: 'orders', table: 'orders', fields: [{ column: 'created_at', aliases: [] }] }],
      metrics: [],
    })
  )
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('semantic draft validate stdin workflow', () => {
  test('reads stdin offline without connecting or emitting candidate SQL', async () => {
    const sql = 'SELECT created_at FROM orders'
    const result = await run(
      JSON.stringify({
        version: 1,
        questionHash: 'a'.repeat(64),
        candidate: { kind: 'sql', sql },
        semanticReferences: ['model:orders', 'field:orders.created_at'],
      })
    )

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'valid', violations: [] })
    expect(result.stdout).not.toContain(sql)
    expect(result.stderr).not.toContain('unreachable.invalid')
  }, 5_000)

  test('rejects oversized stdin without reading it as a query draft', async () => {
    const result = await run(
      JSON.stringify({
        version: 1,
        questionHash: 'b'.repeat(64),
        candidate: { kind: 'sql', sql: 'SELECT created_at FROM orders' },
        semanticReferences: ['model:orders', 'field:orders.created_at'],
        rationale: 'x'.repeat(300 * 1024),
      })
    )

    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'invalid',
      violations: [{ code: 'INVALID_DRAFT' }],
    })
    expect(result.stderr).toBe('')
  }, 5_000)

  test('fails closed as invalid for deeply nested untrusted JSON', async () => {
    const depth = 10_000
    const result = await run(
      `{"version":1,"questionHash":"${'c'.repeat(64)}","candidate":{"kind":"sql","sql":"SELECT created_at FROM orders"},"semanticReferences":["model:orders","field:orders.created_at"],"unexpected":${'{"nested":'.repeat(depth)}null${'}'.repeat(depth)}}`
    )

    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'invalid',
      questionHash: 'c'.repeat(64),
      violations: expect.arrayContaining([{ code: 'INVALID_DRAFT' }]),
    })
    expect(result.stderr).toBe('')
  }, 5_000)
})
