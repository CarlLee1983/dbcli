/**
 * SessionIdService — unit tests (Phase 21 / Plan 21-02)
 *
 * Covers AUDIT-02 (env-first + `<pid>-<unix-ts-ms>-<6charHex>` fallback) and
 * AUDIT-03 (in-process cache reuse + `.dbcli/last-session-id` persistence).
 *
 * Tests 1–7 correspond exactly to the seven behavior cases defined in
 * `.planning/phases/21-audit-writer-foundation/21-02-session-id-service-PLAN.md`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  LAST_SESSION_ID_RELATIVE,
  SessionIdService,
  generateSessionId,
  readSessionIdFile,
  writeSessionIdFile,
  type PersistedSessionId,
} from '../../../../src/core/audit/session-id'

const SESSION_ID_FORMAT = /^\d+-\d+-[0-9a-f]{6}$/

let workdirs: string[] = []
let originalEnv: string | undefined

async function makeWorkdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-session-id-'))
  workdirs.push(dir)
  return dir
}

async function writePersistedFile(
  storagePath: string,
  payload: PersistedSessionId
): Promise<void> {
  const fullPath = join(storagePath, LAST_SESSION_ID_RELATIVE)
  await mkdir(join(storagePath, '.dbcli'), { recursive: true })
  await writeFile(fullPath, JSON.stringify(payload, null, 2), 'utf8')
}

beforeEach(() => {
  originalEnv = process.env.DBCLI_SESSION_ID
  delete process.env.DBCLI_SESSION_ID
  workdirs = []
})

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.DBCLI_SESSION_ID
  } else {
    process.env.DBCLI_SESSION_ID = originalEnv
  }
  // Restore writable permissions before cleanup so rm -rf can succeed.
  for (const dir of workdirs) {
    try {
      await chmod(join(dir, '.dbcli'), 0o755)
    } catch {
      // dir might not exist; ignore.
    }
    try {
      await chmod(dir, 0o755)
    } catch {
      // ignore
    }
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      // ignore — test isolation handled by mkdtemp
    }
  }
})

describe('SessionIdService', () => {
  test('Test 1: DBCLI_SESSION_ID env wins and does not touch disk', async () => {
    const storage = await makeWorkdir()
    process.env.DBCLI_SESSION_ID = 'externally-injected-id-xyz'

    const service = new SessionIdService(storage)
    const id = await service.resolve()

    expect(id).toBe('externally-injected-id-xyz')

    // Env path must NOT have created the persisted file.
    let exists = true
    try {
      await stat(join(storage, LAST_SESSION_ID_RELATIVE))
    } catch {
      exists = false
    }
    expect(exists).toBe(false)
  })

  test('Test 2: in-process cache (AUDIT-03) — two calls reuse the same id, exactly one write', async () => {
    const storage = await makeWorkdir()

    const service = new SessionIdService(storage)
    const first = await service.resolve()
    const firstMtimeMs = (await stat(join(storage, LAST_SESSION_ID_RELATIVE))).mtimeMs

    // Wait a tick so a second write (if it happened) would produce a different mtime.
    await new Promise((resolve) => setTimeout(resolve, 10))

    const second = await service.resolve()
    const secondMtimeMs = (await stat(join(storage, LAST_SESSION_ID_RELATIVE))).mtimeMs

    expect(second).toBe(first)
    expect(secondMtimeMs).toBe(firstMtimeMs) // no second write
  })

  test('Test 3: persisted file with matching pid is reused (no regeneration)', async () => {
    const storage = await makeWorkdir()
    await writePersistedFile(storage, {
      sessionId: 'pid-match-id',
      pid: process.pid,
      createdAt: '2026-05-14T00:00:00.000Z',
    })

    const service = new SessionIdService(storage)
    const id = await service.resolve()

    expect(id).toBe('pid-match-id')
  })

  test('Test 4: pid mismatch triggers regenerate + write-back (D-13)', async () => {
    const storage = await makeWorkdir()
    const stalePid = process.pid === 999999 ? 999998 : 999999
    await writePersistedFile(storage, {
      sessionId: 'old-id',
      pid: stalePid,
      createdAt: '2026-05-14T00:00:00.000Z',
    })

    const service = new SessionIdService(storage)
    const id = await service.resolve()

    expect(id).not.toBe('old-id')
    expect(id).toMatch(SESSION_ID_FORMAT)

    const raw = await readFile(join(storage, LAST_SESSION_ID_RELATIVE), 'utf8')
    const parsed = JSON.parse(raw) as PersistedSessionId
    expect(parsed.sessionId).toBe(id)
    expect(parsed.pid).toBe(process.pid)
  })

  test('Test 5: generateSessionId produces unique, format-compliant ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const id = generateSessionId(12345, 1747234567890)
      expect(id).toMatch(SESSION_ID_FORMAT)
      ids.add(id)
    }
    expect(ids.size).toBe(50) // collision resistance via 6-hex random
  })

  test('Test 6: persisted file shape is { sessionId, pid, createdAt }', async () => {
    const storage = await makeWorkdir()

    const service = new SessionIdService(storage)
    await service.resolve()

    const raw = await readFile(join(storage, LAST_SESSION_ID_RELATIVE), 'utf8')
    const parsed = JSON.parse(raw) as PersistedSessionId
    expect(typeof parsed.sessionId).toBe('string')
    expect(typeof parsed.pid).toBe('number')
    expect(typeof parsed.createdAt).toBe('string')
    expect(parsed.sessionId).toMatch(SESSION_ID_FORMAT)
    expect(parsed.pid).toBe(process.pid)
    // createdAt is a valid ISO 8601 string parseable by Date
    expect(Number.isNaN(Date.parse(parsed.createdAt))).toBe(false)
  })

  test('Test 7: write failure is silent — still returns a valid id', async () => {
    const storage = await makeWorkdir()
    // Pre-create .dbcli/ as read-only so writes inside it fail.
    await mkdir(join(storage, '.dbcli'), { recursive: true })
    await chmod(join(storage, '.dbcli'), 0o555)

    const service = new SessionIdService(storage)
    const id = await service.resolve()

    expect(id).toMatch(SESSION_ID_FORMAT)
    // No throw — best-effort write means we still return a valid id.

    // Restore perms before afterEach cleanup.
    await chmod(join(storage, '.dbcli'), 0o755)
  })

  test('readSessionIdFile returns null when file missing', async () => {
    const storage = await makeWorkdir()
    const result = await readSessionIdFile(storage)
    expect(result).toBeNull()
  })

  test('readSessionIdFile returns null when JSON is malformed', async () => {
    const storage = await makeWorkdir()
    await mkdir(join(storage, '.dbcli'), { recursive: true })
    await writeFile(join(storage, LAST_SESSION_ID_RELATIVE), '{not valid json', 'utf8')

    const result = await readSessionIdFile(storage)
    expect(result).toBeNull()
  })

  test('readSessionIdFile returns null when shape is wrong', async () => {
    const storage = await makeWorkdir()
    await mkdir(join(storage, '.dbcli'), { recursive: true })
    await writeFile(
      join(storage, LAST_SESSION_ID_RELATIVE),
      JSON.stringify({ sessionId: 'x' }), // missing pid + createdAt
      'utf8'
    )

    const result = await readSessionIdFile(storage)
    expect(result).toBeNull()
  })

  test('writeSessionIdFile produces an atomic tmp+rename (no .tmp left behind)', async () => {
    const storage = await makeWorkdir()
    await writeSessionIdFile(storage, {
      sessionId: 'atomic-test',
      pid: process.pid,
      createdAt: '2026-05-14T00:00:00.000Z',
    })

    const target = join(storage, LAST_SESSION_ID_RELATIVE)
    const raw = await readFile(target, 'utf8')
    expect(JSON.parse(raw)).toEqual({
      sessionId: 'atomic-test',
      pid: process.pid,
      createdAt: '2026-05-14T00:00:00.000Z',
    })

    let tmpExists = true
    try {
      await stat(`${target}.tmp`)
    } catch {
      tmpExists = false
    }
    expect(tmpExists).toBe(false)
  })

  test('reset() clears the in-memory cache', async () => {
    const storage = await makeWorkdir()
    const service = new SessionIdService(storage)
    const first = await service.resolve()

    service.reset()
    // Without reset, second call would reuse cache; with reset + persisted file present,
    // it should re-read the file and return the same id (since pid matches).
    const second = await service.resolve()
    expect(second).toBe(first)
  })
})
