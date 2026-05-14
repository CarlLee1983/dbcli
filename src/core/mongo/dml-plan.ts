import { parseWhereClause } from '@/utils/where-parser'
import type { DmlPlanIntent } from '@/core/dml-plan'

export type MongoBuildInput =
  | { operation: 'insert'; target: string; data: Record<string, unknown> }
  | {
      operation: 'update'
      target: string
      set: Record<string, unknown>
      rawWhere: string
    }
  | { operation: 'delete'; target: string; rawWhere: string }

function normalizeCollection(target: string): string {
  const trimmed = (target ?? '').trim()
  if (trimmed === '') {
    throw new Error('MongoDB collection name is required')
  }
  return trimmed
}

function parseMongoFilter(rawWhere: string): Record<string, unknown> {
  const trimmed = (rawWhere ?? '').trim()
  if (trimmed === '') return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('MongoDB --where must be a JSON object or simple key=value expression')
  } catch {
    try {
      return parseWhereClause(trimmed)
    } catch {
      throw new Error('MongoDB --where must be a JSON object or simple key=value expression')
    }
  }
}

export function buildMongoDmlPlan(input: MongoBuildInput): DmlPlanIntent {
  const target = normalizeCollection(input.target)

  if (input.operation === 'insert') {
    return { operation: 'insert', target, data: input.data }
  }

  if (input.operation === 'update') {
    const where = parseMongoFilter(input.rawWhere)
    return {
      operation: 'update',
      target,
      set: input.set,
      where,
      rawWhere: input.rawWhere,
    }
  }

  const where = parseMongoFilter(input.rawWhere)
  return { operation: 'delete', target, where, rawWhere: input.rawWhere }
}
