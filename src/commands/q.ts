import crypto from 'node:crypto'
import { t, t_vars } from '@/i18n/message-loader'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { parseRedisCommand } from '@/adapters/redis-adapter'
import { redisCommandTargets } from '@/adapters/redis/blacklist-enforcer'
import { BlacklistRejection } from '@/adapters/redis/types'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import { enforcePermission, PermissionError, SQL_DIALECTS } from '@/core/permission-guard'
import { extractTableReferences } from '@/utils/sql-tables'
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
import { trimAppliedLimit } from '@/core/applied-limit'
import { formatCliError, printLocalizedCliError } from '@/utils/cli-error'
import { presentConnectionError } from '@/utils/connection-error-message'
import { engineFamily, type EngineFamily } from '@/core/saved-queries/strategies'
import { assertValidSlowQueryThreshold, attachSlowQueryAdvisory } from '@/core/slow-query-advisory'

export interface DryRunInput {
  family: EngineFamily
  driverSql: string
  values: Array<string | number | boolean | null>
  execHints: { index?: string } | undefined
  /** Row cap dbcli wrapped the snippet in; the SQL fetches one row past it. */
  guardLimit?: number
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
  if (input.guardLimit !== undefined) {
    lines.push(
      `Size guard: capped at ${input.guardLimit} rows; the extra row is fetched only to detect truncation and is discarded. Use --no-limit to remove the cap.`
    )
  }
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
  slowMs?: number
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
    assertValidSlowQueryThreshold(options.slowMs)
    if (!name?.startsWith('@')) {
      throw new Error(`Snippet name must start with '@' (got '${name}')`)
    }
    const configPath = resolveConfigPath(command, options)
    config = await configModule.read(configPath)
    if (!config.connection) throw new Error('Run "dbcli init" first')

    const connectionSystem = config.connection.system
    const engine = mapSystemToEngine(connectionSystem)
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

    const family = engineFamily(engine)
    const sqlDialect = SQL_DIALECTS.find((dialect) => dialect === connectionSystem)

    // Defence in depth (issue #81): until now "q only runs reads" was held up
    // entirely by `validateBody`'s parse-time rule in another module, so q.ts
    // read as if it executed arbitrary SQL unchecked. Every snippet the contract
    // allows still passes — the value is that the guarantee is now provable here.
    //
    // Above the dry-run branch, not below it: a refusal should read the same
    // whether or not the statement was going to run, which is the choice
    // `q-mongo.ts` already documents. And the rewritten SQL, not the driver SQL —
    // the latter is the size guard's wrapper, so classifying it would describe
    // dbcli's wrapping rather than the statement the snippet asked for.
    const classification =
      family === 'sql'
        ? enforcePermission(prepared.rewrittenSql, config.permission, sqlDialect)
        : undefined

    const blacklistManager = new BlacklistManager(config)
    const blacklistValidator = new BlacklistValidator(blacklistManager)
    const redisTokens = family === 'redis' ? parseRedisCommand(prepared.rewrittenSql) : []
    const targets: string[] =
      family === 'sql'
        ? extractTableReferences(prepared.rewrittenSql, {
            ...(sqlDialect ? { dialect: sqlDialect } : {}),
          })
        : family === 'es'
          ? [prepared.execHints?.index ?? '']
          : family === 'redis' && redisTokens.length > 0
            ? redisCommandTargets(redisTokens[0]!, redisTokens.slice(1))
            : []
    const targetName: string = targets[0] ?? ''

    targetNameForAudit = family === 'redis' ? name : targetName || name

    if (family === 'es') {
      blacklistValidator.checkIndexBlacklist('SELECT', targetName)
    } else if ((classification || family === 'redis') && targets.length > 0) {
      blacklistValidator.checkTablesBlacklist(
        classification?.type ?? redisTokens[0] ?? 'READ',
        targets
      )
    }

