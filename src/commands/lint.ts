/**
 * `dbcli lint` — static, schema-aware SQL anti-pattern advisor.
 *
 * This command never creates a database adapter or connects to a database.
 * Schema facts come only from the layered cache under `.dbcli/schemas/`.
 */
import { Command } from 'commander'
import {
  attachCommandEvidenceReceipt,
  finalizeCommandEvidenceReceipt,
} from '@/commands/command-evidence-receipt'
import { configModule, getSchemaIsolationConnectionName } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { resolveBulkInputs } from '@/core/explain/bulk-runner'
import { lintSql, type LintSqlOptions } from '@/core/lint/engine'
import { buildSchemaContext, loadSchemaContext } from '@/core/lint/context'
import type { LintReport, LintSeverity, SchemaContext } from '@/core/lint/types'
import { loadSnippets, resolveSnippetDirs } from '@/core/saved-queries'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { AuditOutcome } from '@/core/audit/integration-helper'
import type { EmitOptions } from '@/core/recovery/emit'
import type { RecoveryContext } from '@/core/recovery/types'
import { formatLint, type LintFormat } from '@/formatters/lint'
import { resolveConfigPath } from '@/utils/config-path'
import type { DbcliConfig } from '@/utils/validation'
import type { SqlDatabaseSystem } from '@/adapters/types'

const FORMATS = ['text', 'json', 'markdown'] as const satisfies readonly LintFormat[]
const SEVERITIES = ['info', 'warn', 'error'] as const satisfies readonly LintSeverity[]
const SQL_SYSTEMS = ['postgresql', 'mysql', 'mariadb'] as const

export interface LintCommandOptions {
  format?: string
  minSeverity?: string
  noSchema?: boolean
  bulk?: string
  recovery?: boolean
}

interface CommanderLintOptions extends Omit<LintCommandOptions, 'noSchema'> {
  /** Commander represents the negated `--no-schema` option as `schema=false`. */
  schema?: boolean
  noSchema?: boolean
}

type SavedQueryLoader = (nameOrGlob: string) => Promise<{ name: string; sql: string }[] | null>

interface LintDeps {
  config: DbcliConfig
  schema: SchemaContext
  loadSavedQuery: SavedQueryLoader
}

export interface LintCommandLoaders {
  readConfig: (configPath: string) => Promise<DbcliConfig>
  resolveStoragePath: (configPath: string) => Promise<string>
  resolveConnectionName: (configPath: string) => Promise<string | undefined>
  loadSchema: (storagePath: string, connectionName?: string) => Promise<SchemaContext>
}

function assertSqlSystem(config: DbcliConfig): SqlDatabaseSystem {
  const system = config.connection?.system
  if (!SQL_SYSTEMS.includes(system as (typeof SQL_SYSTEMS)[number])) {
    throw new Error(
      `dbcli lint requires a SQL connection (postgresql/mysql/mariadb), got: ${system ?? 'none'}`
    )
  }
  return system as SqlDatabaseSystem
}

const defaultLoaders: LintCommandLoaders = {
  readConfig: (configPath) =>
    configModule.read(configPath, undefined, { loadLayeredSchema: false }),
  resolveStoragePath: resolveConfigStoragePath,
  resolveConnectionName: getSchemaIsolationConnectionName,
  loadSchema: loadSchemaContext,
}

/**
 * Load the command's static dependencies in a deliberately strict order:
 * config → SQL-system validation → optional layered schema cache.
 */
export async function loadLintCommandDeps(
  configPath: string,
  options: LintCommandOptions,
  loaders: LintCommandLoaders = defaultLoaders,
  onConfigLoaded?: (config: DbcliConfig) => void
): Promise<Pick<LintDeps, 'config' | 'schema'>> {
  const config = await loaders.readConfig(configPath)
  onConfigLoaded?.(config)
  assertSqlSystem(config)

  if (options.noSchema === true) {
    return { config, schema: buildSchemaContext(undefined) }
  }

  const storagePath = await loaders.resolveStoragePath(configPath)
  const connectionName = await loaders.resolveConnectionName(configPath)
  const schema = await loaders.loadSchema(storagePath, connectionName)
  return { config, schema }
}

