import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { Command } from 'commander'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { semanticCommand } from '@/commands/semantic'

const CONFIG = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'user',
    database: 'app',
  },
  permission: 'query-only',
  blacklist: { tables: [], columns: { orders: ['secret'] } },
  schema: {
    orders: {
      name: 'orders',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'created_at', type: 'timestamp', nullable: false },
        { name: 'secret', type: 'text', nullable: true },
      ],
    },
  },
}

function makeRoot(): Command {
  const program = new Command()
    .name('dbcli')
    .exitOverride()
    .enablePositionalOptions()
    .option('--config <path>', 'config path', '.dbcli')
  program.addCommand(semanticCommand)
  return program
}

describe('semantic commands', () => {
  let output = ''
  let errors = ''
  let exitCode: number | undefined
  let sandbox = ''
  let configPath = ''
  const cwd = process.cwd()
  const logSpy = spyOn(console, 'log').mockImplementation((value: unknown) => {
    output += `${String(value)}\n`
  })
  const errorSpy = spyOn(console, 'error').mockImplementation((value: unknown) => {
    errors += `${String(value)}\n`
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  beforeEach(() => {
    output = ''
    errors = ''
    exitCode = undefined
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-semantic-command-'))
    configPath = join(sandbox, 'config.json')
    writeFileSync(configPath, JSON.stringify(CONFIG))
    mkdirSync(join(sandbox, '.dbcli', 'queries'), { recursive: true })
    writeFileSync(
      join(sandbox, '.dbcli', 'queries', 'revenue.sql'),
      '-- ---\n-- description: Revenue report\n-- ---\nSELECT 1'
    )
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 2,
        models: [
          {
            name: 'orders',
            table: 'orders',
            aliases: ['purchases'],
            fields: [{ column: 'created_at', aliases: ['order date'] }],
          },
        ],
        relationships: [],
        metrics: [{ name: 'daily-revenue', query: '@revenue' }],
      })
    )
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(cwd)
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  async function run(...args: string[]): Promise<void> {
    await makeRoot().parseAsync(['bun', 'dbcli', '--config', configPath, 'semantic', ...args], {
      from: 'node',
    })
  }

  test('validate accepts metrics that reference a parsed saved query', async () => {
    await run('validate', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toMatchObject({ valid: true, models: 1, metrics: 1 })
  })

  test('context prints the validated business context', async () => {
    await run('context', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toMatchObject({
      models: [expect.objectContaining({ name: 'orders', table: 'orders' })],
      metrics: [expect.objectContaining({ query: '@revenue' })],
    })
  })

  test('drift reports stale references with a non-zero exit code and stable JSON', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 2,
        models: [{ name: 'orders', table: 'orders', fields: [{ column: 'missing', aliases: [] }] }],
        relationships: [],
        metrics: [],
      })
    )

    await run('drift', '--format', 'json')

    expect(exitCode).toBe(1)
    expect(JSON.parse(output)).toMatchObject({ status: 'stale', issues: expect.any(Array) })
  })

  test('drift reports an unavailable schema cache distinctly from stale references', async () => {
    writeFileSync(configPath, JSON.stringify({ ...CONFIG, schema: {} }))

    await run('drift', '--format', 'json')

    expect(exitCode).toBe(1)
    expect(JSON.parse(output)).toMatchObject({ status: 'unavailable', issues: expect.any(Array) })
  })

  test('drift renders a deterministic text status', async () => {
    await run('drift')

    expect(exitCode).toBeUndefined()
    expect(output).toBe('Semantic context is valid.\n')
  })

  test('migrate writes the v2 JSON only to stdout', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [
          { name: 'orders', table: 'orders', fields: [{ column: 'created_at', aliases: [] }] },
        ],
        metrics: [],
      })
    )

    await run('migrate', '--to', '2', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toMatchObject({ version: 2, relationships: [] })
    expect(await Bun.file(join(sandbox, 'dbcli.semantic.json')).json()).toMatchObject({
      version: 1,
    })
  })

  test('search emits governed catalog results and validates options', async () => {
    await run('search', 'purchases', '--kind', 'model', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({ kind: 'model', reference: 'orders', matchedTerms: ['purchases'] }),
    ])

    output = ''
    await run('search', 'purchases', '--limit', '101')
    expect(exitCode).toBe(1)
    expect(errors).toContain('limit')
  })

  test('search returns an empty JSON array and success for no matches', async () => {
    await run('search', 'nothing', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toEqual([])
  })

  test('search discovers metric keys without reading saved-query SQL bodies', async () => {
    writeFileSync(join(sandbox, '.dbcli', 'queries', 'revenue.sql'), 'not valid SQL')

    await run('search', 'daily-revenue', '--kind', 'metric', '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({ kind: 'metric', reference: 'daily-revenue' }),
    ])
  })

  test('context fails closed when a model names a blacklisted column', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [{ name: 'orders', table: 'orders', fields: [{ column: 'secret', aliases: [] }] }],
        metrics: [],
      })
    )

    await run('context')

    expect(exitCode).toBe(1)
    expect(errors).toContain('must reference a visible column')
  })

  test('validate rejects a metric whose saved query fails normal parsing', async () => {
    writeFileSync(join(sandbox, '.dbcli', 'queries', 'revenue.sql'), 'not valid SQL')

    await run('validate')

    expect(exitCode).toBe(1)
    expect(errors).toContain('must reference an available saved query')
  })

  test('draft validate reads an explicit file and returns only a safe validation report', async () => {
    const sql = 'SELECT created_at FROM orders'
    const draftPath = join(sandbox, 'draft.json')
    writeFileSync(
      draftPath,
      JSON.stringify({
        version: 1,
        questionHash: 'a'.repeat(64),
        candidate: { kind: 'sql', sql },
        semanticReferences: ['model:orders', 'field:orders.created_at'],
      })
    )

    await run('draft', 'validate', '--input', draftPath, '--format', 'json')

    expect(exitCode).toBeUndefined()
    expect(JSON.parse(output)).toMatchObject({
      status: 'valid',
      canonicalReferences: ['field:orders.created_at', 'model:orders'],
      violations: [],
    })
    expect(output).not.toContain(sql)
  })

  test('draft validate rejects untrusted SQL without invoking an execution command', async () => {
    const sql = 'SELECT secret FROM orders'
    const draftPath = join(sandbox, 'invalid-draft.json')
    writeFileSync(
      draftPath,
      JSON.stringify({
        version: 1,
        questionHash: 'b'.repeat(64),
        candidate: { kind: 'sql', sql },
        semanticReferences: ['model:orders', 'field:orders.created_at'],
      })
    )

    await run('draft', 'validate', '--input', draftPath, '--format', 'json')

    expect(exitCode).toBe(1)
    expect(JSON.parse(output)).toMatchObject({
      status: 'invalid',
      violations: expect.arrayContaining([{ code: 'BLACKLISTED_SQL_REFERENCE' }]),
    })
    expect(output).not.toContain(sql)
    expect(errors).toBe('')
  })

  test('draft validate reports unavailable local semantic evidence with a distinct exit code', async () => {
    const draftPath = join(sandbox, 'draft.json')
    writeFileSync(draftPath, JSON.stringify({ version: 1 }))
    writeFileSync(configPath, JSON.stringify({ ...CONFIG, schema: {} }))

    await run('draft', 'validate', '--input', draftPath, '--format', 'json')

    expect(exitCode).toBe(2)
    expect(JSON.parse(output)).toEqual({
      status: 'unavailable',
      draftHash: expect.any(String),
      questionHash: null,
      canonicalReferences: [],
      violations: [{ code: 'SEMANTIC_CONTEXT_UNAVAILABLE' }],
    })
    expect(errors).toBe('')
  })

  void logSpy
  void errorSpy
  void exitSpy
})

afterAll(() => mock.restore())
