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
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('builtin pack: mongo-schema-drift-review', () => {
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
    expect(logOut).toContain('"name": "mongo-schema-drift-review"')
  })

  test('plan applies the default sample size when none is given', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'mongo-schema-drift-review',
        '--param',
        'collection=events',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"resolvedCommand": "schema events --sample-size 200 --format json"')
  })

  test('plan honours an explicit sample size to stabilise drift detection', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'mongo-schema-drift-review',
        '--param',
        'collection=events',
        '--param',
        'sample_size=500',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"resolvedCommand": "schema events --sample-size 500 --format json"')
  })

  test('plan fails when the required collection parameter is missing', async () => {
    const program = makeRoot()
    await program.parseAsync(
      ['node', 'dbcli', 'skill', 'tasks', 'plan', 'mongo-schema-drift-review'],
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
