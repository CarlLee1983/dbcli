import { analyzeQueryRisk } from '@/core/query-risk-analyzer'
import { configModule } from '@/core/config'
import type { QueryRiskResult } from '@/types/query-risk'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'
import { toSqlDialect } from '@/core/permission-guard'

const ALLOWED_FORMATS = ['text', 'json'] as const

type PlanCommandOptions = {
  format?: 'text' | 'json'
  config?: string
}

export async function planCommand(
  sql: string,
  options: PlanCommandOptions,
  command?: import('commander').Command
): Promise<void> {
  let config: DbcliConfig | undefined
  try {
    if (!sql || sql.trim() === '') {
      throw new Error('SQL statement required')
    }

    const format = options.format ?? 'text'
    validateFormat(format, ALLOWED_FORMATS, 'plan')

    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    const schema = config.schema ?? {}
    const schemaTableCount = Object.keys(schema).length
    const result = analyzeQueryRisk({
      sql: sql.trim(),
      permission: config.permission,
      dialect: toSqlDialect(config.connection?.system),
      blacklist: config.blacklist ?? { tables: [], columns: {} },
      schemaLookup: {
        tables: schema as never,
        cacheAvailable: schemaTableCount > 0,
      },
    })

    console.log(formatPlanResult(result, format))

    if (config) {
      await writeAuditEntry(
        config,
        'plan',
        { ...options, plan: true },
        {
          success: true,
          sql,
          target: result.targetTables[0] || '*',
          metadata: {
            decision: result.decision,
            risk_factors: result.riskFactors.map((f) => f.code),
          },
        }
      )
    }
  } catch (error) {
    if (config) {
      await writeAuditEntry(
        config,
        'plan',
        { ...options, plan: true },
        {
          success: false,
          sql,
          error,
        }
      )
    }
    console.error((error as Error).message)
    process.exit(1)
  }
}

export function formatPlanResult(result: QueryRiskResult, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2)
  }

  return formatPlanText(result)
}

function formatPlanText(result: QueryRiskResult): string {
  const lines: string[] = [
    `Decision: ${result.decision}`,
    `Operation: ${result.operation}`,
    `Target tables: ${result.targetTables.length > 0 ? result.targetTables.join(', ') : '(none)'}`,
  ]

  if (result.riskFactors.length > 0) {
    lines.push('', 'Risk factors:')
    for (const factor of result.riskFactors) {
      lines.push(`- ${factor.message}`)
    }
  }

  if (result.recommendations.length > 0) {
    lines.push('', 'Recommendations:')
    for (const recommendation of result.recommendations) {
      lines.push(`- ${recommendation}`)
    }
  }

  return lines.join('\n')
}
