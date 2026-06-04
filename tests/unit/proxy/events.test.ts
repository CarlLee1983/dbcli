// tests/unit/proxy/events.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventWriter, applyRedaction, type QueryCompletedEvent } from '@/proxy/events'

const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'proxy-events-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function sampleEvent(sql: string): QueryCompletedEvent {
  return {
    version: 1,
    type: 'query_completed',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'qry_1',
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
    sql,
    statement: 'SELECT',
    tables: ['users'],
    durationMs: 1,
    requestBytes: 10,
    responseBytes: 20,
    rowCount: null,
    error: null,
    tags: [],
  }
}

describe('applyRedaction', () => {
  it('redacts sql when mode=literals', () => {
    const e = applyRedaction(sampleEvent("SELECT * FROM users WHERE id=5"), 'literals')
    expect(e.sql).toBe('SELECT * FROM users WHERE id=?')
  })
  it('leaves sql untouched when mode=none', () => {
    const e = applyRedaction(sampleEvent("SELECT 1"), 'none')
    expect(e.sql).toBe('SELECT 1')
  })
})

describe('EventWriter', () => {
  it('creates the parent directory and appends one JSON line per event', async () => {
    const dir = tmp()
    const path = join(dir, 'nested', 'events.jsonl')
    const w = new EventWriter({ path, redact: 'none' })
    await w.write(sampleEvent('SELECT 1'))
    await w.write(sampleEvent('SELECT 2'))
    expect(existsSync(path)).toBe(true)
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const parsed = JSON.parse(lines[0]!) as QueryCompletedEvent
    expect(parsed.type).toBe('query_completed')
    expect(parsed.version).toBe(1)
  })

  it('applies redaction at the write boundary', async () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    const w = new EventWriter({ path, redact: 'literals' })
    await w.write(sampleEvent("SELECT * FROM users WHERE id=5"))
    const line = readFileSync(path, 'utf8').trim()
    expect(JSON.parse(line).sql).toBe('SELECT * FROM users WHERE id=?')
  })
})
