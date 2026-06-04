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

  it('prints a friendly message when there is nothing to analyze', () => {
    const report = analyzeEvents([], opts)
    expect(renderAnalysisText(report, 20)).toBe('no events to analyze')
  })
})
