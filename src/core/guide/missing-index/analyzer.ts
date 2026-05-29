// src/core/guide/missing-index/analyzer.ts
/**
 * Orchestrator for missing-index analysis.
 *
 * Pipeline: parseSelect → extract → (enrich ∥ introspect) → buildCandidates →
 * scoreCandidate → collectWarnings. On parse failure we still call enrich (to
 * keep the EXPLAIN heuristic path alive for the user) and return a fallback
 * report with no candidates plus a parser-limit warning.
 */

import type {
  Confidence,
  IndexCandidate,
  MissingIndexDeps,
  MissingIndexReport,
} from './types'
import { buildCandidates } from './candidate-builder'
import { scoreCandidate } from './scorer'
import { collectWarnings } from './warnings'

export interface AnalyzeOptions {
  /** Drop candidates below this confidence. Default: include all. */
  minConfidence?: Confidence
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

export async function analyzeMissingIndex(
  sql: string,
  deps: MissingIndexDeps,
  opts: AnalyzeOptions
): Promise<MissingIndexReport> {
  // 1. Parse — failure switches to fallback mode.
  let ast: unknown
  try {
    ast = deps.parseSelect(sql, deps.system)
  } catch {
    await safeEnrich(deps, sql) // keep heuristic path warm; result intentionally unused for candidates
    return {
      query: sql,
      candidates: [],
      warnings: collectWarnings({ parsed: false, tables: [] }),
    }
  }

  // 2. Extract structured usage.
  const analysis = deps.extract(ast)

  // 3. Enrich + introspect (parallel; both degrade gracefully).
  const [facts, indexLists] = await Promise.all([
    safeEnrich(deps, sql),
    Promise.all(
      analysis.tables.map(async (t) => [t.table, await deps.getExistingIndexes(t.table)] as const)
    ),
  ])
  const indexByTable = new Map(indexLists)

  // 4. Build + score one candidate per table.
  const candidates: IndexCandidate[] = []
  for (const usage of analysis.tables) {
    const existing = indexByTable.get(usage.table) ?? []
    const built = buildCandidates(usage, existing)
    for (const c of built) {
      candidates.push(scoreCandidate(c, usage, facts.get(usage.table)))
    }
  }

  // 5. Confidence filter.
  const min = opts.minConfidence ? RANK[opts.minConfidence] : -1
  const filtered = candidates.filter((c) => RANK[c.confidence] >= min)

  return {
    query: sql,
    candidates: filtered,
    warnings: collectWarnings(analysis),
  }
}

async function safeEnrich(deps: MissingIndexDeps, sql: string) {
  try {
    return await deps.enrich(sql)
  } catch {
    return new Map()
  }
}
