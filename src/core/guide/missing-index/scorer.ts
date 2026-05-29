// src/core/guide/missing-index/scorer.ts
/**
 * Pure scorer. Assigns confidence + a human reason to a candidate using the
 * real plan facts. Confidence is intentionally conservative — output always
 * carries a reason and never asserts "you must create this".
 */

import type { Confidence, EnrichedPlanFacts, IndexCandidate, TableColumnUsage } from './types'

function isFullScan(facts: EnrichedPlanFacts): boolean {
  if (facts.key === null) return true
  const at = facts.accessType.toLowerCase()
  return at === 'all' || at.includes('seq scan')
}

/** All WHERE + JOIN columns the table needs, deduped. */
function requiredColumns(usage: TableColumnUsage): string[] {
  const set = new Set<string>([
    ...usage.joinColumns,
    ...usage.equalityColumns,
    ...usage.rangeColumns,
  ])
  return [...set]
}

function coversAll(candidate: IndexCandidate, required: string[]): boolean {
  return required.every((c) => candidate.columns.includes(c))
}

export function scoreCandidate(
  candidate: IndexCandidate,
  usage: TableColumnUsage,
  facts: EnrichedPlanFacts | undefined
): IndexCandidate {
  const required = requiredColumns(usage)
  const ref = usage.alias ?? usage.table

  let confidence: Confidence
  let reason: string

  if (!facts) {
    confidence = 'low'
    reason =
      `Heuristic suggestion (no EXPLAIN plan available). Candidate covers ` +
      `${candidate.columns.join(', ')} on ${usage.table} based on parsed WHERE/JOIN/ORDER usage.`
  } else if (isFullScan(facts) && coversAll(candidate, required)) {
    confidence = 'high'
    reason =
      `${ref} currently does a full scan (access_type=${facts.accessType}, ${facts.rows.toLocaleString()} rows). ` +
      `A composite index on (${candidate.columns.join(', ')}) covers all WHERE/JOIN predicates ` +
      `(${required.join(', ')}) and lets the planner seek instead of scan.`
  } else if (candidate.existingIndexCollision) {
    confidence = 'medium'
    reason =
      `${ref} already uses index '${candidate.existingIndexCollision}' (access_type=${facts.accessType}` +
      (facts.filtered !== undefined ? `, filtered≈${facts.filtered}%` : '') +
      `). Extending it to (${candidate.columns.join(', ')}) lets the remaining predicates be satisfied by the index ` +
      `instead of a post-filter pass.`
  } else if (coversAll(candidate, required)) {
    confidence = 'medium'
    reason =
      `${ref} access_type=${facts.accessType} (${facts.rows.toLocaleString()} rows). ` +
      `A composite index on (${candidate.columns.join(', ')}) covers WHERE/JOIN predicates (${required.join(', ')}).`
  } else {
    confidence = 'low'
    reason =
      `${ref} access_type=${facts.accessType}. Candidate (${candidate.columns.join(', ')}) only partially ` +
      `covers the predicates (${required.join(', ')}); verify selectivity before creating.`
  }

  const estimatedRowsReduction =
    facts && facts.filtered !== undefined && facts.filtered < 100
      ? `~${facts.rows.toLocaleString()} scanned → index seek (filtered ${facts.filtered}% → ~100%)`
      : undefined

  return { ...candidate, confidence, reason, estimatedRowsReduction }
}
