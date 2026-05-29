// src/core/guide/missing-index/candidate-builder.ts
/**
 * Pure composite-index candidate builder. One candidate per table, columns
 * ordered for leftmost-prefix usefulness: equality (incl. join equality) →
 * range → order/group. Candidates already covered by an existing index prefix
 * are dropped; candidates that merely extend an existing leftmost column carry
 * that index name as a collision so the scorer can explain the relationship.
 *
 * `reason` is left empty here and filled by the scorer (Task 7), which has the
 * plan facts needed to justify the suggestion.
 */

import type { ExistingIndex, IndexCandidate, TableColumnUsage } from './types'

function uniqueInOrder(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const c of list) {
      if (!seen.has(c)) {
        seen.add(c)
        out.push(c)
      }
    }
  }
  return out
}

/** True when `prefix` is a leftmost prefix of (or equal to) `cols`. */
function isPrefix(prefix: string[], cols: string[]): boolean {
  if (prefix.length > cols.length) return false
  return prefix.every((c, i) => c === cols[i])
}

export function buildCandidates(
  usage: TableColumnUsage,
  existing: ExistingIndex[]
): IndexCandidate[] {
  // equality columns first (join columns are equality predicates), then range,
  // then order/group columns.
  const columns = uniqueInOrder(
    usage.joinColumns,
    usage.equalityColumns,
    usage.rangeColumns,
    usage.orderColumns
  )
  if (columns.length === 0) return []

  // Already covered: an existing index whose leftmost columns equal/contain ours.
  const covered = existing.some((idx) => isPrefix(columns, idx.columns))
  if (covered) return []

  // Collision: an existing index that shares our leftmost column (a single-col
  // index we'd extend into a composite).
  const collision = existing.find((idx) => idx.columns[0] === columns[0]) ?? null

  return [
    {
      table: usage.table,
      columns,
      reason: '', // filled by scorer
      confidence: 'low', // upgraded by scorer
      existingIndexCollision: collision?.name ?? null,
    },
  ]
}
