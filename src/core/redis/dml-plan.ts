import type { DmlPlanIntent } from '@/core/dml-plan'

export type RedisBuildInput =
  | { operation: 'insert'; target: string; data: Record<string, unknown> }
  | { operation: 'update'; target: string; set: Record<string, unknown>; rawWhere: string }
  | { operation: 'delete'; target: string; rawWhere: string }

function normalizeKey(target: string): string {
  const trimmed = (target ?? '').trim()
  if (trimmed === '') {
    throw new Error('Redis key is required as the positional <target>')
  }
  return trimmed
}

export function buildRedisDmlPlan(input: RedisBuildInput): DmlPlanIntent {
  const target = normalizeKey(input.target)

  if (input.operation === 'insert') {
    return { operation: 'insert', target, data: input.data }
  }

  if (input.operation === 'update') {
    return {
      operation: 'update',
      target,
      set: input.set,
      where: null,
      rawWhere: input.rawWhere,
    }
  }

  return { operation: 'delete', target, where: null, rawWhere: input.rawWhere }
}
