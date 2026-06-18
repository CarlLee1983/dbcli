import { describe, test, expect, spyOn, beforeEach } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('builtin pack: safe-backfill-verify', () => {
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
    expect(logOut).toContain('"name": "safe-backfill-verify"')
  })

  test('plan emits a read-back assert step from verify_query and expect', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'safe-backfill-verify',
        '--param',
        'table=orders',
        '--param',
        'query=UPDATE orders SET status = 1 WHERE status IS NULL',
        '--param',
        'verify_query=SELECT count(*) FROM orders WHERE status IS NULL',
        '--param',
        'expect=rows == 0',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"resolvedCommand": "schema orders --format json"')
    expect(logOut).toContain(
      '"resolvedCommand": "assert \\"SELECT count(*) FROM orders WHERE status IS NULL\\" --expect \\"rows == 0\\""'
    )
  })

  void logSpy
  void exitSpy
})
