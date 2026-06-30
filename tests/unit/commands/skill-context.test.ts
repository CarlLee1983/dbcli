/**
 * `skill context` CLI entrypoint tests.
 *
 * The serializers (serializeXml/Json/Markdown) and gatherContext have unit
 * coverage, but the CLI wiring — format flag plumbing, default format, config
 * resolution, and invalid-format handling — had none. This drives the real
 * commander command so a regression in the agent-prompt payload surface is caught.
 */

import { describe, test, expect, spyOn, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { Command } from 'commander'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { registerSkillCommand } from '../../../src/commands/skill'

const CONFIG = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'user',
    password: 'pass',
    database: 'testdb',
  },
  permission: 'read-write',
  metadata: { version: '9.9.9' },
  blacklist: { tables: ['audit_logs'], columns: { users: ['password'] } },
  schema: {
    users: {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar(255)', nullable: false },
      ],
      primaryKey: ['id'],
    },
  },
}

function makeRoot(): Command {
  // Mirror cli.ts: --config is a GLOBAL option resolved before the subcommand,
  // which requires enablePositionalOptions() and the flag preceding `skill`.
  const program = new Command()
    .name('dbcli')
    .exitOverride()
    .enablePositionalOptions()
    .option('--config <path>', 'config path', '.dbcli')
  registerSkillCommand(program)
  return program
}

describe('skill context (CLI entrypoint)', () => {
  let logOut = ''
  let errOut = ''
  let exitCode: number | undefined
  let sandbox = ''
  let configPath = ''
  const origCwd = process.cwd()

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

  beforeEach(() => {
    logOut = ''
    errOut = ''
    exitCode = undefined
    logSpy.mockClear()
    errSpy.mockClear()
    exitSpy.mockClear()
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-ctx-'))
    configPath = join(sandbox, 'config.json')
    writeFileSync(configPath, JSON.stringify(CONFIG))
    // Isolate snippet scanning from the repo's own .dbcli/queries.
    process.chdir(sandbox)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  async function run(...args: string[]): Promise<void> {
    const program = makeRoot()
    await program.parseAsync(
      ['node', 'dbcli', '--config', configPath, 'skill', 'context', ...args],
      { from: 'node' }
    )
  }

  test('default format is XML', async () => {
    await run()
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('<database_context system="postgresql" permission="read-write"')
    expect(logOut).toContain('<tables>')
  })

  test('--format json emits parseable payload with system + permission', async () => {
    await run('--format', 'json')
    expect(exitCode).toBeUndefined()
    const parsed = JSON.parse(logOut.trim())
    expect(parsed.system).toBe('postgresql')
    expect(parsed.permission).toBe('read-write')
    expect(parsed.version).toBe('9.9.9')
    expect(parsed.schema.users).toBeDefined()
  })

  test('--format markdown emits the summary header', async () => {
    await run('--format', 'markdown')
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('# Database Context Summary')
    expect(logOut).toContain('**Engine System:** `postgresql`')
  })

  test('blacklisted table/column never leak into the payload', async () => {
    await run('--format', 'json')
    const parsed = JSON.parse(logOut.trim())
    // audit_logs is a blacklisted table; users.password a blacklisted column.
    expect(parsed.schema.audit_logs).toBeUndefined()
    expect(parsed.blacklist.tables).toContain('audit_logs')
  })

  test('invalid --format exits 1 with a helpful message', async () => {
    await run('--format', 'yaml')
    expect(exitCode).toBe(1)
    expect(errOut).toMatch(/Invalid format/i)
  })

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
