import { parseWhereClause } from '@/utils/where-parser'
import type { DmlPlanIntent } from '@/core/dml-plan'

export type ElasticsearchBuildInput =
  | { operation: 'insert'; target: string; data: Record<string, unknown> }
  | {
      operation: 'update'
      target: string
      set: Record<string, unknown>
      rawWhere: string
    }
  | { operation: 'delete'; target: string; rawWhere: string }

function normalizeIndex(target: string): string {
  const trimmed = (target ?? '').trim()
  if (trimmed === '') {
    throw new Error('Elasticsearch index name is required')
  }
  return trimmed
}

function parseEsFilter(rawWhere: string): Record<string, unknown> | null {
  const trimmed = (rawWhere ?? '').trim()
  if (trimmed === '') return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    throw new Error('Elasticsearch --where must be a JSON object or simple key=value expression')
  } catch {
    try {
      return parseWhereClause(trimmed)
    } catch {
      throw new Error(
        'Elasticsearch --where must be a JSON object or simple key=value expression'
      )
    }
  }
}

export function buildElasticsearchDmlPlan(input: ElasticsearchBuildInput): DmlPlanIntent {
  const target = normalizeIndex(input.target)

  if (input.operation === 'insert') {
    return { operation: 'insert', target, data: input.data }
  }

  if (input.operation === 'update') {
    return {
      operation: 'update',
      target,
      set: input.set,
      where: parseEsFilter(input.rawWhere),
      rawWhere: input.rawWhere,
    }
  }

  return {
    operation: 'delete',
    target,
    where: parseEsFilter(input.rawWhere),
    rawWhere: input.rawWhere,
  }
}