export async function runLint(
  queries: string[],
  options: LintCommandOptions,
  deps: LintDeps
): Promise<{ reports: LintReport[]; output: string }> {
  const format = (options.format ?? 'text') as LintFormat
  if (!FORMATS.includes(format)) {
    throw new Error(`Unknown format '${format}'. Allowed: ${FORMATS.join(', ')}`)
  }

  const minSeverity = (options.minSeverity ?? 'info') as LintSeverity
  if (!SEVERITIES.includes(minSeverity)) {
    throw new Error(`Unknown --min-severity '${minSeverity}'. Allowed: ${SEVERITIES.join(', ')}`)
  }

  const system = assertSqlSystem(deps.config)
  const rawInputs =
    options.bulk === undefined
      ? queries
      : options.bulk
          .split(',')
          .map((input) => input.trim())
          .filter(Boolean)
  const inputs = await resolveBulkInputs(rawInputs, {
    loadFromSavedQueries: deps.loadSavedQuery,
  })
  if (inputs.length === 0) {
    throw new Error('No query provided. Pass a SQL string, @saved-query, or --bulk @file.sql.')
  }

  const lintOptions: LintSqlOptions = {
    system,
    schema: deps.schema,
    minSeverity,
    noSchema: options.noSchema === true,
  }
  const reports = inputs.map((input) => lintSql(input.sql, lintOptions, input.label))
  return { reports, output: formatLint(reports, format) }
}

type AuditWriter = (
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
) => Promise<string | null>

export interface ExecuteLintRuntime {
  loadDeps: (
    configPath: string,
    options: LintCommandOptions,
    onConfigLoaded?: (config: DbcliConfig) => void
  ) => Promise<Pick<LintDeps, 'config' | 'schema'>>
  loadSavedQuery: SavedQueryLoader
  writeAudit: AuditWriter
  randomUUID: () => string
  beforeRecovery?: (config: DbcliConfig | undefined, auditRef: string | null) => Promise<void>
  emitRecovery?: (error: unknown, context: RecoveryContext, options: EmitOptions) => Promise<void>
}

const defaultExecuteRuntime: ExecuteLintRuntime = {
  loadDeps: (configPath, options, onConfigLoaded) =>
    loadLintCommandDeps(configPath, options, defaultLoaders, onConfigLoaded),
  loadSavedQuery: makeSavedQueryLoader(),
  writeAudit: writeAuditEntry,
  randomUUID: () => crypto.randomUUID(),
}

export async function executeLintCommand(
  queries: string[],
  options: LintCommandOptions,
  configPath: string,
  runtimeOverrides: Partial<ExecuteLintRuntime> = {}
): Promise<{ reports: LintReport[]; output: string }> {
  const runtime = { ...defaultExecuteRuntime, ...runtimeOverrides }
  let config: DbcliConfig | undefined

  try {
    const loaded = await runtime.loadDeps(configPath, options, (loadedConfig) => {
      config = loadedConfig
    })
    config = loaded.config
    const result = await runLint(queries, options, {
      ...loaded,
      loadSavedQuery: runtime.loadSavedQuery,
    })
    await runtime.writeAudit(
      config,
      'lint',
      { ...options, config: configPath },
      {
        success: true,
        target: '*',
        metadata: {
          queries: result.reports.length,
          findings: result.reports.reduce((total, report) => total + report.findings.length, 0),
        },
      }
    )
    return result
  } catch (error) {
    const envelopeId = options.recovery === true ? runtime.randomUUID() : undefined
    let auditId: string | null = null
    if (config) {
      auditId = await runtime.writeAudit(
        config,
        'lint',
        { ...options, config: configPath },
        {
          success: false,
          target: '*',
          error,
          ...(envelopeId && { recovery_ref: envelopeId }),
        }
      )
    }

    if (envelopeId !== undefined) {
      await runtime.beforeRecovery?.(config, auditId)
      const context: RecoveryContext = {
        operation: 'lint',
        system: config?.connection.system ?? null,
      }
      const emitRecovery =
        runtime.emitRecovery ??
        (async (recoveryError, recoveryContext, emitOptions) => {
          const { emitRecoveryEnvelope } = await import('@/core/recovery')
          emitRecoveryEnvelope(recoveryError, recoveryContext, emitOptions)
        })
      await emitRecovery(error, context, {
        envelopeId,
        auditRef: auditId ?? undefined,
      })
    }
    throw error
  }
}

