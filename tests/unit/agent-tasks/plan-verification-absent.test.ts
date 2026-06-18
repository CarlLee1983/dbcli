import { describe, test, expect, spyOn, beforeEach } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
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
