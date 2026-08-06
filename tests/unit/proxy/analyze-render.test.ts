// tests/unit/proxy/analyze-render.test.ts
import { describe, it, expect } from 'bun:test'
import { analyzeEvents } from '@/proxy/analyze'
import { renderAnalysisText } from '@/proxy/analyze-render'
import { completed, errored } from './event-fixtures'

const opts = { slowMs: 1000, top: 20, nPlusOne: 10, sourceFiles: ['x.jsonl'], malformedLines: 0 }

describe('renderAnalysisText', () => {
  it('renders section headers and suggested commands', () => {
    const report = analyzeEvents([completed({ durationMs: 100 }), errored()], opts)
    const text = renderAnalysisText(report, 20)
    expect(text).toContain('SUMMARY')
    expect(text).toContain('TOP QUERIES BY TOTAL TIME')
    expect(text).toContain('SLOWEST SINGLE QUERIES')
    expect(text).toContain('HOT TABLES')
    expect(text).toContain('ERRORS')
    expect(text).toContain('N+1 SUSPECTS')
    expect(text).toContain('SUGGESTED COMMANDS')
    expect(text).toContain('dbcli guide missing-index-for')
  })

  it('aggregates suggested commands from errors and N+1 groups, and renders hints', () => {
    const nPlusOne = (i: number) =>
      completed({
        sessionId: 'pxy_1',
        sql: `SELECT * FROM items WHERE order_id = ${i}`,
        statement: 'SELECT',
        tables: ['items'],
        durationMs: 2,
        timestamp: `2026-06-04T12:00:0${i}.000Z`,
      })
    const report = analyzeEvents(
      [
        nPlusOne(1),
        nPlusOne(2),
        nPlusOne(3),
        errored({ error: { code: '1054', message: 'unknown column' }, tables: ['missing'] }),
      ],
      { ...opts, nPlusOne: 3 }
    )
    const text = renderAnalysisText(report, 20)
    expect(text).toContain('dbcli schema missing')
    expect(text).toContain('HINTS')
    expect(text).toContain('N+1')
  })

  it('prints a friendly message when there is nothing to analyze', () => {
    const report = analyzeEvents([], opts)
    expect(renderAnalysisText(report, 20)).toBe('no events to analyze')
  })
})
