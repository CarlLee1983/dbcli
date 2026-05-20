import crypto from 'node:crypto'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { PermissionError } from '@/core/permission-guard'
import { extractTableName } from '@/utils/engine-hints'
import { QueryResultFormatter } from '@/formatters'
import { generateHtmlReport } from '@/formatters/html-formatter'
import { openInBrowser } from '@/utils/opener'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { DbcliConfig } from '@/utils/validation'
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
import { colors } from '@/utils/colors'
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
  verify?: boolean
  // Open for audit-helper consumption.
  [key: string]: unknown
}

export async function qCommand(
  name: string,
  options: QCommandOptions,
  command?: import('commander').Command
): Promise<void> {
  let config: DbcliConfig | undefined
  let targetNameForAudit: string = name
  try {
    if (!name?.startsWith('@')) {
      throw new Error(`Snippet name must start with '@' (got '${name}')`)
    }
    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
    if (!config.connection) throw new Error('Run "dbcli init" first')

    const engine = mapSystemToEngine(config.connection.system)
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
      await writeAuditEntry(config, 'q', options, {
        success: true,
        target: name,
        sql: prepared.driver.sql,
        metadata: { dry_run: true },
      })
      return
    }

    if (engine === 'mongodb') {
      const { qMongoBranch } = await import('@/commands/q-mongo')
      await qMongoBranch(snippet, prepared, options, config)
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

    targetNameForAudit = targetName || name

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
        await writeAuditEntry(config, 'q', options, {
          success: true,
          target: targetName || name,
          sql: prepared.driver.sql,
          metadata: {
            rows_affected: filtered.filteredRows.length,
            execution_ms: executionTimeMs,
          },
        })
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
      await writeAuditEntry(config, 'q', options, {
        success: true,
        target: targetName || name,
        sql: prepared.driver.sql,
        metadata: {
          rows_affected: filtered.filteredRows.length,
          execution_ms: executionTimeMs,
        },
      })

      if (options.verify) {
        console.error('')
        console.error(colors.info('🔍 Running query verification check...'))
        const verifySpec = snippet.query.meta.verify
        if (!verifySpec) {
          console.error(
            colors.warn('⚠ Warning: No verification check defined in snippet frontmatter.')
          )
        } else {
          try {
            console.error(colors.dim(`Executing verification query: ${verifySpec.query}`))
            const verifyResult = await adapter.execute<Record<string, unknown>>(verifySpec.query)
            const firstRow = verifyResult.rows[0]
            const evalResult = evaluateExpectation(firstRow, verifySpec.expects)

            if (evalResult.success) {
              console.log(colors.success(`✓ Verification passed: ${verifySpec.expects}`))
            } else {
              console.error(colors.error(`✗ Verification failed: ${evalResult.error}`))
              process.exit(1)
            }
          } catch (e) {
            console.error(colors.error(`✗ Verification query failed: ${(e as Error).message}`))
            process.exit(1)
          }
        }
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    await handleQError(error, targetNameForAudit, options, config)
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
  options: QCommandOptions,
  config: DbcliConfig | undefined
): Promise<void> {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()
  }

  if (config) {
    auditId = await writeAuditEntry(config, 'q', options, {
      success: false,
      target: snippetName,
      error,
      ...(envelopeId && { recovery_ref: envelopeId }),
    })
  }

  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(
      error,
      { operation: 'q', snippet: snippetName },
      { envelopeId, auditRef: auditId ?? undefined }
    )
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

export function evaluateExpectation(
  row: Record<string, unknown> | undefined,
  expects: string
): { success: boolean; error?: string } {
  if (!row) {
    return { success: false, error: 'No rows returned in verification query' }
  }

  const match = expects.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(==?|!=|>=?|<=?)\s*(.+?)\s*$/)
  if (!match) {
    return { success: false, error: `Invalid expects format: '${expects}'` }
  }

  const lhs = match[1]
  const op = match[2]
  const rhsRaw = match[3]
  if (lhs === undefined || op === undefined || rhsRaw === undefined) {
    return { success: false, error: `Invalid expects format: '${expects}'` }
  }

  if (!(lhs in row)) {
    return { success: false, error: `Column '${lhs}' not found in verification result` }
  }

  const valRaw = row[lhs]

  let rhs: string | number | boolean | null
  const rhsTrimmed = rhsRaw.trim()
  if (rhsTrimmed === 'null') {
    rhs = null
  } else if (rhsTrimmed === 'true') {
    rhs = true
  } else if (rhsTrimmed === 'false') {
    rhs = false
  } else if (/^-?\d+(\.\d+)?$/.test(rhsTrimmed)) {
    rhs = Number(rhsTrimmed)
  } else {
    const quoteMatch = rhsTrimmed.match(/^['"](.*)['"]$/)
    rhs = quoteMatch ? (quoteMatch[1] ?? '') : rhsTrimmed
  }

  if (rhs === null) {
    const isNull = valRaw === null || valRaw === undefined
    if (op === '=' || op === '==') {
      return { success: isNull }
    }
    if (op === '!=') {
      return { success: !isNull }
    }
    return { success: false, error: `Operator '${op}' is not supported for null comparisons` }
  }

  let val: unknown = valRaw
  if (typeof rhs === 'number') {
    val = Number(valRaw)
  } else if (typeof rhs === 'boolean') {
    val = valRaw === 'true' || valRaw === true || valRaw === 1 || valRaw === '1'
  } else {
    val = String(valRaw)
  }

  let success = false
  switch (op) {
    case '=':
    case '==':
      success = val === rhs
      break
    case '!=':
      success = val !== rhs
      break
    case '>':
      if (typeof val === 'number' && typeof rhs === 'number') {
        success = val > rhs
      } else {
        success = String(val) > String(rhs)
      }
      break
    case '>=':
      if (typeof val === 'number' && typeof rhs === 'number') {
        success = val >= rhs
      } else {
        success = String(val) >= String(rhs)
      }
      break
    case '<':
      if (typeof val === 'number' && typeof rhs === 'number') {
        success = val < rhs
      } else {
        success = String(val) < String(rhs)
      }
      break
    case '<=':
      if (typeof val === 'number' && typeof rhs === 'number') {
        success = val <= rhs
      } else {
        success = String(val) <= String(rhs)
      }
      break
    default:
      return { success: false, error: `Unsupported operator: ${op}` }
  }

  if (!success) {
    return { success: false, error: `Expected '${lhs}' (${val}) ${op} '${rhs}', but it failed` }
  }

  return { success: true }
}
