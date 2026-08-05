import { analyzeQueryRisk } from '@/core/query-risk-analyzer'
import { configModule } from '@/core/config'
import { formatPlanResult } from '@/commands/plan'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import type { DmlPlanFormat, DmlPlanIntent, NonSqlAnalyzerContext } from '@/core/dml-plan'
import { buildDeletePlanSql, buildInsertPlanSql, buildUpdatePlanSql } from '@/core/dml-plan-sql'
import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'
import { analyzeRedisDmlRisk } from '@/core/redis/dml-plan'
import { analyzeElasticsearchDmlRisk } from '@/core/elasticsearch/dml-plan'
import { toSqlDialect } from '@/core/permission-guard'

const ALLOWED_FORMATS = ['text', 'json'] as const
const SQL_SYSTEMS = new Set(['postgresql', 'mysql', 'mariadb'])

export type { DmlPlanFormat } from '@/core/dml-plan'

export interface DmlPlanOptions {
  format?: DmlPlanFormat
  config?: string
}

function buildPlanSqlForIntent(intent: DmlPlanIntent): string {
  if (intent.operation === 'insert') {
    return buildInsertPlanSql(intent.target, intent.data)
  }
  if (intent.operation === 'update') {
    if (!intent.where || Object.keys(intent.where).length === 0) {
      throw new Error('WHERE clause is required for SQL update plan')
    }
    return buildUpdatePlanSql(intent.target, intent.set, intent.where)
  }
  if (!intent.where || Object.keys(intent.where).length === 0) {
    throw new Error('WHERE clause is required for SQL delete plan')
  }
  return buildDeletePlanSql(intent.target, intent.where)
}

export async function runDmlPlanAnalysis(
  intent: DmlPlanIntent,
  options: DmlPlanOptions,
  command?: import('commander').Command
): Promise<void> {
  try {
    const format: DmlPlanFormat = options.format ?? 'text'
    validateFormat(format, ALLOWED_FORMATS, 'plan')

    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) {
      throw new Error('Run "dbcli init" to configure database connection')
    }

    const system = config.connection.system
    const schema = (config.schema ?? {}) as Record<string, unknown>
    const blacklist = config.blacklist ?? { tables: [], columns: {} }

    if (SQL_SYSTEMS.has(system)) {
      const planSql = buildPlanSqlForIntent(intent)
      const schemaTableCount = Object.keys(schema).length
      const result = analyzeQueryRisk({
        sql: planSql,
        permission: config.permission,
        dialect: toSqlDialect(config.connection?.system),
        blacklist,
        schemaLookup: {
          tables: schema as never,
          cacheAvailable: schemaTableCount > 0,
        },
      })
      console.log(formatPlanResult(result, format))
      return
    }

    const context: NonSqlAnalyzerContext = {
      permission: config.permission,
      blacklist,
      schema,
    }

    if (system === 'mongodb') {
      console.log(formatPlanResult(analyzeMongoDmlRisk(intent, context), format))
      return
    }
    if (system === 'redis') {
      console.log(formatPlanResult(analyzeRedisDmlRisk(intent, context), format))
      return
    }
    if (system === 'elasticsearch') {
      console.log(formatPlanResult(analyzeElasticsearchDmlRisk(intent, context), format))
      return
    }

    throw new Error(`--plan does not support connection system "${system}" yet`)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
