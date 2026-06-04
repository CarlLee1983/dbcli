// tests/integration/proxy-analyze.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmps: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'proxy-analyze-it-'))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const evt = (sql: string, durationMs: number) =>
  JSON.stringify({
    version: 1,
    type: 'query_completed',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'q',
    client: 'c',
    target: 't',
    sql,
    statement: 'SELECT',
    tables: ['users'],
    durationMs,
    requestBytes: 1,
    responseBytes: 2,
    rowCount: 1,
    slow: false,
    error: null,
    tags: [],
  })

describe('dbcli proxy analyze (CLI)', () => {
  it('reads an events file and prints a JSON report', () => {
    const dir = tmp()
    const path = join(dir, 'events.jsonl')
    writeFileSync(path, [evt('SELECT * FROM users WHERE id = 1', 50), 'garbage'].join('\n'))

    const proc = Bun.spawnSync([
      'bun',
      'run',
      'src/cli.ts',
      'proxy',
      'analyze',
      '--events',
      path,
      '--format',
      'json',
    ])
    expect(proc.exitCode).toBe(0)
    const report = JSON.parse(proc.stdout.toString())
    expect(report.tool).toBe('proxy-analyze')
    expect(report.summary.queries).toBe(1)
    expect(report.source.malformedLines).toBe(1)
    expect(report.byFingerprint[0].fingerprint).toBe('SELECT * FROM users WHERE id = ?')
  })

  it('exits 1 with a friendly message when the events file is missing', () => {
    const dir = tmp()
    const proc = Bun.spawnSync([
      'bun',
      'run',
      'src/cli.ts',
      'proxy',
      'analyze',
      '--events',
      join(dir, 'nope.jsonl'),
    ])
    expect(proc.exitCode).toBe(1)
    expect(proc.stderr.toString()).toContain('no events found')
  })
})
