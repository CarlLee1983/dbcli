import { t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { PermissionError } from '@/core/permission-guard'
import { QueryResultFormatter } from '@/formatters'
import {
  loadSnippets,
  mapSystemToEngine,
  prepareExecution,
  resolveByName,
  resolveSnippetDirs,
  SavedQueryError,
} from '@/core/saved-queries'

export interface QCommandOptions {
  format?: 'table' | 'json' | 'csv'
  noLimit?: boolean
  dryRun?: boolean
  param?: string[]
  paramFile?: string
  config?: string
}

export async function qCommand(
  name: string,
  options: QCommandOptions,
  command?: import('commander').Command
): Promise<void> {
  try {
    if (!name?.startsWith('@')) {
      throw new Error(`Snippet name must start with '@' (got '${name}')`)
    }
    const configPath = resolveConfigPath(command, options)
    const config = await configModule.read(configPath)
    if (!config.connection) throw new Error('Run "dbcli init" first')

    const engine = mapSystemToEngine(config.connection.system)
    if (engine === 'mongodb') {
      throw new Error('Saved queries do not support MongoDB connections')
    }
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets(dirs)
    const snippet = resolveByName(map, name, engine)

    const cliParams = parseCliParams(options.param ?? [])
    const fileParams = await readParamFile(options.paramFile)

    const prepared = prepareExecution(
      snippet,
      { engine, noLimit: options.noLimit === true },
      cliParams,
      fileParams
    )
    for (const w of prepared.warnings) console.error(`⚠ ${w}`)

    if (options.dryRun) {
      console.log('Dry-run preview (no execution):')
      console.log(prepared.driver.sql)
      console.log('Bind values: ' + JSON.stringify(prepared.driver.values))
      return
    }

    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
    await adapter.connect()
    try {
      const blacklistManager = new BlacklistManager(config)
      const blacklistValidator = new BlacklistValidator(blacklistManager)
      const start = performance.now()
      const result = await adapter.execute<Record<string, unknown>>(
        prepared.driver.sql,
        prepared.driver.values
      )
      const executionTimeMs = Math.round(performance.now() - start)
      const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : []
      const filtered = blacklistValidator.filterColumns('', result.rows, columnNames)

      const formatter = new QueryResultFormatter()
      const out = formatter.format(
        {
          rows: filtered.filteredRows,
          rowCount: filtered.filteredRows.length,
          columnNames: columnNames.filter((c) => !filtered.omittedColumns.includes(c)),
          columnTypes: [],
          executionTimeMs,
          metadata: {
            statement: 'SELECT',
            affectedRows: 0,
            ...(filtered.omittedColumns.length > 0
              ? {
                  securityNotification: blacklistValidator.buildSecurityNotification(
                    '',
                    filtered.omittedColumns
                  ),
                }
              : {}),
          },
        },
        { format: options.format ?? 'table' }
      )
      console.log(out)
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    handleQError(error)
  }
}

function parseCliParams(list: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const item of list) {
    const eq = item.indexOf('=')
    if (eq === -1) throw new Error(`--param must be key=value (got '${item}')`)
    out[item.slice(0, eq)] = item.slice(eq + 1)
  }
  return out
}

async function readParamFile(path: string | undefined): Promise<Record<string, unknown>> {
  if (!path) return {}
  const text = await Bun.file(path).text()
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--param-file must be a JSON object (got ${typeof parsed})`)
  }
  return parsed
}

function handleQError(error: unknown): void {
  if (error instanceof SavedQueryError) {
    console.error(error.message)
    process.exit(1)
  }
  if (error instanceof BlacklistError) {
    console.error(error.message)
    process.exit(1)
  }
  if (error instanceof PermissionError) {
    console.error(t_vars('errors.permission_denied', { required: error.requiredPermission }))
    process.exit(1)
  }
  if (error instanceof ConnectionError) {
    console.error(t_vars('errors.connection_failed', { message: error.message }))
    process.exit(1)
  }
  console.error(t_vars('errors.message', { message: (error as Error).message }))
  process.exit(1)
}
