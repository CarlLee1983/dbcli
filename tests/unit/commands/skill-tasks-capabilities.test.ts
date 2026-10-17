import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'
import { checkCapabilities } from '@/core/capabilities'
import { loadAgentTasks } from '@/core/agent-tasks/loader'
import { resolveAgentTaskDirs } from '@/core/agent-tasks/task-paths'
import { writeConfigWithIntegrity, assertConfigIntegrity } from '@/core/config-integrity'

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
  let output = ''
  let originalAgentMode: string | undefined
  let originalAnchorDirectory: string | undefined
  let exitCode: number | undefined

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'dbcli-task-capabilities-')))
    originalAgentMode = process.env.DBCLI_AGENT_MODE
    originalAnchorDirectory = process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR
    delete process.env.DBCLI_AGENT_MODE
    process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR = join(sandbox, 'anchors')
    cwd = process.cwd()
    process.chdir(sandbox)
    mkdirSync(join(sandbox, '.dbcli', 'tasks'), { recursive: true })
    errors = ''
    output = ''
    exitCode = undefined
  })

  afterEach(() => {
    process.chdir(cwd)
    if (originalAgentMode === undefined) delete process.env.DBCLI_AGENT_MODE
    else process.env.DBCLI_AGENT_MODE = originalAgentMode
    if (originalAnchorDirectory === undefined) delete process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR
    else process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR = originalAnchorDirectory
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  const errorSpy = spyOn(console, 'error').mockImplementation((value: unknown) => {
    errors += String(value)
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })
  const logSpy = spyOn(console, 'log').mockImplementation((value: unknown) => {
    output += String(value)
  })

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

  test('every built-in pack produces a plan under agent mode', async () => {
    const packs = await loadAgentTasks(resolveAgentTaskDirs(sandbox), { collectErrors: true })
    expect(packs.errors).toEqual([])
    expect(packs.size).toBeGreaterThan(0)
    const values: Record<string, string> = {
      table: 'users',
      collection: 'users',
      query: 'SELECT 1',
      ddl: 'ALTER TABLE users ADD COLUMN active boolean',
      orm_path: 'schema.prisma',
      filter: '{"status":"pending"}',
      set: '{"status":"ready"}',
      verify_query: 'SELECT count(*) FROM users',
      expect: 'value > 0',
    }
    const failures: Array<{ name: string; errors: string; exitCode?: number }> = []
    for (const { task: pack } of packs.values()) {
      const content = JSON.stringify({
        connection: {
          system: pack.engines?.[0] ?? 'postgresql',
          host: 'localhost',
          port: 1,
          user: 'test',
          database: 'test',
        },
        permission: 'query-only',
      })
      const configPath = join(sandbox, '.dbcli')
      delete process.env.DBCLI_AGENT_MODE
      await writeConfigWithIntegrity(configPath, content)
      process.env.DBCLI_AGENT_MODE = '1'
      await assertConfigIntegrity(configPath, content, { requireRecord: true })
      const params = pack.params
        .filter((param) => param.required)
        .flatMap((param) => {
          expect(values[param.name]).toBeDefined()
          return ['--param', `${param.name}=${values[param.name]}`]
        })
      errors = ''
      output = ''
      exitCode = undefined
      await root().parseAsync(
        [
          '--config',
          configPath,
          'skill',
          'tasks',
          'plan',
          pack.name,
          '--format',
          'json',
          ...params,
        ],
        { from: 'user' }
      )
      if (exitCode !== undefined || errors) {
        failures.push({ name: pack.name, errors, exitCode })
        continue
      }
      expect(JSON.parse(output)).toMatchObject({
        name: pack.name,
        source: 'builtin',
        mode: 'plan-only',
      })
      expect(JSON.parse(output).steps.length).toBeGreaterThan(0)
    }
    expect(failures).toEqual([])
    for (const { task: pack } of packs.values()) {
      expect(pack.safety.requires ?? []).not.toContain('blacklist.manage')
    }
    expect(packs.get('connection-health')?.task.safety.requires ?? []).toEqual([])
  })

  test('recognizes all configuration mutations as closed in agent mode', () => {
    process.env.DBCLI_AGENT_MODE = '1'
    const ids = [
      'blacklist.manage',
      'connection.init',
      'connection.select',
      'connection.rotate-credential',
    ]
    const report = checkCapabilities(ids, {
      engine: 'postgresql',
      permission: 'admin',
      connectionName: null,
      agentMode: process.env.DBCLI_AGENT_MODE === '1',
    })
    expect(report.ok).toBe(false)
    for (const id of ids) {
      expect(report.results.find((result) => result.id === id)).toMatchObject({
        status: 'unavailable',
        reason: 'agent-mode',
      })
    }
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
