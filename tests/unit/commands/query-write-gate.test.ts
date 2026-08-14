/**
 * What the query command does before it writes.
 *
 * `dbcli query` was the one write path with no confirmation at all: any
 * read-write connection would run `UPDATE users SET banned = 1` without asking
 * anybody, which is precisely the statement an agent is most likely to generate.
 * These tests observe only what a caller can observe — whether the statement
 * reached the database, whether the process failed, and what was asked.
 *
 * `executeConnection` is the single point at which this command opens a
 * connection and issues anything, so "not called" is the strongest available
 * statement of "the database was never touched".
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { promptUser } from '@/utils/prompts'
import { executeQueryCommand } from '@/commands/query'

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
  blacklist: { tables: [], columns: {} },
}

const emptyResult = {
  result: { rows: [], rowCount: 0, fields: [], executionTimeMs: 1 },
  diagnostics: [],
  notices: [],
}

describe('the two-tier gate on raw SQL', () => {
  let executeConnection: ReturnType<typeof mock>
  let spies: Array<{ mockRestore: () => void }> = []
  let originalIsTTY: unknown
  let originalStdinIsTTY: unknown
  let confirmAnswer = true
  let typedAnswer = ''

  const run = (sql: string, options: Record<string, unknown> = {}) =>
    executeQueryCommand(sql, options as never, undefined, {
      loadConfig: async () => config as never,
      preflight: async () => {},
      executeConnection: executeConnection as never,
      presentResult: async () => {},
      writeAudit: (async () => null) as never,
    })

  // Both streams, because tier two prompts on stdin and reports on stdout: a
  // terminal on one side only is the agent-harness case the gate must refuse.
  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  }

  beforeEach(() => {
    confirmAnswer = true
    typedAnswer = ''
    originalIsTTY = (process.stdout as { isTTY?: boolean }).isTTY
    originalStdinIsTTY = (process.stdin as { isTTY?: boolean }).isTTY
    executeConnection = mock(async () => emptyResult)
    spies = [
      spyOn(console, 'log').mockImplementation(() => {}),
      spyOn(process.stderr, 'write').mockImplementation(() => true),
      spyOn(promptUser, 'confirm').mockImplementation(async () => confirmAnswer),
      spyOn(promptUser, 'text').mockImplementation(async () => typedAnswer),
    ]
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    })
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinIsTTY,
      configurable: true,
    })
  })

  describe('reads are not writes', () => {
    test('a select is never questioned, terminal or not', async () => {
      setTTY(true)
      await run('SELECT * FROM users')

      expect(promptUser.confirm).not.toHaveBeenCalled()
      expect(executeConnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('tier one — an ordinary write', () => {
    test('a person at a terminal is asked first', async () => {
      setTTY(true)
      await run('UPDATE users SET banned = 1 WHERE id = 3')

      expect(promptUser.confirm).toHaveBeenCalledTimes(1)
      expect(executeConnection).toHaveBeenCalledTimes(1)
    })

    test('declining runs nothing and does not fail the process', async () => {
      setTTY(true)
      confirmAnswer = false
      await run('UPDATE users SET banned = 1 WHERE id = 3')

      expect(executeConnection).not.toHaveBeenCalled()
    })

    test('--yes skips the question so a batch of routine writes stays a batch', async () => {
      setTTY(true)
      await run('UPDATE users SET banned = 1 WHERE id = 3', { yes: true })

      expect(promptUser.confirm).not.toHaveBeenCalled()
      expect(executeConnection).toHaveBeenCalledTimes(1)
    })

    test('a non-interactive caller runs as it always has', async () => {
      setTTY(false)
      await run('UPDATE users SET banned = 1 WHERE id = 3')

      expect(promptUser.confirm).not.toHaveBeenCalled()
      expect(executeConnection).toHaveBeenCalledTimes(1)
    })

    test('an explicit json format is a machine asking, so nothing is asked back', async () => {
      setTTY(true)
      await run('UPDATE users SET banned = 1 WHERE id = 3', { format: 'json' })

      expect(promptUser.confirm).not.toHaveBeenCalled()
      expect(executeConnection).toHaveBeenCalledTimes(1)
    })
  })

  describe('tier two — a write with nothing to limit it', () => {
    test('typing the table name lets it through', async () => {
      setTTY(true)
      typedAnswer = 'users'
      await run('UPDATE users SET banned = 1')

      expect(promptUser.text).toHaveBeenCalledTimes(1)
      expect(executeConnection).toHaveBeenCalledTimes(1)
    })

    test('typing anything else runs nothing', async () => {
      setTTY(true)
      typedAnswer = 'yes'
      await run('UPDATE users SET banned = 1')

      expect(executeConnection).not.toHaveBeenCalled()
    })

    test('--yes does not open the gate', async () => {
      setTTY(true)
      typedAnswer = ''
      await run('DELETE FROM users', { yes: true })

      expect(executeConnection).not.toHaveBeenCalled()
    })

    test('a non-interactive caller is refused before the database is touched', async () => {
      setTTY(false)
      const attempt = run('UPDATE users SET banned = 1')

      await expect(attempt).rejects.toThrow()
      expect(executeConnection).not.toHaveBeenCalled()
    })

    test('the refusal names a reason a caller can branch on', async () => {
      setTTY(false)
      const error = await run('DELETE FROM users').catch((caught: unknown) => caught)

      expect((error as { code?: string }).code).toBe('WRITE_GATE_REFUSED')
      expect((error as { reason?: string }).reason).toBe('no_where')
    })

    test('the refusal says what to change about the statement', async () => {
      setTTY(false)
      const error = await run('DELETE FROM users').catch((caught: unknown) => caught)

      expect((error as Error).message).toMatch(/WHERE|LIMIT/)
    })

    test('an explicit json format is refused even at a terminal', async () => {
      setTTY(true)
      const attempt = run('DELETE FROM users', { format: 'json' })

      await expect(attempt).rejects.toThrow()
      expect(executeConnection).not.toHaveBeenCalled()
      expect(promptUser.text).not.toHaveBeenCalled()
    })

    test('DROP is refused to an unattended caller whatever the connection may do', async () => {
      setTTY(false)
      const attempt = run('DROP TABLE users')

      await expect(attempt).rejects.toThrow()
      expect(executeConnection).not.toHaveBeenCalled()
    })

    test('a terminal on stdout alone is not somebody watching', async () => {
      // The agent-harness case: a pty on the output side, nothing on stdin.
      // Prompting here either reads an empty line and exits zero having done
      // nothing, or blocks forever — both worse than the refusal.
      setTTY(false)
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })

      const attempt = run('DELETE FROM users')

      await expect(attempt).rejects.toThrow()
      expect(promptUser.text).not.toHaveBeenCalled()
      expect(executeConnection).not.toHaveBeenCalled()
    })

    test('a refusal under --format json is a document on stdout, not only prose on stderr', async () => {
      setTTY(false)
      const printed: string[] = []
      const logSpy = spyOn(console, 'log').mockImplementation((line: unknown) => {
        printed.push(String(line))
      })

      await run('DELETE FROM users', { format: 'json' }).catch(() => {})
      logSpy.mockRestore()

      const document = JSON.parse(printed.join('\n')) as Record<string, unknown>
      expect(document.status).toBe('refused')
      expect(document.code).toBe('WRITE_GATE_REFUSED')
      expect(document.reason).toBe('no_where')
    })

    test('WHERE 1=1 states the intent and the statement runs unattended', async () => {
      setTTY(false)
      await run('UPDATE users SET banned = 1 WHERE 1=1')

      expect(executeConnection).toHaveBeenCalledTimes(1)
    })
  })
})
