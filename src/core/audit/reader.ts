/**
 * Read-only audit reader (Phase 24, G decision).
 *
 * Stateless, lockless, redaction-free (entries arrive pre-redacted by Phase 22 D-22).
 * Tolerant to truncated last line (D-08); hard-fails on middle-line corruption (T-24-04).
 *
 * Functional API consumed by Wave 2/3 commander handlers:
 * - readEntries(file, { include_rotated })  → AuditEntry[]
 * - discoverConnections(auditDir)            → [{ connection, files }]
 * - tailEntries(entries, n)                  → AuditEntry[] (asc, latest last)
 * - mergeByTimestamp(byConn)                 → [{ connection, entry }] (ts asc, conn name tie-break)
 *
 * Path layout convention mirrors logger.ts (caller passes full file path).
 * Reader does NOT compute the storage path itself — caller supplies it.
 */
import { readFile, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'

import type { AuditEntry } from './types'

const WARN_PREFIX = '[dbcli audit]'

export interface ReadOptions {
  /** When true, prepend rotated `<file>.1` entries before current `<file>` entries. */
  include_rotated?: boolean
}

async function readSingle(path: string): Promise<AuditEntry[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const lines = raw.split('\n').filter(Boolean)
  const out: AuditEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    try {
      out.push(JSON.parse(lines[i]!) as AuditEntry)
    } catch {
      if (i === lines.length - 1) {
        process.stderr.write(`${WARN_PREFIX} skipping truncated last line in ${path}\n`)
        continue
      }
      throw new Error(
        `${WARN_PREFIX} corrupted line ${i + 1} in ${path}. Run \`dbcli audit clear\` to reset.`,
      )
    }
  }
  return out
}

export async function readEntries(
  auditFilePath: string,
  opts?: ReadOptions,
): Promise<AuditEntry[]> {
  if (opts?.include_rotated === true) {
    const rotated = await readSingle(`${auditFilePath}.1`)
    const current = await readSingle(auditFilePath)
    return rotated.concat(current)
  }
  return readSingle(auditFilePath)
}

export async function discoverConnections(
  auditDir: string,
): Promise<{ connection: string; files: string[] }[]> {
  let entries: Dirent[]
  try {
    entries = (await readdir(auditDir, { withFileTypes: true })) as Dirent[]
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const map = new Map<string, string[]>()
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!(e.name.endsWith('.jsonl') || e.name.endsWith('.jsonl.1'))) continue
    const conn = e.name.replace(/\.jsonl(?:\.1)?$/, '')
    const full = `${auditDir}/${e.name}`
    const list = map.get(conn) ?? []
    list.push(full)
    map.set(conn, list)
  }

  for (const files of map.values()) {
    files.sort(
      (a, b) => Number(b.endsWith('.jsonl.1')) - Number(a.endsWith('.jsonl.1')),
    )
  }

  return Array.from(map.entries())
    .map(([connection, files]) => ({ connection, files }))
    .sort((a, b) => a.connection.localeCompare(b.connection))
}

export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[] {
  if (n <= 0) return []
  return entries
    .slice()
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-n)
}

export function mergeByTimestamp(
  byConn: Map<string, AuditEntry[]>,
): Array<{ connection: string; entry: AuditEntry }> {
  const flat: Array<{ connection: string; entry: AuditEntry }> = []
  for (const [connection, entries] of byConn) {
    for (const entry of entries) flat.push({ connection, entry })
  }
  flat.sort((a, b) => {
    const t = a.entry.ts.localeCompare(b.entry.ts)
    return t !== 0 ? t : a.connection.localeCompare(b.connection)
  })
  return flat
}
