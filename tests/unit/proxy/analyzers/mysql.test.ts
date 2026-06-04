// tests/unit/proxy/analyzers/mysql.test.ts
import { describe, it, expect } from 'bun:test'
import { createMysqlAnalyzer } from '@/proxy/analyzers/mysql'
import type { AnalyzerSignal } from '@/proxy/analyzers/types'

function collect() {
  const signals: AnalyzerSignal[] = []
  const analyzer = createMysqlAnalyzer({ emit: (s) => signals.push(s) })
  return { signals, analyzer }
}

/** Build a MySQL packet: 3-byte LE length + seq + payload. */
function pkt(seq: number, payload: number[]): Uint8Array {
  const len = payload.length
  return new Uint8Array([len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, seq, ...payload])
}

function comQuery(sql: string): Uint8Array {
  const body = Array.from(new TextEncoder().encode(sql))
  return pkt(0, [0x03, ...body])
}

describe('mysql analyzer', () => {
  it('captures COM_QUERY SQL', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', comQuery('SELECT 1'))
    const q = signals.find((s) => s.kind === 'query')
    expect(q).toBeDefined()
    if (q?.kind === 'query') expect(q.sql).toBe('SELECT 1')
  })

  it('emits query_end on a server OK packet', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', comQuery('SELECT 1'))
    analyzer.onData('server_to_client', pkt(1, [0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]))
    expect(signals.some((s) => s.kind === 'query_end')).toBe(true)
  })

  it('captures ERR packet code and message', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', comQuery('SELECT bad'))
    const msg = Array.from(new TextEncoder().encode('Unknown column'))
    const sqlstate = Array.from(new TextEncoder().encode('#42S22'))
    analyzer.onData('server_to_client', pkt(1, [0xff, 0x68, 0x04, ...sqlstate, ...msg]))
    const err = signals.find((s) => s.kind === 'error')
    expect(err).toBeDefined()
    if (err?.kind === 'error') {
      expect(err.code).toBe('1128')
      expect(err.message).toContain('Unknown column')
    }
  })

  it('reassembles a SQL packet split across two chunks', () => {
    const { signals, analyzer } = collect()
    const full = comQuery('SELECT 12345')
    analyzer.onData('client_to_server', full.subarray(0, 6))
    analyzer.onData('client_to_server', full.subarray(6))
    const q = signals.find((s) => s.kind === 'query')
    if (q?.kind === 'query') expect(q.sql).toBe('SELECT 12345')
  })

  it('tags prepared statements on the query signal', () => {
    const { signals, analyzer } = collect()
    const body = Array.from(new TextEncoder().encode('SELECT ?'))
    analyzer.onData('client_to_server', pkt(0, [0x16, ...body])) // COM_STMT_PREPARE
    const q = signals.find((s) => s.kind === 'query')
    expect(q).toBeDefined()
    if (q?.kind === 'query') expect(q.tags).toContain('prepared_statement')
  })

  it('tags COM_STMT_EXECUTE without emitting a query signal', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', pkt(0, [0x17, 0x01, 0x00, 0x00, 0x00])) // COM_STMT_EXECUTE
    expect(signals.some((s) => s.kind === 'tag' && s.tag === 'prepared_statement')).toBe(true)
    expect(signals.some((s) => s.kind === 'query')).toBe(false)
  })

  it('emits parse_partial + query_end for a result-set header response', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', comQuery('SELECT * FROM t'))
    analyzer.onData('server_to_client', pkt(1, [0x01])) // column-count header (0x01)
    expect(signals.some((s) => s.kind === 'tag' && s.tag === 'parse_partial')).toBe(true)
    expect(signals.some((s) => s.kind === 'query_end')).toBe(true)
  })
})
