import { describe, test, expect, spyOn, beforeEach, afterAll, mock } from 'bun:test'
import { Command } from 'commander'
import { join } from 'node:path'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

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

describe('builtin pack: mongo-safe-backfill', () => {
  let logOut = ''
  let exitCode: number | undefined
  beforeEach(() => {
    logOut = ''
    exitCode = undefined
  })
  const logSpy = spyOn(console, 'log').mockImplementation((m: unknown) => {
    logOut += String(m) + '\n'
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  test('appears in the builtin task list', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'list', '--format', 'json'], {
      from: 'node',
    })
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"name": "mongo-safe-backfill"')
  })

  test('plan resolves collection, filter and set into a Mongo dry-run preview', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'mongo-safe-backfill',
        '--param',
        'collection=orders',
        '--param',
        'filter={"status":"pending"}',
        '--param',
        'set={"shipped":true}',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    // schema step confirms sampled field names before any write
    expect(logOut).toContain('"resolvedCommand": "schema orders --format json"')
    // third step previews the write via --dry-run and never executes it;
    // JSON body is single-quoted (literal) with escaped inner double-quotes
    expect(logOut).toContain(
      `"resolvedCommand": "update orders --where '{\\"status\\":\\"pending\\"}' --set '{\\"shipped\\":true}' --dry-run"`
    )
  })

  test('plan fails when a required parameter is missing', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'mongo-safe-backfill',
        '--param',
        'collection=orders',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBe(1)
  })

  void logSpy
  void exitSpy
})

// Restore spies once this file completes so they don't leak into later test
// files (bun's spyOn persists across files within a process; file order differs
// by OS, so leaked spies can fail unrelated tests on Linux CI).
afterAll(() => {
  mock.restore()
})
