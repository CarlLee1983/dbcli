import { ALLOWED_GOALS, type GuideGoalId } from './types'

const GOAL_INTENTS: Record<GuideGoalId, readonly string[]> = {
  'slow-query': ['perf.slow-query', 'safety.locks', 'perf.cache-hit', 'perf.index-usage'],
  capacity: ['capacity.size', 'capacity.memory'],
  health: ['safety.connections', 'safety.locks', 'monitor.cluster-health'],
  'index-usage': ['perf.index-usage'],
  permissions: [],
  'schema-overview': [],
}

const GOAL_DESCRIPTIONS: Record<GuideGoalId, string> = {
  'slow-query':
    'Diagnose slow queries: find long-running statements, blocking locks, cache misses, and missing indexes.',
  capacity: 'Audit storage and memory: database/table sizes plus engine-specific memory pressure.',
  health: 'Snapshot operational health: active connections, lock contention, cluster status.',
  'index-usage': 'Audit index effectiveness and surface missing-index candidates.',
  permissions:
    'Review the active permission level, blacklist coverage, and the available snippet inventory.',
  'schema-overview':
    'Orient yourself in an unfamiliar database: list objects, refresh schema cache when stale.',
}

export function intentsForGoal(goal: GuideGoalId): readonly string[] {
  return GOAL_INTENTS[goal]
}

export function describeGoal(goal: GuideGoalId): string {
  return GOAL_DESCRIPTIONS[goal]
}

export function listGoals(): readonly GuideGoalId[] {
  return ALLOWED_GOALS
}
