import { describe, test, expect, spyOn, beforeEach } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('builtin pack: migration-review', () => {
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
    expect(logOut).toContain('"name": "migration-review"')
  })

  test('plan resolves table and ddl templates', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'migration-review',
        '--param',
        'table=orders',
        '--param',
        'ddl=ALTER TABLE orders ADD COLUMN note text',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"resolvedCommand": "schema orders --format json"')
    expect(logOut).toContain(
      '"resolvedCommand": "plan \\"ALTER TABLE orders ADD COLUMN note text\\""'
    )
  })

  test('plan fails when a required parameter is missing', async () => {
    const program = makeRoot()
    await program.parseAsync(
      ['node', 'dbcli', 'skill', 'tasks', 'plan', 'migration-review', '--param', 'table=orders'],
      { from: 'node' }
    )
    expect(exitCode).toBe(1)
  })

  void logSpy
  void exitSpy
})
