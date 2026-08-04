import { mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

export type UpdateHintKind = 'update' | 'skill'

interface HintRecord {
  update?: string
  skill?: string
  updatedAt: string
}

interface HintState {
  version: 1
  sessions: Record<string, HintRecord>
}

const MAX_SESSIONS = 32

export function defaultCliSessionKey(): string {
  const explicit = process.env.DBCLI_SESSION_ID || process.env.TERM_SESSION_ID
  if (explicit) return explicit
  // Independent one-shot invocations from the same interactive shell share a
  // parent pid. Including the process id keeps a standalone invocation from
  // suppressing its own hint after a pid-reuse edge case.
  return `ppid:${process.ppid ?? process.pid}`
}

function statePath(configPath: string): string {
  // `.dbcli` is the normal directory fallback, even though it has no
  // extension. Explicit JSON/other extension paths are treated as legacy
  // config files and keep the sidecar next to the file.
  const looksLikeFile = extname(configPath) !== '' && !configPath.endsWith('.dbcli')
  const directory = looksLikeFile ? dirname(configPath) : configPath
  return join(directory, 'update-hints.json')
}

async function withHintStateLock<T>(path: string, work: () => Promise<T>): Promise<T | null> {
  const lockPath = `${path}.lock`
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        return await work()
      } finally {
        await handle.close().catch(() => undefined)
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') return null
      try {
        const age = Date.now() - (await stat(lockPath)).mtimeMs
        if (age > 10_000) await unlink(lockPath)
      } catch {
        // The owner may have released the lock between stat/unlink.
      }
      await Bun.sleep(5)
    }
  }
  return null
}

async function readState(path: string): Promise<HintState> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return { version: 1, sessions: {} }
    const raw = (await file.json()) as Partial<HintState>
    if (raw.version !== 1 || !raw.sessions || typeof raw.sessions !== 'object') {
      return { version: 1, sessions: {} }
    }
    return { version: 1, sessions: raw.sessions as Record<string, HintRecord> }
  } catch {
    return { version: 1, sessions: {} }
  }
}

async function writeState(path: string, state: HintState): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${process.pid}`
    await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8')
    await rename(temporary, path)
  } catch {
    // A hint is best effort; failure must not affect the command result.
  }
}

/** Claim a hint for this session. Returns false after the same kind was shown. */
export async function claimUpdateHint(
  configPath: string,
  kind: UpdateHintKind,
  sessionKey: string,
  value: string
): Promise<boolean> {
  const path = statePath(configPath)
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined)
  const claimed = await withHintStateLock(path, async () => {
    const state = await readState(path)
    const current = state.sessions[sessionKey]
    if (current?.[kind] !== undefined) return false

    state.sessions[sessionKey] = {
      ...(current ?? {}),
      [kind]: value,
      updatedAt: new Date().toISOString(),
    }

    const entries = Object.entries(state.sessions)
      .sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))
      .slice(-MAX_SESSIONS)
    state.sessions = Object.fromEntries(entries)
    await writeState(path, state)
    return true
  })
  return claimed === true
}

export function updateHintStatePathForTest(configPath: string): string {
  return statePath(configPath)
}
