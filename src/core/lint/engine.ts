import type { SqlDatabaseSystem } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { ParseFailure, parseSingleStatement } from '@/core/lint/parse'
import { distinctGroupbyAbuseRule } from '@/core/lint/rules/distinct-groupby-abuse'
import { implicitCastRule } from '@/core/lint/rules/implicit-cast'
import { missingLimitOffsetRule } from '@/core/lint/rules/missing-limit-offset'
import { nonSargableWhereRule } from '@/core/lint/rules/non-sargable-where'
import { notInNullableRule } from '@/core/lint/rules/not-in-nullable'
import { orToUnionRule } from '@/core/lint/rules/or-to-union'
import { selectStarRule } from '@/core/lint/rules/select-star'
import { subqueryToJoinRule } from '@/core/lint/rules/subquery-to-join'
import { unanchoredLikeRule } from '@/core/lint/rules/unanchored-like'
import {
  escapeDoubleQuotedShellArgument,
  explainWith,
  type LintReport,
  type LintRule,
  type LintSeverity,
  type SchemaContext,
} from '@/core/lint/types'

export const ALL_RULES: LintRule[] = [
  selectStarRule,
  unanchoredLikeRule,
  missingLimitOffsetRule,
  nonSargableWhereRule,
  orToUnionRule,
  subqueryToJoinRule,
  distinctGroupbyAbuseRule,
  implicitCastRule,
  notInNullableRule,
]

const SEVERITY_RANK: Record<LintSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
}

export interface LintSqlOptions {
  system: SqlDatabaseSystem
  schema?: SchemaContext
  minSeverity?: LintSeverity
  noSchema?: boolean
}

export function lintSql(sql: string, opts: LintSqlOptions, label?: string): LintReport {
  const escapedSql = escapeDoubleQuotedShellArgument(sql)
  const base: LintReport = {
    sql,
    ...(label === undefined ? {} : { label }),
    dialect: opts.system,
    findings: [],
    skippedRules: [],
    relatedCommands: [
      `dbcli guide missing-index-for "${escapedSql}"`,
      explainWith(sql, opts.system),
    ],
  }

  let ast
  try {
    ast = parseSingleStatement(sql, opts.system)
  } catch (error) {
    if (error instanceof ParseFailure) {
      return {
        ...base,
        parseError: error.message,
        skippedRules: ALL_RULES.map((rule) => ({
          rule: rule.name,
          reason: 'blocked: parse failed',
        })),
      }
    }
    throw error
  }

  const schema = opts.noSchema
    ? buildSchemaContext(undefined)
    : (opts.schema ?? buildSchemaContext(undefined))
  const context = { system: opts.system, sql, ast, schema }
  const minimumSeverity = SEVERITY_RANK[opts.minSeverity ?? 'info']
  const findings: LintReport['findings'] = []
  const skippedRules: LintReport['skippedRules'] = []

  for (const rule of ALL_RULES) {
    if (!schema.available && (rule.requiresSchema || rule.usesOptionalSchema)) {
      skippedRules.push({
        rule: rule.name,
        reason: opts.noSchema
          ? 'blocked: --no-schema'
          : 'blocked: schema cache unavailable (run dbcli schema)',
      })
      if (rule.requiresSchema) continue
    }

    findings.push(
      ...rule.check(context).filter((finding) => SEVERITY_RANK[finding.severity] >= minimumSeverity)
    )
  }

  return { ...base, findings, skippedRules }
}
