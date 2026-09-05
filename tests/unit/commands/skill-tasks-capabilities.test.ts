import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'
import { checkCapabilities } from '@/core/capabilities'

function root(): Command {
  const program = new Command().name('dbcli').exitOverride()
  program.option('--config <path>', 'config path', '.dbcli')
  registerSkillTasksCommand(program.command('skill'))
  return program
}

describe('skill tasks plan capability requirements', () => {
  let sandbox = ''
  let cwd = ''
  let errors = ''
  let exitCode: number | undefined

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-task-capabilities-'))
    cwd = process.cwd()
    process.chdir(sandbox)
    mkdirSync(join(sandbox, '.dbcli', 'tasks'), { recursive: true })
    errors = ''
    exitCode = undefined
  })

  afterEach(() => {
    process.chdir(cwd)
    delete process.env.DBCLI_AGENT_MODE
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  const errorSpy = spyOn(console, 'error').mockImplementation((value: unknown) => {
    errors += String(value)
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })
  const logSpy = spyOn(console, 'log').mockImplementation(() => {})

  function task(requires: string): void {
    writeFileSync(
      join(sandbox, '.dbcli', 'tasks', 'check.md'),
      `---\nname: check\nsafety:\n  mode: plan-only\n  requires: [${requires}]\nsteps:\n  - type: command\n    command: status\n---\n`
    )
  }

  function config(system: string, permission: string): void {
    writeFileSync(
      join(sandbox, 'config.json'),
      JSON.stringify({
        connection: { system, host: 'localhost', port: 1, user: 'test', database: 'test' },
        permission,
      })
    )
  }

  async function plan(): Promise<void> {
    await root().parseAsync(
      ['node', 'dbcli', '--config', 'config.json', 'skill', 'tasks', 'plan', 'check'],
      {
        from: 'node',
      }
    )
  }

  test('fails closed for an unsupported engine', async () => {
    task('query.explain')
    config('redis', 'admin')
    await plan()
    expect(exitCode).toBe(1)
    expect(errors).toContain('query.explain: engine')
  })

  test('fails closed for insufficient permission', async () => {
    task('schema.migrate')
    config('postgresql', 'query-only')
    await plan()
    expect(exitCode).toBe(1)
    expect(errors).toContain('schema.migrate: permission')
  })

  test('recognizes agent mode as a closed capability boundary', () => {
    const report = checkCapabilities(['blacklist.manage'], {
      engine: 'postgresql',
      permission: 'admin',
      connectionName: null,
      agentMode: true,
    })
    expect(report.ok).toBe(false)
    expect(report.results[0]).toMatchObject({ reason: 'agent-mode' })
  })

  test('fails closed without a capability context', async () => {
    task('schema.read')
    await plan()
    expect(exitCode).toBe(1)
    expect(errors).toContain('schema.read: context-unavailable')
  })

  void errorSpy
  void exitSpy
  void logSpy
})

afterAll(() => mock.restore())
