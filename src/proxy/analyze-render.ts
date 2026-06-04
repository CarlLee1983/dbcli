// src/proxy/analyze-render.ts
import type { AnalysisReport } from './analyze'

/** Render an AnalysisReport as a sectioned plain-text view. `top` truncates lists. */
export function renderAnalysisText(report: AnalysisReport, top: number): string {
  if (report.summary.queries === 0 && report.summary.errors === 0) {
    return 'no events to analyze'
  }
  const s = report.summary
  const L: string[] = []

  L.push('SUMMARY')
  L.push(
    `  engine: ${report.engine ?? 'unknown'}  sessions: ${s.sessions}  ` +
      `queries: ${s.queries}  errors: ${s.errors} (${(s.errorRate * 100).toFixed(2)}%)`
  )
  L.push(
    `  latency ms: p50=${s.latencyMs.p50} p95=${s.latencyMs.p95} ` +
      `p99=${s.latencyMs.p99} max=${s.latencyMs.max}  slow=${s.slowCount}`
  )
  L.push(`  bytes: req=${s.bytes.request} resp=${s.bytes.response}`)

  L.push('', 'TOP QUERIES BY TOTAL TIME')
  for (const f of report.byFingerprint.slice(0, top)) {
    L.push(
      `  [${f.count}x total=${f.durationMs.total}ms avg=${f.durationMs.avg} ` +
        `p95=${f.durationMs.p95}] ${f.fingerprint}`
    )
  }

  L.push('', 'SLOWEST SINGLE QUERIES')
  for (const q of report.slowest.slice(0, top)) {
    L.push(`  ${q.durationMs}ms  ${q.sql}`)
  }

  L.push('', 'HOT TABLES')
  for (const t of report.hotTables.slice(0, top)) {
    L.push(`  ${t.queryCount}x  ${t.totalDurationMs}ms  ${t.table}`)
  }

  L.push('', 'ERRORS')
  if (report.errors.length === 0) L.push('  (none)')
  for (const e of report.errors.slice(0, top)) {
    L.push(`  ${e.count}x  [${e.code ?? '?'}] ${e.message}`)
  }

  L.push('', 'N+1 SUSPECTS')
  if (report.repetition.length === 0) L.push('  (none)')
  for (const r of report.repetition.slice(0, top)) {
    L.push(`  ${r.count}x in session ${r.sessionId} (${r.spanMs}ms)  ${r.fingerprint}`)
  }

  const cmds = [...new Set(report.byFingerprint.flatMap((f) => f.suggestedCommands ?? []))]
  if (cmds.length) {
    L.push('', 'SUGGESTED COMMANDS')
    for (const c of cmds) L.push(`  ${c}`)
  }

  return L.join('\n')
}
