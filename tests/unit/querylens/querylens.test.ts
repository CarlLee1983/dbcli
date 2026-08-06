import { describe, expect, it } from 'bun:test'
import { analyzeQuerylensEvents, redactEventsForAnalysis } from '@/querylens/analyze'
import { renderQuerylensMarkdown } from '@/querylens/render'
import { completed, errored, sessionStarted } from '../proxy/event-fixtures'

const analyzeOptions = { slowMs: 50, top: 3, nPlusOne: 2, sourceFiles: [], malformedLines: 0 }

describe('QueryLens analysis', () => {
  it('redacts literals on a copy before analysis', () => {
    const original = completed({
      sql: "SELECT * FROM users WHERE email = 'secret@example.com' AND id = 42",
    })
    const redacted = redactEventsForAnalysis([original])
    expect(redacted[0]!.sql).toBe('SELECT * FROM users WHERE email = ? AND id = ?')
    expect(original.sql).toContain('secret@example.com')

    const report = analyzeQuerylensEvents([original], analyzeOptions)
    expect(report.querylens).toEqual({ name: 'querylens', version: '0.1.0' })
    expect(JSON.stringify(report)).not.toContain('secret@example.com')
    expect(JSON.stringify(report)).not.toContain('42')
  })

  it('renders stable markdown sections without SQL literal values', () => {
    const report = analyzeQuerylensEvents(
      [
        sessionStarted('session-a'),
        completed({
          sql: 'SELECT * FROM users WHERE id = 101',
          durationMs: 100,
          sessionId: 'session-a',
        }),
        completed({
          sql: 'SELECT * FROM users WHERE id = 202',
          durationMs: 75,
          sessionId: 'session-a',
        }),
        errored({
          sql: "SELECT * FROM missing WHERE code = 'private'",
          error: { code: '1146', message: "Unknown value 'private'" },
        }),
      ],
      analyzeOptions
    )
    const markdown = renderQuerylensMarkdown(report, 3)
    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('## Top expensive fingerprints')
    expect(markdown).toContain('## Slowest queries')
    expect(markdown).toContain('## Errors')
    expect(markdown).toContain('## N+1 suspects')
    expect(markdown).toContain('SELECT * FROM users WHERE id = ?')
    expect(markdown).not.toContain('101')
    expect(markdown).not.toContain('private')
  })
})
