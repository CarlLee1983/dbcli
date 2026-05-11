import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { PermissionError } from '@/core/permission-guard'
import { extractTableName } from '@/core/query-executor'
import { QueryResultFormatter } from '@/formatters'
import { generateHtmlReport } from '@/formatters/html-formatter'
import { openInBrowser } from '@/utils/opener'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSnippets,
  mapSystemToEngine,
  prepareExecution,
  resolveByName,
  resolveSnippetDirs,
  SavedQueryError,
} from '@/core/saved-queries'
import { engineFamily, type EngineFamily } from '@/core/saved-queries/strategies'

export interface DryRunInput {
  family: EngineFamily
  driverSql: string
  values: Array<string | number | boolean | null>
  execHints: { index?: string } | undefined
}

export function formatDryRun(input: DryRunInput): string {
  const lines: string[] = ['Dry-run preview (no execution):']
  if (input.family === 'es') {
    if (input.execHints?.index) lines.push(`Index: ${input.execHints.index}`)
    try {
      lines.push(JSON.stringify(JSON.parse(input.driverSql), null, 2))
    } catch {
      lines.push(input.driverSql)
    }
    return lines.join('\n')
  }
  if (input.family === 'redis') {
    lines.push(input.driverSql)
    return lines.join('\n')
  }
  lines.push(input.driverSql)
  lines.push('Bind values: ' + JSON.stringify(input.values))
  return lines.join('\n')
}

export interface QCommandOptions {
  format?: 'table' | 'json' | 'csv' | 'html'
  ui?: boolean
  noLimit?: boolean
  dryRun?: boolean
  param?: string[]
  paramFile?: string
  config?: string
  recovery?: boolean
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
      throw new SavedQueryError(
        `Saved queries do not support MongoDB connections`,
        'ENGINE_MISMATCH'
      )
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
    if (prepared.warnings.length > 0) console.error('')

    if (options.dryRun) {
      console.log(
        formatDryRun({
          family: engineFamily(engine),
          driverSql: prepared.driver.sql,
          values: prepared.driver.values,
          execHints: prepared.execHints,
        })
      )
      return
    }

    const blacklistManager = new BlacklistManager(config)
    const blacklistValidator = new BlacklistValidator(blacklistManager)
    const family = engineFamily(engine)
    const targetName: string =
      family === 'sql'
        ? (extractTableName(prepared.rewrittenSql) ?? '')
        : family === 'es'
          ? (prepared.execHints?.index ?? '')
          : ''

    if (family !== 'redis' && targetName) {
      blacklistValidator.checkTableBlacklist('SELECT', targetName)
    }

    const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
    await adapter.connect()
    try {
      if (!options.ui && options.format !== 'html') {
        console.error(t('query.executing'))
      }
      const indexParams =
        family === 'es' && prepared.execHints?.index ? [prepared.execHints.index] : []
      const start = performance.now()
      const result = await adapter.execute<Record<string, unknown>>(
        prepared.driver.sql,
        family === 'sql' ? prepared.driver.values : indexParams
      )
      const executionTimeMs = Math.round(performance.now() - start)
      const columnNames = result.rows[0] ? Object.keys(result.rows[0]) : []
      const filtered =
        family === 'redis'
          ? { filteredRows: result.rows, omittedColumns: [] as string[] }
          : blacklistValidator.filterColumns(targetName, result.rows, columnNames)

      if (options.ui || options.format === 'html') {
        const html = await generateHtmlReport({
          meta: snippet.query.meta,
          rows: filtered.filteredRows as Record<string, unknown>[],
        })

        if (options.ui) {
          const tempPath = join(tmpdir(), `dbcli-report-${Date.now()}.html`)
          await Bun.write(tempPath, html)
          await openInBrowser(tempPath)
        } else {
          console.log(html)
        }
        return
      }

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
                    targetName,
                    filtered.omittedColumns
                  ),
                }
              : {}),
          },
        },
        { format: (options.format as any) ?? 'table' }
      )
      console.log(out)
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    await handleQError(error, name, options.recovery === true)
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

async function handleQError(
  error: unknown,
  snippetName: string,
  useRecovery: boolean
): Promise<void> {
  if (useRecovery) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(error, {
      operation: 'q',
      snippet: snippetName,
    })
  }

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
