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

describe('plan verification metadata is opt-in per pack', () => {
  let logOut = ''
  beforeEach(() => {
    logOut = ''
  })
  const logSpy = spyOn(console, 'log').mockImplementation((m: unknown) => {
    logOut += String(m) + '\n'
  })

  test('connection-health plan has no verification block', async () => {
    const program = makeRoot()
    await program.parseAsync(
      ['node', 'dbcli', 'skill', 'tasks', 'plan', 'connection-health', '--format', 'json'],
      { from: 'node' }
    )
    const plan = JSON.parse(logOut)
    expect(plan.verification).toBeUndefined()
  })

  void logSpy
})

// Restore spies once this file completes so they don't leak into later test
// files (bun's spyOn persists across files within a process; file order differs
// by OS, so leaked spies can fail unrelated tests on Linux CI).
afterAll(() => {
  mock.restore()
})
