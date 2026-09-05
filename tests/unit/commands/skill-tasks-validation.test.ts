/**
 * `skill tasks list` filter validation: an invalid --engine/--source must fail
 * loudly with the allowed values, not silently return "No agent tasks found."
 * (which reads as "you have no tasks" rather than "you typoed the filter").
 */

import { describe, test, expect, spyOn, beforeEach, afterAll, mock } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('skill tasks list — filter validation', () => {
  let errOut = ''
  let exitCode: number | undefined

  beforeEach(() => {
    errOut = ''
    exitCode = undefined
  })

  spyOn(console, 'log').mockImplementation(() => {})
  spyOn(console, 'error').mockImplementation((m: unknown) => {
    errOut += String(m) + '\n'
  })
  spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  test('--engine <invalid> exits 1 and lists valid engines', async () => {
    await makeRoot().parseAsync(['node', 'dbcli', 'skill', 'tasks', 'list', '--engine', 'banana'], {
      from: 'node',
    })
    expect(exitCode).toBe(1)
    expect(errOut).toContain('banana')
    expect(errOut).toContain('postgres')
    expect(errOut).toContain('elasticsearch')
  })

  test('--source <invalid> exits 1 and lists valid sources', async () => {
    await makeRoot().parseAsync(['node', 'dbcli', 'skill', 'tasks', 'list', '--source', 'nope'], {
      from: 'node',
    })
    expect(exitCode).toBe(1)
    expect(errOut).toContain('nope')
    expect(errOut).toContain('builtin')
    expect(errOut).toContain('local')
  })

  test('the canonical PostgreSQL engine spelling is accepted', async () => {
    await makeRoot().parseAsync(
      ['node', 'dbcli', 'skill', 'tasks', 'list', '--engine', 'postgresql'],
      {
        from: 'node',
      }
    )
    expect(exitCode).toBeUndefined()
    expect(errOut).toBe('')
  })
})

afterAll(() => {
  mock.restore()
})
