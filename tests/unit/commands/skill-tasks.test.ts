import { describe, test, expect, spyOn, beforeEach, afterAll, mock } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('skill tasks (CLI integration with built-in tasks)', () => {
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

  test('list --format json returns at least one builtin task', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'list', '--format', 'json'], {
      from: 'node',
    })
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"name": "diagnose-slow-query"')
  })

  test('show prints markdown for known task', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'show', 'diagnose-slow-query'], {
      from: 'node',
    })
    expect(logOut).toContain('# diagnose-slow-query (builtin)')
    expect(logOut).toContain('blacklist list')
  })

  test('plan with --param produces resolved JSON', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'diagnose-slow-query',
        '--param',
        'query=SELECT 1',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(logOut).toContain('"resolvedCommand": "plan \\"SELECT 1\\""')
    expect(logOut).toContain('"argv"')
  })

  test('plan fails when required parameter is missing', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'plan', 'diagnose-slow-query'], {
      from: 'node',
    })
    expect(exitCode).toBe(1)
    expect(errOut).toMatch(/required parameter/i)
  })

  test('show on unknown task prints suggestion and exits 1', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'show', 'diagnose-slow-quer'], {
      from: 'node',
    })
    expect(exitCode).toBe(1)
    expect(errOut).toMatch(/Did you mean/)
  })

  // keep spies referenced so TS doesn't drop them under strict mode
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
