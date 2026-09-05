import { describe, test, expect, spyOn, beforeEach, afterAll, mock } from 'bun:test'
import { Command } from 'commander'
import { join } from 'node:path'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'
import { AdapterFactory } from '@/adapters'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  program.option(
    '--config <path>',
    'config path',
    join(import.meta.dir, '..', '..', 'fixtures', 'agent-tasks', 'capability-context.json')
  )
  program.setOptionValueWithSource(
    'config',
    join(import.meta.dir, '..', '..', 'fixtures', 'agent-tasks', 'capability-context.json'),
    'cli'
  )
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('builtin pack: slow-endpoint-investigation', () => {
  let logOut = ''
  let errOut = ''
  let exitCode: number | undefined
  beforeEach(() => {
    logOut = ''
    errOut = ''
    exitCode = undefined
  })
  const logSpy = spyOn(console, 'log').mockImplementation((m: unknown) => {
    logOut += String(m) + '\n'
  })
  const errSpy = spyOn(console, 'error').mockImplementation((m: unknown) => {
    errOut += String(m) + '\n'
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  const plan = async (params: string[]): Promise<void> => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'slow-endpoint-investigation',
        ...params.flatMap((kv) => ['--param', kv]),
        '--format',
        'json',
      ],
      { from: 'node' }
    )
  }

  test('appears in the builtin task list', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'list', '--format', 'json'], {
      from: 'node',
    })
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"name": "slow-endpoint-investigation"')
  })

  test('plans blacklist, proxy, schema, explain and missing-index in that order', async () => {
    await plan(['query=SELECT 1', 'table=orders'])

    expect(exitCode).toBeUndefined()
    const resolved: string[] = JSON.parse(logOut).steps.map(
      (step: { resolvedCommand: string }) => step.resolvedCommand
    )

    expect(resolved).toEqual([
      'blacklist list',
      'proxy analyze --format json',
      'schema orders --format json',
      'explain "SELECT 1"',
      'guide missing-index-for "SELECT 1" --format json',
    ])
  })

  test('confirms the table shape before explain and index guidance', async () => {
    await plan(['query=SELECT 1', 'table=orders'])

    const resolved: string[] = JSON.parse(logOut).steps.map(
      (step: { resolvedCommand: string }) => step.resolvedCommand
    )
    const schemaAt = resolved.findIndex((command) => command.startsWith('schema '))

    expect(schemaAt).toBeGreaterThan(-1)
    expect(schemaAt).toBeLessThan(resolved.findIndex((command) => command.startsWith('explain ')))
    expect(schemaAt).toBeLessThan(
      resolved.findIndex((command) => command.startsWith('guide missing-index-for '))
    )
  })

  test('every step carries a bounded reason and stays read-only', async () => {
    await plan(['query=SELECT 1', 'table=orders'])

    const parsed = JSON.parse(logOut)
    expect(parsed.mode).toBe('plan-only')
    for (const step of parsed.steps as Array<{ reason?: string; risk?: string }>) {
      expect(step.risk).toBe('readonly')
      expect(typeof step.reason).toBe('string')
      expect((step.reason ?? '').length).toBeGreaterThan(0)
      expect((step.reason ?? '').length).toBeLessThanOrEqual(200)
    }
  })

  test('planning never constructs an adapter', async () => {
    // A tripwire rather than an assertion after the fact: if planning ever
    // reaches for a connection, the plan fails instead of quietly connecting.
    const tripwires = (
      [
        'createAdapter',
        'createSqlAdapter',
        'createMongoDBAdapter',
        'createAdapterWithoutRules',
      ] as const
    ).map((method) =>
      spyOn(AdapterFactory, method).mockImplementation((() => {
        throw new Error(`planning constructed an adapter via ${method}`)
      }) as never)
    )

    try {
      await plan(['query=SELECT 1', 'table=orders'])
      expect(exitCode).toBeUndefined()
      expect(errOut).toBe('')
      expect(logOut).toContain('"resolvedCommand": "schema orders --format json"')
    } finally {
      for (const tripwire of tripwires) tripwire.mockRestore()
    }
  })

  test('a missing table fails before any plan is emitted', async () => {
    await plan(['query=SELECT 1'])

    expect(exitCode).toBe(1)
    expect(errOut).toContain("Missing required parameter 'table'")
    expect(errOut.length).toBeLessThanOrEqual(200)
    expect(logOut).toBe('')
  })

  test('a missing query fails before any plan is emitted', async () => {
    await plan(['table=orders'])

    expect(exitCode).toBe(1)
    expect(errOut).toContain("Missing required parameter 'query'")
    expect(logOut).toBe('')
  })

  void logSpy
  void errSpy
  void exitSpy
})

// Restore spies once this file completes so they don't leak into later test
// files (bun's spyOn persists across files within a process; file order differs
// by OS, so leaked spies can fail unrelated tests on Linux CI).
afterAll(() => {
  mock.restore()
})
