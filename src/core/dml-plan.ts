import type { QueryRiskResult } from '@/types/query-risk'
import type { BlacklistConfig } from '@/types/blacklist'
import type { Permission } from '@/types'

export type DmlPlanFormat = 'text' | 'json'

export type DmlPlanIntent =
  | {
      operation: 'insert'
      target: string
      data: Record<string, unknown>
    }
  | {
      operation: 'update'
      target: string
      set: Record<string, unknown>
      where: Record<string, unknown> | null
      rawWhere: string
    }
  | {
      operation: 'delete'
      target: string
      where: Record<string, unknown> | null
      rawWhere: string
    }

export interface NonSqlAnalyzerContext {
  permission: Permission
  blacklist: BlacklistConfig
  schema: Record<string, unknown>
}

export type NonSqlAnalyzer = (
  intent: DmlPlanIntent,
  context: NonSqlAnalyzerContext
) => QueryRiskResult
