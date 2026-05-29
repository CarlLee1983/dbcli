// src/core/guide/missing-index/explain-enricher.ts
/**
 * EXPLAIN enrichment. Runs the real query through P2's explain runner and
 * collapses the per-row plan into table → planner facts (first row per table
 * wins — that's the outermost / driving access for that relation). Failures are
 * swallowed into an empty map so the analyzer can still emit heuristic
 * candidates with downgraded confidence.
 */

import type { DatabaseAdapter, SqlDatabaseSystem } from '@/adapters/types'
import { runQueryExplain } from '@/core/explain/runner'
import type { ExplainPlan } from '@/core/explain/types'
import type { EnrichedPlanFacts } from './types'

type RunExplain = typeof runQueryExplain

export function makeExplainEnricher(
  system: SqlDatabaseSystem,
  adapter: DatabaseAdapter,
  runExplain: RunExplain = runQueryExplain
): (sql: string) => Promise<Map<string, EnrichedPlanFacts>> {
  return async (sql: string): Promise<Map<string, EnrichedPlanFacts>> => {
    const facts = new Map<string, EnrichedPlanFacts>()
    let plan: ExplainPlan
    try {
      plan = await runExplain(system, adapter, sql, { analyze: false })
    } catch {
      return facts
    }
    for (const row of plan.rows) {
      if (!row.driving || facts.has(row.driving)) continue
      facts.set(row.driving, {
        accessType: row.accessType,
        key: row.key,
        rows: row.rows,
        filtered: row.filtered,
      })
    }
    return facts
  }
}
