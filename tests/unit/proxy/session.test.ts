// tests/unit/proxy/session.test.ts
import { describe, it, expect } from 'bun:test'
import { ProxySession } from '@/proxy/session'
import type { ProxyEvent } from '@/proxy/events'

function setup(opts?: { slowMs?: number }) {
  const events: ProxyEvent[] = []
  const warnings: string[] = []
  let t = 0
  let clientBytes = 0
  let serverBytes = 0
  const session = new ProxySession({
    sessionId: 'pxy_test',
    engine: 'postgresql',
    client: '127.0.0.1:1',
    target: '127.0.0.1:5432',
    slowMs: opts?.slowMs ?? 1000,
    now: () => t,
    getBytes: () => ({ clientBytes, serverBytes }),
    writeEvent: (e) => {
      events.push(e)
      return Promise.resolve()
    },
    warn: (m) => warnings.push(m),
  })
  return {
    session,
    events,
    warnings,
    advance: (ms: number) => {
      t += ms
    },
    setBytes: (c: number, s: number) => {
      clientBytes = c
      serverBytes = s
    },
  }
}

describe('ProxySession', () => {
  it('emits query_observed then query_completed with duration and byte deltas', async () => {
    const { session, events, advance, setBytes } = setup()
    setBytes(50, 0)
    session.onSignal({ kind: 'query', sql: 'SELECT * FROM users WHERE id=1' })
    advance(12)
    setBytes(50, 200)
    session.onSignal({ kind: 'query_end', rowCount: 1 })
    await session.flush()
    const observed = events.find((e) => e.type === 'query_observed')
    const completed = events.find((e) => e.type === 'query_completed')
    expect(observed).toBeDefined()
    expect(completed).toBeDefined()
    if (completed?.type === 'query_completed') {
      expect(completed.durationMs).toBe(12)
      expect(completed.statement).toBe('SELECT')
      expect(completed.tables).toEqual(['users'])
      expect(completed.requestBytes).toBe(50)
      expect(completed.responseBytes).toBe(200)
      expect(completed.rowCount).toBe(1)
    }
  })

  it('records tag signals on the eventual query_completed event', async () => {
    const { session, events } = setup()
    session.onSignal({ kind: 'query', sql: 'SELECT 1' })
    session.onSignal({ kind: 'tag', tag: 'prepared_statement' })
    session.onSignal({ kind: 'query_end', rowCount: null })
    await session.flush()
    const completed = events.find((e) => e.type === 'query_completed')
    expect(completed).toBeDefined()
    if (completed?.type === 'query_completed') {
      expect(completed.tags).toContain('prepared_statement')
    }
    // The earlier query_observed snapshot must NOT have been mutated by the later tag.
    const observed = events.find((e) => e.type === 'query_observed')
    if (observed?.type === 'query_observed') {
      expect(observed.tags).not.toContain('prepared_statement')
    }
  })

  it('resets the byte-delta boundary between sequential queries', async () => {
    const { session, events, setBytes } = setup()
    setBytes(0, 0)
    session.onSignal({ kind: 'query', sql: 'SELECT 1' })
    setBytes(20, 100)
    session.onSignal({ kind: 'query_end', rowCount: null })
    // second query: bytes accrue from the previous boundary
    session.onSignal({ kind: 'query', sql: 'SELECT 2' })
    setBytes(35, 250)
    session.onSignal({ kind: 'query_end', rowCount: null })
    await session.flush()
    const completed = events.filter((e) => e.type === 'query_completed')
    expect(completed.length).toBe(2)
    const first = completed[0]
    const second = completed[1]
    if (first?.type === 'query_completed') {
      expect(first.requestBytes).toBe(20)
      expect(first.responseBytes).toBe(100)
    }
    if (second?.type === 'query_completed') {
      expect(second.requestBytes).toBe(15) // 35 - 20 (previous boundary)
      expect(second.responseBytes).toBe(150) // 250 - 100 (snapshot at q2 start)
    }
  })

  it('emits query_errored on error signal', async () => {
    const { session, events } = setup()
    session.onSignal({ kind: 'query', sql: 'SELECT bad' })
    session.onSignal({ kind: 'error', code: '42703', message: 'no column' })
    await session.flush()
    const errored = events.find((e) => e.type === 'query_errored')
    expect(errored).toBeDefined()
    if (errored?.type === 'query_errored') {
      expect(errored.error.code).toBe('42703')
      expect(errored.error.message).toBe('no column')
    }
  })

  it('prints a slow-query warning when duration exceeds slowMs', async () => {
    const { session, warnings, advance } = setup({ slowMs: 10 })
    session.onSignal({ kind: 'query', sql: 'SELECT 1' })
    advance(25)
    session.onSignal({ kind: 'query_end', rowCount: null })
    await session.flush()
    expect(warnings.some((w) => w.includes('slow'))).toBe(true)
  })

  it('emits a parse_error event for parse_error signals', async () => {
    const { session, events } = setup()
    session.onSignal({ kind: 'parse_error', message: 'bad packet' })
    await session.flush()
    expect(events.some((e) => e.type === 'parse_error')).toBe(true)
  })

  it('start() and end() emit session lifecycle events', async () => {
    const { session, events, setBytes, advance } = setup()
    await session.start()
    advance(5)
    setBytes(10, 20)
    await session.end('client_closed')
    expect(events.find((e) => e.type === 'session_started')).toBeDefined()
    const ended = events.find((e) => e.type === 'session_ended')
    expect(ended).toBeDefined()
    if (ended?.type === 'session_ended') {
      expect(ended.reason).toBe('client_closed')
      expect(ended.durationMs).toBe(5)
      expect(ended.requestBytes).toBe(10)
      expect(ended.responseBytes).toBe(20)
    }
  })
})
