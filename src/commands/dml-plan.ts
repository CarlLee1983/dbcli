import { analyzeQueryRisk } from '@/core/query-risk-analyzer'
import { configModule } from '@/core/config'
import { formatPlanResult } from '@/commands/plan'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['text', 'json'] as const
const SQL_SYSTEMS = new Set(['postgresql', 'mysql', 'mariadb'])

export type DmlPlanFormat = 'text' | 'json'

export interface DmlPlanOptions {
  format?: DmlPlanFormat
  config?: string
}

/**
 * Analyzes a planner-only DML SQL string against the configured connection's
 * permission, blacklist, and schema cache, then prints the result via
 * `formatPlanResult()`. Never connects to a database. Returns normally for
 * any analyzer decision (including BLOCK). Calls `process.exit(1)` on
 * configuration / engine / format errors.
 */
export async function runDmlPlanAnalysis(
  planSql: string,
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

    if (!SQL_SYSTEMS.has(config.connection.system)) {
      throw new Error('--plan for insert/update/delete currently supports SQL connections only')
    }

    const schema = config.schema ?? {}
    const schemaTableCount = Object.keys(schema).length
    const result = analyzeQueryRisk({
      sql: planSql,
      permission: config.permission,
      blacklist: config.blacklist ?? { tables: [], columns: {} },
      schemaLookup: {
        tables: schema as never,
        cacheAvailable: schemaTableCount > 0,
      },
    })

    console.log(formatPlanResult(result, format))
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
