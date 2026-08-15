/**
 * What the interactive shell does before it writes.
 *
 * `dbcli shell` was the last SQL path the 2.0 write gate never reached: with a
 * read-write connection, `DROP TABLE users` typed at the prompt ran without a
 * question, while the same statement passed to `dbcli query` had to be
 * confirmed by typing the table name. Protection depended on which entry point
 * the operator picked, which is the thing the gate exists to remove.
 *
 * Only tier two is wired here. Every line in a shell is typed by a person, so
 * the tier-one y/N would fire on each one and make the shell unusable — and
 * tier one was designed for a batch of routine writes, which a shell is not.
 *
 * These tests observe what a caller can observe: whether the statement reached
 * the adapter, whether the shell survived, and what was asked.
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { promptUser } from '@/utils/prompts'
import { createShellWriteGate } from '@/commands/shell-write-gate'
import { ReplEngine } from '@/core/repl/repl-engine'
import type { ReplContext } from '@/core/repl/types'
import type { DatabaseAdapter } from '@/adapters/types'
import type { DbcliConfig } from '@/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const config = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'test',
    user: 'user',
    password: 'pass',
  },
  permission: 'admin',
} as unknown as DbcliConfig

describe('the write gate on the interactive shell', () => {
  let execute: ReturnType<typeof mock>
  let recorded: Array<{ outcome: string; tier: string }>
  let spies: Array<{ mockRestore: () => void }> = []
  let originalStdinIsTTY: unknown
  let typedAnswer = ''
  let written: string[] = []
  let tempDirectory: string
  let historyPath: string

  const adapter = (): DatabaseAdapter =>
    ({
      connect: async () => {},
      disconnect: async () => {},
      listTables: async () => [],
      getTableSchema: async (name: string) => ({ name, columns: [] }),
      execute,
      testConnection: async () => true,
      getServerVersion: async () => '16.0',
    }) as unknown as DatabaseAdapter

  const engine = (): ReplEngine => {
    const context: ReplContext = {
      configPath: join(tempDirectory, '.dbcli'),
      permission: 'admin',
      system: 'postgresql',
      tableNames: [],
      columnsByTable: {},
      commandNames: [],
    }
    const gate = createShellWriteGate({
      config,
      configPath: context.configPath,
      dialect: 'postgresql',
      record: async (decision) => {
        recorded.push({ outcome: decision.outcome, tier: decision.tier })
      },
    })
    return new ReplEngine(adapter(), context, historyPath, config, gate)
  }

  // Only stdin matters: readline prompts on stderr, so a shell whose stdout is
  // redirected still has a person answering.
  const setStdinTTY = (value: boolean) => {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  }

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'dbcli-shell-gate-'))
    historyPath = join(tempDirectory, 'history')
    typedAnswer = ''
    recorded = []
    written = []
    originalStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY
    execute = mock(async () => ({ rows: [], rowCount: 0, affectedRows: 0, columnNames: [] }))
    spies = [
      spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        written.push(String(chunk))
        return true
      }),
      spyOn(promptUser, 'confirm').mockImplementation(async () => true),
      spyOn(promptUser, 'text').mockImplementation(async () => typedAnswer),
    ]
  })

  afterEach(async () => {
    for (const spy of spies) spy.mockRestore()
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinIsTTY,
      configurable: true,
    })
    await rm(tempDirectory, { recursive: true, force: true })
  })

  test('typing the table name lets a full-table delete through', async () => {
    setStdinTTY(true)
    typedAnswer = 'users'

    const result = await engine().processInput('DELETE FROM users;')

    expect(promptUser.text).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.action).toBe('continue')
    expect(recorded).toEqual([{ outcome: 'allowed', tier: 'two' }])
  })

  test('typing anything else runs nothing and the shell stays alive', async () => {
    setStdinTTY(true)
    typedAnswer = 'yes'

    const result = await engine().processInput('DROP TABLE users;')

    expect(execute).not.toHaveBeenCalled()
    expect(result.action).toBe('continue')
    // Nothing on stdout: the gate already said on stderr what did not match,
    // and it is the only half that can tell a decline from a refusal.
    expect(result.output).toBeUndefined()
    expect(recorded).toEqual([{ outcome: 'declined', tier: 'two' }])
  })

  test('a tier-one write is not questioned — one y/N per typed line is unusable', async () => {
    setStdinTTY(true)

    const result = await engine().processInput('UPDATE users SET banned = 1 WHERE id = 3;')

    expect(promptUser.text).not.toHaveBeenCalled()
    expect(promptUser.confirm).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.action).toBe('continue')
    expect(recorded).toEqual([])
  })

  test('a read is never questioned', async () => {
    setStdinTTY(true)

    await engine().processInput('SELECT * FROM users;')

    expect(promptUser.text).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('piped input has nobody to answer, so tier two is refused rather than run', async () => {
    setStdinTTY(false)

    const result = await engine().processInput('DELETE FROM users;')

    expect(promptUser.text).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(result.action).toBe('continue')
    expect(recorded).toEqual([{ outcome: 'refused', tier: 'two' }])
  })

  test('WHERE 1=1 states the intent and the statement runs unquestioned', async () => {
    setStdinTTY(true)

    await engine().processInput('DELETE FROM users WHERE 1=1;')

    expect(promptUser.text).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('the confirmation is read through the caller-supplied reader', async () => {
    // The REPL's readline interface owns the terminal. A second reader opened on
    // stdin takes the same keystrokes twice — once as the confirmation, once as
    // the next line at the prompt — which is what this seam exists to prevent.
    setStdinTTY(true)
    const asked: string[] = []
    const gate = createShellWriteGate({
      config,
      configPath: join(tempDirectory, '.dbcli'),
      dialect: 'postgresql',
      record: async () => {},
      ask: async (question) => {
        asked.push(question)
        return 'users'
      },
    })

    const allowed = await gate('DELETE FROM users')

    expect(allowed).toBe(true)
    expect(asked).toHaveLength(1)
    expect(promptUser.text).not.toHaveBeenCalled()
  })

  test('withdrawing the question runs nothing and is not reported as a typo', async () => {
    // Ctrl-C at the confirmation. The operator gave no answer, so telling them
    // what they typed "did not match" describes something that never happened
    // (#85); the audit still records a decline, because they decided.
    setStdinTTY(true)
    const gate = createShellWriteGate({
      config,
      configPath: join(tempDirectory, '.dbcli'),
      dialect: 'postgresql',
      record: async (decision) => {
        recorded.push({ outcome: decision.outcome, tier: decision.tier })
      },
      ask: async () => null,
    })

    const allowed = await gate('DELETE FROM users')

    expect(allowed).toBe(false)
    expect(recorded).toEqual([{ outcome: 'declined', tier: 'two' }])
    expect(written.join('')).not.toMatch(/did not match/)
  })

  test('a statement typed over several lines is gated once, when it completes', async () => {
    setStdinTTY(true)
    typedAnswer = 'users'
    const shell = engine()

    const opened = await shell.processInput('DELETE FROM users')

    expect(opened.action).toBe('multiline')
    expect(promptUser.text).not.toHaveBeenCalled()

    await shell.processInput(';')

    expect(promptUser.text).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('a reconnect retry does not ask the operator to confirm the same statement twice', async () => {
    // The gate sits outside `runStatement` precisely so this holds. Fold the two
    // back together and one typed statement becomes two questions.
    setStdinTTY(true)
    typedAnswer = 'users'
    let attempts = 0
    execute = mock(async () => {
      attempts += 1
      if (attempts === 1) {
        throw Object.assign(new Error('Connection lost'), { code: 'ECONNRESET' })
      }
      return { rows: [], rowCount: 0, affectedRows: 0, columnNames: [] }
    })

    const result = await engine().processInput('DELETE FROM users;')

    expect(attempts).toBe(2)
    expect(promptUser.text).toHaveBeenCalledTimes(1)
    expect(result.action).toBe('continue')
  })

  test('an engine constructed without a gate behaves as it did before #78', async () => {
    setStdinTTY(true)
    const context: ReplContext = {
      configPath: join(tempDirectory, '.dbcli'),
      permission: 'admin',
      system: 'postgresql',
      tableNames: [],
      columnsByTable: {},
      commandNames: [],
    }
    const bare = new ReplEngine(adapter(), context, historyPath, config)

    await bare.processInput('DELETE FROM users;')

    expect(execute).toHaveBeenCalledTimes(1)
  })
})
