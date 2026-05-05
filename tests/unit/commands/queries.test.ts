import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  queriesCommand,
  queriesList,
  queriesShow,
  queriesCheck,
  queriesNew,
  queriesEdit,
} from '@/commands/queries'

let workdir = ''
let logSpy: any
let exitSpy: any
let originalCwd = ''

beforeEach(() => {
  originalCwd = process.cwd()
  workdir = mkdtempSync(join(tmpdir(), 'queries-test-'))
  mkdirSync(join(workdir, '.dbcli-shared/queries'), { recursive: true })
  writeFileSync(
    join(workdir, '.dbcli-shared/queries/dau.sql'),
    `-- ---\n-- name: DAU\n-- description: Daily Active Users\n-- engine: postgres\n-- params:\n--   days:\n--     type: int\n--     default: 7\n-- tags: [analytics]\n-- ---\nSELECT 1`
  )
  process.chdir(workdir)
  logSpy = spyOn(console, 'log').mockImplementation(() => {})
  exitSpy = spyOn(process, 'exit').mockImplementation(((_: number) => undefined) as any)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
  logSpy?.mockRestore?.()
  exitSpy?.mockRestore?.()
})

describe('queries list', () => {
  test('table format prints @dau row', async () => {
    await queriesList({})
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(out).toMatch(/@dau/)
    expect(out).toMatch(/postgres/)
  })

  test('--format json emits MCP-shaped array', async () => {
    await queriesList({ format: 'json' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]).toMatchObject({
      name: '@dau',
      sources: ['shared'],
      engines: ['postgres'],
    })
  })

  test('--engine mysql filters out postgres-only snippets', async () => {
    await queriesList({ engine: 'mysql', format: 'json' })
    const parsed = JSON.parse(logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n'))
    expect(parsed).toEqual([])
  })

  test('--tag billing filters to empty', async () => {
    await queriesList({ tag: 'billing', format: 'json' })
    const parsed = JSON.parse(logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n'))
    expect(parsed).toEqual([])
  })

  test('folds engine variants into one row with sources/engines arrays', async () => {
    writeFileSync(
      join(workdir, '.dbcli-shared/queries/usage.postgres.sql'),
      `-- ---\n-- name: usage\n-- engine: postgres\n-- ---\nSELECT 1`
    )
    writeFileSync(
      join(workdir, '.dbcli-shared/queries/usage.mysql.sql'),
      `-- ---\n-- name: usage\n-- engine: mysql\n-- ---\nSELECT 1`
    )
    await queriesList({ format: 'json' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    const parsed = JSON.parse(out)
    const usage = parsed.find((r: { name: string }) => r.name === '@usage')
    expect(usage).toBeDefined()
    expect(usage.engines).toEqual(['mysql', 'postgres'])
    expect(usage.sources).toEqual(['shared'])
  })
})

describe('queries show', () => {
  test('emits frontmatter + sql in default format', async () => {
    await queriesShow('@dau', {})
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(out).toMatch(/SELECT 1/)
    expect(out).toMatch(/Daily Active Users/)
  })

  test('--format json includes sql key (MCP shape)', async () => {
    await queriesShow('@dau', { format: 'json' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    const parsed = JSON.parse(out)
    expect(parsed.sql).toBe('SELECT 1')
    expect(parsed.params[0]).toMatchObject({ name: 'days', type: 'int', default: 7 })
  })
})

describe('queries check', () => {
  test('passes for valid snippet', async () => {
    await queriesCheck({})
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('--strict promotes missing engine to error', async () => {
    writeFileSync(join(workdir, '.dbcli-shared/queries/no_engine.sql'), 'SELECT 1')
    await queriesCheck({ strict: true })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('exit 1 on parse error', async () => {
    writeFileSync(join(workdir, '.dbcli-shared/queries/bad.sql'), 'INSERT INTO t VALUES(1)')
    await queriesCheck({})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('queries new', () => {
  test('creates shared file by default', async () => {
    await queriesNew('@new/sample', {})
    const path = join(workdir, '.dbcli-shared/queries/new/sample.sql')
    expect(await Bun.file(path).exists()).toBe(true)
  })

  test('--local writes under .dbcli/queries', async () => {
    await queriesNew('@scratch', { local: true })
    expect(await Bun.file(join(workdir, '.dbcli/queries/scratch.sql')).exists()).toBe(true)
  })

  test('refuses to overwrite existing file', async () => {
    await queriesNew('@dau', {})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('queries edit', () => {
  test('exits 1 when neither local nor shared exists', async () => {
    await queriesEdit('@nope', {})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--shared with missing file exits 1', async () => {
    await queriesEdit('@nope', { shared: true })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('queries — extra branches', () => {
  test('list (default format, empty) prints no_snippets hint', async () => {
    await queriesList({ source: 'local' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(out.length).toBeGreaterThan(0)
  })

  test('show on missing snippet exits 1', async () => {
    await queriesShow('@missing', {})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('new without @ prefix exits 1', async () => {
    await queriesNew('foo', {})
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('scaffold from `new` round-trips through list/show without parser errors', async () => {
    await queriesNew('@scaffold-roundtrip', {})
    logSpy.mockClear()
    await queriesList({ format: 'json' })
    const listOut = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    const parsed = JSON.parse(listOut)
    expect(parsed.find((s: any) => s.name === '@scaffold-roundtrip')).toBeTruthy()
    logSpy.mockClear()
    await queriesShow('@scaffold-roundtrip', { format: 'json' })
    const showOut = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(JSON.parse(showOut).sql).toMatch(/SELECT/i)
  })
})

describe('queries commander wiring', () => {
  test('list action callback runs via parseAsync', async () => {
    await queriesCommand.parseAsync(['list', '--format', 'json'], { from: 'user' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(out).toContain('@dau')
  })

  test('show action callback runs via parseAsync', async () => {
    await queriesCommand.parseAsync(['show', '@dau', '--format', 'json'], { from: 'user' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(out).toContain('SELECT 1')
  })

  test('check action callback runs via parseAsync', async () => {
    await queriesCommand.parseAsync(['check'], { from: 'user' })
    const out = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n')
    expect(out).toMatch(/snippets parsed successfully/)
  })

  test('new action callback runs via parseAsync', async () => {
    await queriesCommand.parseAsync(['new', '@brand-new', '--local'], { from: 'user' })
    expect(await Bun.file(join(workdir, '.dbcli/queries/brand-new.sql')).exists()).toBe(true)
  })

  test('edit action callback runs via parseAsync (missing → exit 1)', async () => {
    await queriesCommand.parseAsync(['edit', '@nope'], { from: 'user' })
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
