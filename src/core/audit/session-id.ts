/**
 * SessionIdService — resolves and persists the per-process audit session id.
 *
 * Decisions (see .planning/phases/21-audit-writer-foundation/21-CONTEXT.md):
 * - D-02: the DBCLI session-id env wins; otherwise `<pid>-<unix-ts-ms>-<6charHex>`.
 * - D-04: independent module (not embedded in AuditLogger); constructor-injected.
 * - D-13: persisted JSON includes pid; mismatch -> regenerate. No POSIX signal
 *         based liveness check; no timestamp-freshness check.
 *
 * Storage path is the resolved configuration storage path (see
 * src/core/config-binding.ts:resolveConfigStoragePath). The persisted file
 * lives at `<storagePath>/.dbcli/last-session-id`. Atomic write follows the
 * `writeLastEnvelope` pattern in src/core/recovery/last-envelope.ts:63-85.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Relative path under the storage root for the persisted session id file. */
export const LAST_SESSION_ID_RELATIVE = '.dbcli/last-session-id'

/** Persisted JSON shape (D-13). */
export interface PersistedSessionId {
  sessionId: string
  pid: number
  createdAt: string
}

/**
 * Pure generator — `<pid>-<unix-ts-ms>-<6charHex>`.
 *
 * The 6-char hex suffix is *not* cryptographic. It exists only to prevent
 * collisions when two ids are minted in the same millisecond within the same
 * pid (e.g. tight test loops). `crypto.randomBytes(3)` yields 24 random bits,
 * which is ample for that purpose.
 *
 * Exported for direct testing (Test 5 — format + uniqueness).
 */
export function generateSessionId(pid: number, nowMs: number): string {
  const random = randomBytes(3).toString('hex')
  return `${pid}-${nowMs}-${random}`
}

/**
 * Tolerant read of `<storagePath>/.dbcli/last-session-id`.
 *
 * Returns `null` for any failure mode (missing, unreadable, malformed JSON,
 * wrong shape). Callers regenerate and write back on null.
 *
 * Analog: src/core/recovery/last-envelope.ts:readLastEnvelope.
 */
export async function readSessionIdFile(storagePath: string): Promise<PersistedSessionId | null> {
  const target = join(storagePath, LAST_SESSION_ID_RELATIVE)
  try {
    await stat(target)
  } catch {
    return null
  }
  try {
    const raw = await readFile(target, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedSessionId>
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.createdAt === 'string'
    ) {
      return {
        sessionId: parsed.sessionId,
        pid: parsed.pid,
        createdAt: parsed.createdAt,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Atomic write via tmp + rename. Best-effort: filesystem failures are swallowed
 * because the caller already has a valid in-memory id to return.
 *
 * Analog: src/core/recovery/last-envelope.ts:writeLastEnvelope.
 */
export async function writeSessionIdFile(
  storagePath: string,
  payload: PersistedSessionId
): Promise<void> {
  const target = join(storagePath, LAST_SESSION_ID_RELATIVE)
  const tmp = `${target}.tmp`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, target)
  } catch {
    // Best-effort — caller still has a valid in-memory id (D-06 / STORE-04).
  }
}

/**
 * SessionIdService — one instance per process. Resolves the audit session id
 * exactly once and caches the result in memory.
 *
 * Resolution order:
 *   1. The DBCLI session-id env variable — agent-injected override (D-02).
 *   2. `.dbcli/last-session-id` with matching `pid` — continuation (D-13).
 *   3. Generate `<pid>-<unix-ts-ms>-<6charHex>` and persist.
 *
 * No PID-liveness check (D-13). No timestamp-freshness check.
 */
export class SessionIdService {
  private cached: string | null = null

  constructor(private readonly storagePath: string) {}

  async resolve(): Promise<string> {
    if (this.cached !== null) return this.cached

    // 1. env wins (D-02)
    const fromEnv = process.env.DBCLI_SESSION_ID
    if (fromEnv && fromEnv.length > 0) {
      this.cached = fromEnv
      return fromEnv
    }

    // 2. persisted file with matching pid (D-13)
    const saved = await readSessionIdFile(this.storagePath)
    if (saved && saved.pid === process.pid) {
      this.cached = saved.sessionId
      return saved.sessionId
    }

    // 3. generate + persist
    const id = generateSessionId(process.pid, Date.now())
    await writeSessionIdFile(this.storagePath, {
      sessionId: id,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    })
    this.cached = id
    return id
  }

  /** Test helper — clears the in-memory cache so tests can simulate fresh processes. */
  reset(): void {
    this.cached = null
  }
}
