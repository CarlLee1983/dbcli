/** JSON EXPLAIN formatter — emits the array of ExplainPlan verbatim. */

import type { ExplainPlan } from '@/core/explain/types'

export function formatExplainJson(plans: ExplainPlan[]): string {
  return JSON.stringify(plans, null, 2)
}
