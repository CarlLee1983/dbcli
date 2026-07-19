import { describe, test, expect, spyOn, beforeEach, afterAll, mock } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('builtin pack: orm-drift-review', () => {
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

  test('appears in the complete builtin task list', async () => {
    const program = makeRoot()
    await program.parseAsync(
      ['node', 'dbcli', 'skill', 'tasks', 'list', '--source', 'builtin', '--format', 'json'],
      { from: 'node' }
    )

    expect(exitCode).toBeUndefined()
    const tasks = JSON.parse(logOut) as Array<{ name: string; source: string }>
    expect(tasks).toHaveLength(13)
    expect(tasks.map((task) => task.name)).toContain('orm-drift-review')
    expect(tasks.every((task) => task.source === 'builtin')).toBe(true)
  })

  test('renders a plan-only drift review after blacklist and schema refresh', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'orm-drift-review',
        '--param',
        'orm_path=migrations/*.sql',
        '--format',
        'json',
      ],
      { from: 'node' }
    )

    expect(exitCode).toBeUndefined()
    const plan = JSON.parse(logOut) as {
      mode: string
      requires: string[]
      steps: Array<{
        resolvedCommand: string
        argv: string[]
        risk?: string
      }>
    }
    expect(plan.mode).toBe('plan-only')
    expect(plan.requires).toEqual(['blacklist-list', 'schema-check'])
    expect(plan.steps.map((step) => step.resolvedCommand)).toEqual([
      'blacklist list',
      'schema --format json',
      'diff --against-orm migrations/*.sql --format json',
    ])
    expect(plan.steps[2]?.argv).toEqual([
      'diff',
      '--against-orm',
      'migrations/*.sql',
      '--format',
      'json',
    ])
    expect(plan.steps.every((step) => step.risk === 'readonly')).toBe(true)
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
