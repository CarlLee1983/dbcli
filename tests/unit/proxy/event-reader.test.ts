// tests/unit/proxy/event-reader.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEvents } from '@/proxy/event-reader'

const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'proxy-reader-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const line = (ts: string, sql: string) =>
  JSON.stringify({
    version: 1,
    type: 'query_completed',
    timestamp: ts,
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'q',
    client: 'c',
    target: 't',
    sql,
    statement: 'SELECT',
    tables: [],
    durationMs: 1,
    requestBytes: 0,
    responseBytes: 0,
    rowCount: null,
    slow: false,
    error: null,
    tags: [],
  })

describe('readEvents', () => {
  it('merges current + .1 and sorts by timestamp', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, line('2026-06-04T12:00:02.000Z', 'SELECT 2') + '\n')
    writeFileSync(`${path}.1`, line('2026-06-04T12:00:01.000Z', 'SELECT 1') + '\n')
    const r = await readEvents(path, { includeRotated: true })
    expect(r.events.map((e) => (e as { sql: string }).sql)).toEqual(['SELECT 1', 'SELECT 2'])
    expect(r.files.length).toBe(2)
  })

  it('skips malformed lines and counts them', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, [line('2026-06-04T12:00:00.000Z', 'SELECT 1'), 'not json', ''].join('\n'))
    const r = await readEvents(path, { includeRotated: true })
    expect(r.events).toHaveLength(1)
    expect(r.malformedLines).toBe(1)
  })

  it('ignores the .1 segment when includeRotated is false', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, line('2026-06-04T12:00:02.000Z', 'SELECT cur') + '\n')
    writeFileSync(`${path}.1`, line('2026-06-04T12:00:01.000Z', 'SELECT old') + '\n')
    const r = await readEvents(path, { includeRotated: false })
    expect(r.files).toEqual([path])
    expect(r.events).toHaveLength(1)
  })

  it('returns empty files list when nothing exists', async () => {
    const dir = tmp()
    const r = await readEvents(join(dir, 'nope.jsonl'), { includeRotated: true })
    expect(r.files).toEqual([])
    expect(r.events).toEqual([])
  })
})