    if (options.dryRun) {
      console.log(
        formatDryRun({
          family,
          driverSql: prepared.driver.sql,
          values: prepared.driver.values,
          execHints: prepared.execHints,
          ...(prepared.guardLimit !== undefined ? { guardLimit: prepared.guardLimit } : {}),
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

    const adapter = AdapterFactory.createAdapter(config)
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
        family === 'sql' ? prepared.driver.values : indexParams,
        family === 'sql'
          ? { sqlMode: config.permission === 'query-only' ? 'native-read-only' : 'normal' }
          : undefined
      )
      const executionTimeMs = Math.round(performance.now() - start)
      // Trim the guard's one-row lookahead before anything reads the rows, so
      // row counts stay truthful and truncation is reported rather than guessed.
      const limitedResult =
        prepared.guardLimit === undefined
          ? undefined
          : trimAppliedLimit(result.rows, prepared.guardLimit)
      const resultRows = limitedResult?.rows ?? result.rows
      const columnNames = resultRows[0] ? Object.keys(resultRows[0]) : []
      const filtered =
        family === 'redis'
          ? { filteredRows: resultRows, omittedColumns: [] as string[] }
          : family === 'es'
            ? blacklistValidator.filterColumnsForIndexExpression(
                targetName,
                resultRows,
                columnNames
              )
            : blacklistValidator.filterColumnsForTables(targets, resultRows, columnNames)
      const securityNotification =
        family === 'redis' || filtered.omittedColumns.length === 0
          ? undefined
          : blacklistValidator.buildSecurityNotification(targetName, filtered.omittedColumns)

      if (options.ui || options.format === 'html') {
        const html = await generateHtmlReport({
          meta: snippet.query.meta,
          rows: filtered.filteredRows as Record<string, unknown>[],
          ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
          ...(securityNotification ? { securityNotification } : {}),
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
        attachSlowQueryAdvisory(
          {
            rows: filtered.filteredRows,
            rowCount: filtered.filteredRows.length,
            columnNames: columnNames.filter((c) => !filtered.omittedColumns.includes(c)),
            columnTypes: [],
            executionTimeMs,
            metadata: {
              statement: 'SELECT',
              affectedRows: 0,
              ...(securityNotification ? { securityNotification } : {}),
            },
            ...(limitedResult ? { appliedLimit: limitedResult.metadata } : {}),
          },
          { slowMs: options.slowMs, recovery: options.recovery, system: connectionSystem }
        ),
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
            // The verify query is a second statement and needs its own check —
            // the one above covered the snippet body only.
            if (family === 'sql') {
              blacklistValidator.checkTablesBlacklist(
                'SELECT',
                extractTableReferences(verifySpec.query, {
                  ...(sqlDialect ? { dialect: sqlDialect } : {}),
                })
              )
            }
            const verifyResult = await adapter.execute<Record<string, unknown>>(
              verifySpec.query,
              undefined,
              family === 'sql'
                ? { sqlMode: config.permission === 'query-only' ? 'native-read-only' : 'normal' }
                : undefined
            )
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
  const redisBlacklistRejection =
    config?.connection?.system === 'redis' &&
    (error instanceof BlacklistError || error instanceof BlacklistRejection)
  const reportedError = redisBlacklistRejection
    ? new BlacklistError(
        t('errors.redis_target_blacklisted'),
        '[REDACTED]',
        error instanceof BlacklistError ? error.operation : error.command
      )
    : error
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()
  }

  if (config) {
    auditId = await writeAuditEntry(config, 'q', options, {
      success: false,
      target: snippetName,
      error: reportedError,
      ...(envelopeId && { recovery_ref: envelopeId }),
    })
  }

  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(
      reportedError,
      { operation: 'q', snippet: snippetName },
      { envelopeId, auditRef: auditId ?? undefined }
    )
  }

  if (error instanceof SavedQueryError) {
    printLocalizedCliError(error.message, error)
    process.exit(1)
  }
  if (error instanceof BlacklistError || error instanceof BlacklistRejection) {
    printLocalizedCliError((reportedError as Error).message, reportedError as Error)
    process.exit(1)
    return
  }
  if (error instanceof PermissionError) {
    printLocalizedCliError(
      t_vars('errors.permission_denied', { required: error.requiredPermission }),
      error
    )
    process.exit(1)
  }
  if (error instanceof ConnectionError) {
    printLocalizedCliError(formatCliError(presentConnectionError(error)), error)
    process.exit(1)
  }
  printLocalizedCliError(t_vars('errors.message', { message: (error as Error).message }), error)
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
