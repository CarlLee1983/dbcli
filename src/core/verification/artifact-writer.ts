import { mkdir, writeFile, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { VerificationArtifact } from './types'

/** Relative path under the storage root where artifacts are persisted. */
export const VERIFICATION_DIR_RELATIVE = '.dbcli/verification'

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

/** UTC timestamp stamp `YYYYMMDD-HHMMSS` derived from the artifact's createdAt. */
function timeStamp(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

/** Collapse an artifact id to a filesystem-safe short token. Prevents path traversal. */
function shortId(id: string): string {
  const tail = id.split(/[_-]/).filter(Boolean).pop() ?? id
  const safe = tail.toLowerCase().replace(/[^a-z0-9]/g, '')
  return safe.length > 0 ? safe.slice(0, 16) : 'artifact'
}

/**
 * Filename is generated entirely from the artifact — never from caller path input.
 * Pattern: `verification-<YYYYMMDD-HHMMSS>-<shortId>.json`.
 */
export function verificationArtifactFilename(artifact: VerificationArtifact): string {
  return `verification-${timeStamp(artifact.createdAt)}-${shortId(artifact.id)}.json`
}

/**
 * Persist an artifact atomically under `<storageDir>/.dbcli/verification/`.
 * - Creates the directory if missing.
 * - Generates the filename internally (no caller-controlled path segments).
 * - Writes to a temp file then uses atomic link to place it (fails with EEXIST if target exists).
 * - Throws rather than overwriting an existing artifact.
 * @returns the absolute path written.
 */
export async function writeVerificationArtifact(
  storageDir: string,
  artifact: VerificationArtifact
): Promise<string> {
  const dir = join(storageDir, VERIFICATION_DIR_RELATIVE)
  await mkdir(dir, { recursive: true })

  const target = join(dir, verificationArtifactFilename(artifact))
  const tmp = `${target}.${process.pid}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(artifact, null, 2), 'utf8')
    try {
      await link(tmp, target)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Verification artifact already exists: ${target}`)
      }
      throw e
    }
  } finally {
    await unlink(tmp).catch(() => {})
  }
  return target
}
