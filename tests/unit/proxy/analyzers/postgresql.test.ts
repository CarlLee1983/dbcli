// tests/unit/proxy/analyzers/postgresql.test.ts
import { describe, it, expect } from 'bun:test'
import { createPostgresAnalyzer } from '@/proxy/analyzers/postgresql'
import type { AnalyzerSignal } from '@/proxy/analyzers/types'

function collect() {
  const signals: AnalyzerSignal[] = []
  const analyzer = createPostgresAnalyzer({ emit: (s) => signals.push(s) })
  return { signals, analyzer }
}

/** Build a typed pg message: type byte + 4-byte BE length (incl. length) + body. */
function msg(type: string, body: number[]): Uint8Array {
  const len = body.length + 4
  return new Uint8Array([
    type.charCodeAt(0),
    (len >> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...body,
  ])
}

function cstr(s: string): number[] {
  return [...Array.from(new TextEncoder().encode(s)), 0]
}

describe('postgres analyzer', () => {
  it('captures a simple Query (Q) SQL', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', msg('Q', cstr('SELECT 1')))
    const q = signals.find((s) => s.kind === 'query')
    expect(q).toBeDefined()
    if (q?.kind === 'query') expect(q.sql).toBe('SELECT 1')
  })

  it('captures an ErrorResponse (E) code + message', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', msg('Q', cstr('SELECT bad')))
    const fields = [
      0x43, ...cstr('42703'),
      0x4d, ...cstr('column missing'),
      0x00,
    ]
    analyzer.onData('server_to_client', msg('E', fields))
    const err = signals.find((s) => s.kind === 'error')
    expect(err).toBeDefined()
    if (err?.kind === 'error') {
      expect(err.code).toBe('42703')
      expect(err.message).toContain('column missing')
    }
  })

  it('emits query_end on CommandComplete (C) with row count', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', msg('Q', cstr('SELECT 1')))
    analyzer.onData('server_to_client', msg('C', cstr('SELECT 3')))
    const end = signals.find((s) => s.kind === 'query_end')
    expect(end).toBeDefined()
    if (end?.kind === 'query_end') expect(end.rowCount).toBe(3)
  })

  it('tags extended-protocol Parse (P)', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', msg('P', [...cstr(''), ...cstr('SELECT $1'), 0, 0]))
    expect(signals.some((s) => s.kind === 'tag' && s.tag === 'extended_protocol')).toBe(true)
  })

  it('skips the untyped startup message without emitting a query', () => {
    const { signals, analyzer } = collect()
    const startupBody = [0x00, 0x03, 0x00, 0x00, ...cstr('user'), ...cstr('x'), 0]
    const len = startupBody.length + 4
    analyzer.onData('client_to_server', new Uint8Array([
      (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...startupBody,
    ]))
    expect(signals.some((s) => s.kind === 'query')).toBe(false)
  })

  it('ignores server messages before any query (auth-phase ErrorResponse)', () => {
    const { signals, analyzer } = collect()
    // consume the untyped startup packet first so framing is in command phase
    const startupBody = [0x00, 0x03, 0x00, 0x00, ...cstr('user'), ...cstr('x'), 0]
    const slen = startupBody.length + 4
    analyzer.onData('client_to_server', new Uint8Array([
      (slen >> 24) & 0xff, (slen >> 16) & 0xff, (slen >> 8) & 0xff, slen & 0xff, ...startupBody,
    ]))
    const fields = [0x43, ...cstr('28P01'), 0x4d, ...cstr('auth failed'), 0x00]
    analyzer.onData('server_to_client', msg('E', fields))
    expect(signals.some((s) => s.kind === 'error')).toBe(false)
  })

  it('parses an ErrorResponse with a multibyte message without desync', () => {
    const { signals, analyzer } = collect()
    analyzer.onData('client_to_server', msg('Q', cstr('SELECT bad')))
    const fields = [0x43, ...cstr('42703'), 0x4d, ...cstr('欄位不存在'), 0x00]
    analyzer.onData('server_to_client', msg('E', fields))
    const err = signals.find((s) => s.kind === 'error')
    expect(err).toBeDefined()
    if (err?.kind === 'error') {
      expect(err.code).toBe('42703')
      expect(err.message).toBe('欄位不存在')
    }
  })
})