export function normalizeLintCommandOptions(options: CommanderLintOptions): LintCommandOptions {
  const { schema, ...rest } = options
  return {
    ...rest,
    noSchema: rest.noSchema === true || schema === false,
  }
}

function makeSavedQueryLoader(): SavedQueryLoader {
  return async (nameOrGlob) => {
    const snippetMap = await loadSnippets(resolveSnippetDirs(process.cwd()))
    const stripAt = (key: string) => key.replace(/^@/, '')

    if (nameOrGlob.includes('*')) {
      const regex = new RegExp(
        '^' + nameOrGlob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      )
      const entries: { name: string; sql: string }[] = []
      for (const [key, snippets] of snippetMap) {
        const name = stripAt(key)
        if (!regex.test(name)) continue
        const sql = snippets[0]?.query?.sqlBody ?? ''
        if (sql) entries.push({ name, sql })
      }
      return entries.length > 0 ? entries : null
    }

    const direct = snippetMap.get(nameOrGlob) ?? snippetMap.get(`@${nameOrGlob}`)
    const sql = direct?.[0]?.query?.sqlBody
    return sql ? [{ name: nameOrGlob, sql }] : null
  }
}

interface LintCommandActionDeps {
  execute: typeof executeLintCommand
  writeOutput: (output: string) => void
  writeError: (error: string) => void
  exit: (code: number) => void
}

const defaultActionDeps: LintCommandActionDeps = {
  execute: executeLintCommand,
  writeOutput: (output) => console.log(output),
  writeError: (error) => console.error(error),
  exit: (code) => process.exit(code),
}

export function createLintCommand(actionOverrides: Partial<LintCommandActionDeps> = {}): Command {
  const actionDeps = { ...defaultActionDeps, ...actionOverrides }
  return new Command()
    .name('lint')
    .description('Static SQL anti-pattern advisor with rewrite drafts (no DB connection)')
    .argument('[queries...]', 'one or more SQL strings or @saved-query/@file references')
    .option('--format <fmt>', `output format: ${FORMATS.join(' | ')}`, 'text')
    .option('--min-severity <level>', `drop findings below: ${SEVERITIES.join(' | ')}`, 'info')
    .option('--no-schema', 'skip schema-aware rules even when the cache exists')
    .option('--bulk <input>', 'comma-separated list of @file / @glob / @saved-query inputs')
    .option('--recovery', 'on failure, emit a structured recovery envelope')
    .action(async (queries: string[], rawOptions: CommanderLintOptions, command: Command) => {
      const configPath = resolveConfigPath(command)
      const options = normalizeLintCommandOptions(rawOptions)

      try {
        const { output } = await actionDeps.execute(queries, options, configPath, {
          beforeRecovery: (config, auditRef) =>
            finalizeCommandEvidenceReceipt(command, 'lint', 'failed', config, auditRef),
        })
        actionDeps.writeOutput(output)
      } catch (error) {
        actionDeps.writeError((error as Error).message)
        await finalizeCommandEvidenceReceipt(command, 'lint', 'failed')
        actionDeps.exit(1)
      }
    })
}

export const lintCommand = createLintCommand()

attachCommandEvidenceReceipt(lintCommand, 'lint')
