// src/proxy/event-reader.ts
import { readFile } from 'node:fs/promises'
import type { ProxyEvent } from './events'

export interface ReadResult {
  events: ProxyEvent[]
  malformedLines: number
  files: string[]
}

export interface ReadOptions {
  includeRotated: boolean
}

/**
 * Read a proxy event log and (optionally) its rotated `.1` segment. Malformed
 * lines are skipped and counted, never thrown. Events are merge-sorted by
 * timestamp so a rotated segment interleaves correctly with the current file.
 */
export async function readEvents(path: string, opts: ReadOptions): Promise<ReadResult> {
  const candidates = opts.includeRotated ? [path, `${path}.1`] : [path]
  const files: string[] = []
  const events: ProxyEvent[] = []
  let malformedLines = 0

  for (const file of candidates) {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      continue // file doesn't exist — skip
    }
    files.push(file)
    for (const rawLine of raw.split('\n')) {
      const trimmed = rawLine.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as ProxyEvent)
      } catch {
        malformedLines += 1
      }
    }
  }

  events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  return { events, malformedLines, files }
}
