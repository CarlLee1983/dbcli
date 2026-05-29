// src/formatters/guide/missing-index-yaml.ts
/**
 * Minimal, dependency-free YAML emitter tailored to MissingIndexReport. We do
 * not pull a YAML lib — the shape is fixed and small. Multi-line reasons use
 * the block scalar (`|`) form; column arrays use flow form for readability.
 */

import type { MissingIndexReport, IndexCandidate, AnalysisWarning } from '@/core/guide/missing-index/types'

function quoteScalar(s: string): string {
  // Bare-allow common identifier/sentence chars; quote anything riskier.
  if (/^[\w./()%~> ,-]+$/.test(s) && !/^\s|\s$/.test(s) && !s.includes(': ')) return s
  return JSON.stringify(s)
}

function block(value: string, indent: string): string {
  const lines = value.split('\n')
  if (lines.length === 1) return ` ${quoteScalar(value)}`
  return ` |\n` + lines.map((l) => `${indent}  ${l}`).join('\n')
}

function candidateYaml(c: IndexCandidate): string {
  const lines: string[] = []
  lines.push(`  - table: ${quoteScalar(c.table)}`)
  lines.push(`    columns: [${c.columns.join(', ')}]`)
  lines.push(`    reason:${block(c.reason, '    ')}`)
  lines.push(`    confidence: ${c.confidence}`)
  lines.push(`    existing_index_collision: ${c.existingIndexCollision ?? 'null'}`)
  if (c.estimatedRowsReduction) {
    lines.push(`    estimated_rows_reduction: ${quoteScalar(c.estimatedRowsReduction)}`)
  }
  return lines.join('\n')
}

function warningYaml(w: AnalysisWarning): string {
  const lines: string[] = []
  lines.push(`  - rule: ${w.rule}`)
  if (w.column) lines.push(`    column: ${quoteScalar(w.column)}`)
  lines.push(`    detail:${block(w.detail, '    ')}`)
  return lines.join('\n')
}

export function formatMissingIndexYaml(report: MissingIndexReport): string {
  const out: string[] = []
  out.push(`query:${block(report.query, '')}`)
  out.push(report.candidates.length ? 'candidates:' : 'candidates: []')
  for (const c of report.candidates) out.push(candidateYaml(c))
  out.push(report.warnings.length ? 'warnings:' : 'warnings: []')
  for (const w of report.warnings) out.push(warningYaml(w))
  return out.join('\n') + '\n'
}
