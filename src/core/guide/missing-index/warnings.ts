// src/core/guide/missing-index/warnings.ts
/**
 * Pure warning collector. Surfaces analysis limits the user must know about:
 * functional/expression columns that defeat plain indexes, and parser fallback.
 */

import type { AnalysisWarning, QueryAnalysis } from './types'

export function collectWarnings(analysis: QueryAnalysis): AnalysisWarning[] {
  if (!analysis.parsed) {
    return [
      {
        rule: 'parser-limit',
        detail:
          'SQL could not be parsed by node-sql-parser; ran EXPLAIN-only heuristic. ' +
          'Index candidates are unavailable — review the plan manually or simplify the query.',
      },
    ]
  }

  const warnings: AnalysisWarning[] = []
  for (const table of analysis.tables) {
    for (const fn of table.functionalColumns) {
      warnings.push({
        rule: 'functional-expression',
        column: fn.column,
        detail:
          `${table.table}.${fn.column} is wrapped in ${fn.expr}(...) — a plain index on the column ` +
          `cannot avoid filesort/recompute. Consider (1) a generated column + index, or (2) a range WHERE.`,
      })
    }
  }
  return warnings
}
