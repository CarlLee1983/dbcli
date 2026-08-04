import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { configModule } from '@/core/config'
import { AdapterFactory, type ConnectionOptions, type SqlConnectionOptions } from '@/adapters'
import type { ConnectionConfig } from '@/types'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}
import { getLogger } from '@/utils/logger'
import { checkDbVersion, type VersionCheckResult } from '@/utils/db-version-check'
import { t_vars } from '@/i18n/message-loader'
import { validateFormat, DbcliConfigV2Schema } from '@/utils/validation'
import { detectConfigVersion } from '@/core/config-v2'
import { resolveConfigPath } from '@/utils/config-path'
import { resolveConfigStoragePath } from '@/core/config-binding'
import pkg from '../../package.json'
import { join } from 'path'
import { resolveSchemaPath } from '@/utils/schema-path'
import { collectRuntimeInfo, type RuntimeInfo } from '@/utils/runtime-info'
import { getSchemaIsolationConnectionName } from '@/core/config'
import { resolveSrv } from 'node:dns/promises'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import { shellQuote } from '@/core/recovery/shell-quote'

const ALLOWED_FORMATS = ['text', 'json'] as const

/**
 * Mongo only: renders a one-line summary of how the cached schema was sampled.
 * Returns '' for SQL/legacy caches that lack sampleMethod, so callers can guard with truthiness.
 */
export function renderMongoSamplingLine(meta: {
  sampleMethod?: string
  sampleSize?: number
}): string {
  if (!meta.sampleMethod) return ''
  return `    sampled: method=${meta.sampleMethod}, size=${meta.sampleSize ?? '?'}`
}

export interface DoctorResult {
  group: string
  label: string
  status: 'pass' | 'warn' | 'error'
  message: string
  details?: Record<string, unknown>
  remediation?: {
    command: string
    risk: 'interactive' | 'readonly' | 'local-write'
  }
}

export interface DoctorRemediationStep {
  kind: 'blacklist-candidate' | 'schema-refresh' | 'bounded-sample'
  status: 'candidate'
  rationale: string
  dryRun: string
  apply?: string
  requiresHumanConfirmation: true
}

type LargeTableTarget = 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'elasticsearch'

function safeSqlIdentifier(value: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(value) ? value : null
}

function boundedSampleCommands(
  system: LargeTableTarget,
  table: string
): { dryRun: string; apply?: string } {
  if (system === 'mongodb') {
    const collection = shellQuote(table)
    const query = shellQuote('{}')
    return {
      dryRun: `dbcli schema ${collection} --format json`,
      apply: `dbcli query ${query} --collection ${collection} --limit 100 --format json`,
    }
  }

  if (system === 'elasticsearch') {
    const index = shellQuote(table)
    const query = shellQuote('{"query":{"match_all":{}}}')
    return {
      dryRun: `dbcli schema ${index} --format json`,
      apply: `dbcli query ${query} --collection ${index} --limit 100 --format json`,
    }
  }

  const identifier = safeSqlIdentifier(table)
  if (!identifier) {
    return {
      dryRun: `dbcli schema ${shellQuote(table)} --format json`,
    }
  }

  const sql = `SELECT * FROM ${identifier} LIMIT 100`
  const command = shellQuote(sql)
  return {
    dryRun: `dbcli plan ${command} --format json`,
    apply: `dbcli query ${command} --format json`,
  }
}

/**
 * Turn diagnostic warnings into an explicitly non-mutating workflow.  The
 * commands are candidates only: doctor never changes a blacklist, refreshes a
 * cache, or reads sample rows on the user's behalf.
 */
export function buildDoctorRemediationPlan(results: DoctorResult[]): DoctorRemediationStep[] {
  const steps: DoctorRemediationStep[] = []
  for (const result of results) {
    if (result.label === 'Blacklist completeness' && result.status === 'warn') {
      const prefix = 'Consider protecting: '
      const candidates = result.message.startsWith(prefix)
        ? result.message.slice(prefix.length).split(', ').filter(Boolean)
        : []
      for (const candidate of candidates) {
        const [table, column] = candidate.split('.')
        if (!table || !column) continue
        steps.push({
          kind: 'blacklist-candidate',
          status: 'candidate',
          rationale: `Sensitive-looking column '${candidate}' is not currently protected.`,
          dryRun: `dbcli schema ${shellQuote(table)} --format json`,
          apply: `dbcli blacklist column add ${shellQuote(candidate)}`,
          requiresHumanConfirmation: true,
        })
      }
    }
    if (result.label === 'Schema cache' && result.status === 'warn') {
      steps.push({
        kind: 'schema-refresh',
        status: 'candidate',
        rationale: result.message,
        dryRun: 'dbcli schema --format json',
        apply: 'dbcli schema --refresh',
        requiresHumanConfirmation: true,
      })
    }
    if (result.label === 'Large tables' && result.status === 'warn') {
      const target = (result.details?.system as LargeTableTarget | undefined) ?? 'postgresql'
      const tables = Array.isArray(result.details?.largeTables)
        ? result.details.largeTables.filter(
            (table): table is { name: string; estimatedRowCount?: number } =>
              typeof table === 'object' &&
              table !== null &&
              typeof (table as { name?: unknown }).name === 'string'
          )
        : []
      const candidates =
        tables.length > 0
          ? tables
          : result.message
              .replace(/^Large tables:\s*/, '')
              .split(/,\s+(?=[^,]+\s+\([\d.]+M rows\))/)
              .map((entry) => ({ name: entry.replace(/\s+\([\d.]+M rows\)$/, '') }))

      for (const table of candidates) {
        const commands = boundedSampleCommands(target, table.name)
        steps.push({
          kind: 'bounded-sample',
          status: 'candidate',
          rationale: `${table.name} is large. Review a bounded sample only after confirming blacklist coverage.${
            commands.apply
              ? ''
              : ' The identifier needs manual review before a sample query can be generated safely.'
          }`,
          ...commands,
          requiresHumanConfirmation: true,
        })
      }
    }
  }
  return steps
}

const SENSITIVE_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'access_key',
  'private_key',
  'credential',
  'auth_token',
  'refresh_token',
  'session_token',
  'ssn',
  'credit_card',
]

type MongoSrvLookupDeps = {
  resolveSrvFn?: typeof resolveSrv
  fetchFn?: typeof fetch
}

/** Layered index uses metadata.lastRefreshed; schema --refresh sets config.metadata.schemaLastUpdated */
export function resolveSchemaLastUpdated(
  indexJson: unknown,
  configMetadata: { schemaLastUpdated?: string } | undefined
): string | null {
  if (indexJson && typeof indexJson === 'object') {
    const idx = indexJson as {
      updatedAt?: string
      metadata?: { lastRefreshed?: string }
    }
    const fromIndex = idx.metadata?.lastRefreshed ?? idx.updatedAt
    if (fromIndex) return fromIndex
  }
  return configMetadata?.schemaLastUpdated ?? null
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export const runDoctorChecks = {
  checkRuntime(info: RuntimeInfo): DoctorResult {
    const fileVersion = info.packageFileVersion ?? 'unavailable'
    const versionMismatch = info.versionMismatch
      ? ` (bundle/package mismatch: runtime=${info.packageVersion}, package.json=${fileVersion})`
      : ''
    return {
      group: 'Environment',
      label: 'Runtime identity',
      status: info.versionMismatch ? 'warn' : 'pass',
      message:
        `source=${info.source}; runtime=${info.runtimeName} ${info.runtimeVersion}; ` +
        `executable=${info.executablePath}; launcher=${info.launcherPath}; ` +
        `package=${info.packageVersion}${versionMismatch}`,
      details: {
        source: info.source,
        runtimeName: info.runtimeName,
        runtimeVersion: info.runtimeVersion,
        executablePath: info.executablePath,
        launcherPath: info.launcherPath,
        packageRoot: info.packageRoot,
        packageVersion: info.packageVersion,
        packageFileVersion: info.packageFileVersion,
        versionMismatch: info.versionMismatch,
      },
      ...(info.versionMismatch && {
        remediation: {
          command: 'dbcli upgrade',
          risk: 'interactive' as const,
        },
      }),
    }
  },

  checkBunVersion(current: string, required: string): DoctorResult {
    const passes = compareSemver(current, required) >= 0
    return {
      group: 'Environment',
      label: 'Bun version',
      status: passes ? 'pass' : 'error',
      message: passes
        ? `Bun v${current} (meets >= ${required})`
        : `Bun v${current} is below required >= ${required}`,
    }
  },

  async checkLatestVersion(currentVersion: string): Promise<DoctorResult> {
    try {
      const response = await fetch('https://registry.npmjs.org/@carllee1983/dbcli/latest', {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as { version: string }
      const latest = data.version
      const isLatest = currentVersion === latest
      return {
        group: 'Environment',
        label: 'dbcli version',
        status: isLatest ? 'pass' : 'warn',
        message: isLatest
          ? `dbcli v${currentVersion} (latest)`
          : `dbcli v${currentVersion} (latest: ${latest})`,
      }
    } catch {
      return {
        group: 'Environment',
        label: 'dbcli version',
        status: 'pass',
        message: `dbcli v${currentVersion} (version check skipped)`,
      }
    }
  },

  async checkConfigExists(
    configPath: string,
    existsFn?: (path: string) => Promise<boolean>
  ): Promise<DoctorResult> {
    const exists = existsFn
      ? await existsFn(configPath)
      : (await Bun.file(configPath).exists()) ||
        (await Bun.file(join(configPath, 'config.json')).exists())
    return {
      group: 'Configuration',
      label: 'Config exists',
      status: exists ? 'pass' : 'error',
      message: exists
        ? `Config found: ${configPath}`
        : `No config found at ${configPath}. Run "dbcli init" first.`,
      ...(!exists && {
        remediation: {
          command: 'dbcli init',
          risk: 'interactive' as const,
        },
      }),
    }
  },

  checkBlacklistCompleteness(
    tableColumns: Map<string, string[]>,
    blacklistedColumns: Map<string, Set<string>>
  ): DoctorResult {
    const unprotected: string[] = []
    for (const [table, columns] of tableColumns) {
      const blacklisted = blacklistedColumns.get(table) ?? new Set()
      for (const col of columns) {
        const colLower = col.toLowerCase()
        const isSensitive = SENSITIVE_PATTERNS.some((p) => colLower.includes(p))
        if (isSensitive && !blacklisted.has(col)) {
          unprotected.push(`${table}.${col}`)
        }
      }
    }
    if (unprotected.length === 0) {
      return {
        group: 'Configuration',
        label: 'Blacklist completeness',
        status: 'pass',
        message: 'All detected sensitive columns are protected',
      }
    }
    return {
      group: 'Configuration',
      label: 'Blacklist completeness',
      status: 'warn',
      message: `Consider protecting: ${unprotected.join(', ')}`,
    }
  },

  checkSchemaCacheFreshness(lastUpdated: string | null): DoctorResult {
    if (!lastUpdated) {
      return {
        group: 'Connection & Data',
        label: 'Schema cache',
        status: 'warn',
        message: 'No schema cache found — run "dbcli schema --refresh"',
      }
    }
    const ageMs = Date.now() - new Date(lastUpdated).getTime()
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000))
    if (ageDays > 7) {
      return {
        group: 'Connection & Data',
        label: 'Schema cache',
        status: 'warn',
        message: `Schema cache is ${ageDays} days old — run "dbcli schema --refresh"`,
      }
    }
    return {
      group: 'Connection & Data',
      label: 'Schema cache',
      status: 'pass',
      message: `Schema cache is ${ageDays} day(s) old`,
    }
  },

  checkDatabaseVersion(versionResult: VersionCheckResult): DoctorResult {
    const vars = {
      system: versionResult.system,
      version: versionResult.serverVersion,
      minVersion: versionResult.minVersion,
    }
    return {
      group: 'Connection & Data',
      label: 'Database version',
      status: versionResult.supported ? 'pass' : 'warn',
      message: versionResult.supported
        ? t_vars('version.doctor_pass', vars)
        : t_vars('version.doctor_warn', vars),
    }
  },

  async checkMongoSrvConnectivity(
    uri: string | undefined,
    deps: MongoSrvLookupDeps = {}
  ): Promise<DoctorResult | null> {
    if (!uri || !uri.startsWith('mongodb+srv://')) {
      return null
    }

    // A malformed host must surface as an SRV finding. Throwing here would be
    // caught by the caller's connection try/catch and reported as "connection
    // failed", skipping this check and every config warning after it.
    let url: URL
    try {
      url = new URL(uri)
    } catch {
      return {
        group: 'Environment',
        label: 'MongoDB SRV lookup',
        status: 'error',
        message: `Cannot parse ${uri} as a connection string — check the host value`,
      }
    }

    const srvName = `_mongodb._tcp.${url.hostname}`
    const resolveSrvFn = deps.resolveSrvFn ?? resolveSrv
    const fetchFn = deps.fetchFn ?? fetch

    try {
      const records = await resolveSrvFn(srvName)
      if (!records.length) {
        return {
          group: 'Environment',
          label: 'MongoDB SRV lookup',
          status: 'error',
          message: `No SRV records found for ${url.hostname}`,
        }
      }

      return {
        group: 'Environment',
        label: 'MongoDB SRV lookup',
        status: 'pass',
        message: `MongoDB SRV lookup reachable for ${url.hostname} (${records.length} record(s))`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = (error as { code?: string })?.code
      const isExecutionEnvIssue =
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        message.includes('Unable to connect. Is the computer able to access the url?') ||
        message.includes('ConnectionRefused')

      if (!isExecutionEnvIssue) {
        return {
          group: 'Environment',
          label: 'MongoDB SRV lookup',
          status: 'error',
          message: `MongoDB SRV lookup failed for ${url.hostname}: ${message}`,
        }
      }

      try {
        const response = await fetchFn(
          `https://dns.google/resolve?name=${encodeURIComponent(srvName)}&type=SRV`,
          { signal: AbortSignal.timeout(5000) }
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const payload = (await response.json()) as {
          Status?: number
          Answer?: unknown[]
          Comment?: string
        }

        if (payload.Status !== 0 || !payload.Answer?.length) {
          throw new Error(payload.Comment || `No SRV records found for ${url.hostname}`)
        }

        return {
          group: 'Environment',
          label: 'MongoDB SRV lookup',
          status: 'warn',
          message:
            `Direct SRV DNS lookup failed in this shell, but DNS-over-HTTPS fallback resolved ` +
            `${url.hostname}. dbcli can still connect here, but this runtime environment cannot perform direct SRV lookups.`,
        }
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        return {
          group: 'Environment',
          label: 'MongoDB SRV lookup',
          status: 'error',
          message:
            `MongoDB SRV lookup failed in this environment (${code || 'unknown'}); ` +
            `DNS-over-HTTPS fallback also failed: ${fallbackMessage}`,
        }
      }
    }
  },

  checkLargeTables(
    tables: Array<{ name: string; estimatedRowCount?: number }>,
    system: LargeTableTarget = 'postgresql'
  ): DoctorResult {
    const large = tables.filter((t) => (t.estimatedRowCount ?? 0) > 1_000_000)
    if (large.length === 0) {
      return {
        group: 'Connection & Data',
        label: 'Large tables',
        status: 'pass',
        message: 'No tables exceed 1M rows',
      }
    }
    const list = large
      .map((t) => `${t.name} (${((t.estimatedRowCount ?? 0) / 1_000_000).toFixed(1)}M rows)`)
      .join(', ')
    return {
      group: 'Connection & Data',
      label: 'Large tables',
      status: 'warn',
      message: `Large tables: ${list}`,
      details: {
        system,
        largeTables: large.map(({ name, estimatedRowCount }) => ({ name, estimatedRowCount })),
      },
    }
  },

  async checkV2Config(configPath: string): Promise<DoctorResult[]> {
    const results: DoctorResult[] = []
    const storagePath = await resolveConfigStoragePath(configPath)
    const configFile = Bun.file(join(storagePath, 'config.json'))

    if (!(await configFile.exists())) return results

    let raw: unknown
    try {
      raw = JSON.parse(await configFile.text())
    } catch {
      return results
    }

    if (detectConfigVersion(raw) !== 2) return results

    let config: ReturnType<typeof DbcliConfigV2Schema.parse>
    try {
      config = DbcliConfigV2Schema.parse(raw)
    } catch {
      results.push({
        group: 'Configuration',
        label: 'V2 config validation',
        status: 'error',
        message: 'V2 設定檔格式無效',
      })
      return results
    }

    // Check default points to existing connection
    if (!config.connections[config.default]) {
      results.push({
        group: 'Configuration',
        label: 'Default connection',
        status: 'error',
        message: `預設連線 '${config.default}' 不存在於 connections 中`,
      })
    } else {
      results.push({
        group: 'Configuration',
        label: 'Default connection',
        status: 'pass',
        message: `預設連線 '${config.default}' 有效`,
      })
    }

    // Check envFile existence for each connection
    for (const [name, conn] of Object.entries(config.connections) as Array<
      [string, { envFile?: string }]
    >) {
      if (conn.envFile) {
        const envPath = join(storagePath, conn.envFile)
        const exists = await Bun.file(envPath).exists()
        results.push({
          group: 'Configuration',
          label: `Env file (${name})`,
          status: exists ? 'pass' : 'error',
          message: exists
            ? `${conn.envFile} 存在`
            : `連線 '${name}' 的 env 檔案 ${conn.envFile} 不存在`,
        })
      }
    }

    return results
  },

  formatTextOutput(results: DoctorResult[], version: string): string {
    const lines: string[] = [`dbcli doctor v${version}`, '']
    const groups = ['Environment', 'Configuration', 'Connection & Data']
    for (const group of groups) {
      const groupResults = results.filter((r) => r.group === group)
      if (groupResults.length === 0) continue
      lines.push(group)
      for (const r of groupResults) {
        const icon =
          r.status === 'pass'
            ? colors.success('✓')
            : r.status === 'warn'
              ? colors.warn('⚠')
              : colors.error('✗')
        lines.push(`  ${icon} ${r.message}`)
      }
      lines.push('')
    }
    const passed = results.filter((r) => r.status === 'pass').length
    const warnings = results.filter((r) => r.status === 'warn').length
    const errors = results.filter((r) => r.status === 'error').length
    lines.push(`Summary: ${passed} passed, ${warnings} warning(s), ${errors} error(s)`)
    return lines.join('\n')
  },
}

export async function collectMongoDoctorResults(config: {
  connection: ConnectionConfig
  metadata?: { schemaLastUpdated?: string }
  blacklistedColumns?: Map<string, Set<string>>
}): Promise<DoctorResult[]> {
  const results: DoctorResult[] = []

  const mongoConn = config.connection.system === 'mongodb' ? config.connection : null
  const mongoUriString = mongoConn && typeof mongoConn.uri === 'string' ? mongoConn.uri : undefined
  // Field-based `srv: true` needs the same SRV diagnosis as a mongodb+srv:// uri —
  // it is the primary path for Atlas, where DNS is the usual failure point.
  const srvProbeUri =
    mongoUriString ??
    (mongoConn?.srv === true && typeof mongoConn.host === 'string' && mongoConn.host
      ? `mongodb+srv://${mongoConn.host}/`
      : undefined)
  const srvCheck = await runDoctorChecks.checkMongoSrvConnectivity(srvProbeUri)
  if (srvCheck) {
    results.push(srvCheck)
    if (srvCheck.status === 'error') {
      return results
    }
  }

  // Surface config shapes that silently do nothing, so "I edited the field and
  // nothing changed" is diagnosable instead of mysterious.
  if (mongoConn) {
    const hasFieldConfig = Boolean(mongoConn.host) || Boolean(mongoConn.user)
    if (mongoUriString && hasFieldConfig) {
      results.push({
        group: 'Connection & Data',
        label: 'MongoDB connection fields',
        status: 'warn',
        message:
          'Both uri and per-field settings (host/user) are present; uri takes precedence and the per-field values are ignored.',
      })
    }

    if (mongoConn.srv === true && typeof mongoConn.port === 'number' && mongoConn.port !== 27017) {
      results.push({
        group: 'Connection & Data',
        label: 'MongoDB SRV port',
        status: 'warn',
        message: `srv is enabled, so port ${mongoConn.port} is ignored — SRV records carry their own ports.`,
      })
    }
  }

  const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)

  try {
    await adapter.connect()
    results.push({
      group: 'Connection & Data',
      label: 'Connection',
      status: 'pass',
      message: `Connected to mongodb ${String(config.connection.database) || '(default db)'}`,
    })

    try {
      const version = await adapter.getServerVersion()
      results.push({
        group: 'Connection & Data',
        label: 'Server version',
        status: 'pass',
        message: `MongoDB ${version}`,
      })
    } catch {
      // Ignore version probe failure; connection already proved healthy.
    }

    const collections = adapter.listTables ? await adapter.listTables() : []

    // Add inferred column details for blacklist check
    const tableColumns = new Map<string, string[]>()
    for (const coll of collections) {
      try {
        if (!adapter.getTableSchema) continue
        const schema = await adapter.getTableSchema(coll.name)
        tableColumns.set(
          coll.name,
          schema.columns.map((c) => c.name)
        )
      } catch {
        // Ignore schema inference failures
      }
    }

    if (config.blacklistedColumns) {
      results.push(
        runDoctorChecks.checkBlacklistCompleteness(tableColumns, config.blacklistedColumns)
      )
    }

    results.push(
      runDoctorChecks.checkLargeTables(
        collections.map((coll) => ({
          name: coll.name,
          estimatedRowCount: coll.estimatedRowCount,
        })),
        'mongodb'
      )
    )

    results.push({
      group: 'Connection & Data',
      label: 'Collections',
      status: 'pass',
      message:
        collections.length === 0
          ? 'No collections found'
          : `Found ${collections.length} collection(s)`,
    })

    const lastUpdated = config.metadata?.schemaLastUpdated ?? null
    results.push(runDoctorChecks.checkSchemaCacheFreshness(lastUpdated))
  } catch (error) {
    results.push({
      group: 'Connection & Data',
      label: 'Connection',
      status: 'error',
      message: `Connection failed: ${(error as Error).message}`,
    })
  } finally {
    await adapter.disconnect()
  }

  return results
}

export async function collectElasticsearchDoctorResults(config: {
  connection: ConnectionConfig
  metadata?: { schemaLastUpdated?: string }
  blacklistedColumns?: Map<string, Set<string>>
}): Promise<DoctorResult[]> {
  const results: DoctorResult[] = []
  const esAdapter = AdapterFactory.createElasticsearchAdapter(
    config.connection as ConnectionOptions
  )

  try {
    await esAdapter.connect()
    results.push({
      group: 'Connection & Data',
      label: 'Connection',
      status: 'pass',
      message: `Connected to Elasticsearch ${config.connection.host}:${config.connection.port}`,
    })

    try {
      const version = await esAdapter.getServerVersion()
      const versionResult = checkDbVersion(version, 'elasticsearch')
      results.push(runDoctorChecks.checkDatabaseVersion(versionResult))
    } catch {
      // Ignore
    }

    const tables = (await esAdapter.listTables?.()) ?? []
    const tableColumns = new Map<string, string[]>()
    for (const t of tables) {
      try {
        const schema = await esAdapter.getTableSchema?.(t.name)
        if (!schema) continue
        tableColumns.set(
          t.name,
          schema.columns.map((c) => c.name)
        )
      } catch {
        // Ignore
      }
    }

    if (config.blacklistedColumns) {
      results.push(
        runDoctorChecks.checkBlacklistCompleteness(tableColumns, config.blacklistedColumns)
      )
    }

    results.push(runDoctorChecks.checkLargeTables(tables, 'elasticsearch'))

    const lastUpdated = config.metadata?.schemaLastUpdated ?? null
    results.push(runDoctorChecks.checkSchemaCacheFreshness(lastUpdated))
  } catch (error) {
    results.push({
      group: 'Connection & Data',
      label: 'Connection',
      status: 'error',
      message: `Connection failed: ${(error as Error).message}`,
    })
  } finally {
    await esAdapter.disconnect()
  }

  return results
}

export const doctorCommand = new Command('doctor')
  .description('Run diagnostic checks on dbcli configuration, environment, and connection')
  .option('--format <type>', 'Output format: text, json', 'text')
  .option('--remediation', 'Include a non-mutating, human-confirmed remediation plan', false)
  .action(async (options) => {
    validateFormat(options.format, ALLOWED_FORMATS, 'doctor')

    const logger = getLogger()
    const results: DoctorResult[] = []
    const configPath = resolveConfigPath(doctorCommand)
    const storagePath = await resolveConfigStoragePath(configPath)

    // --- Environment ---
    const bunVersion = (process.versions as Record<string, string>).bun ?? 'unknown'
    const requiredBun = (pkg.engines as Record<string, string>)?.bun?.replace('>=', '') ?? '1.3.3'
    results.push(runDoctorChecks.checkRuntime(await collectRuntimeInfo(pkg.version)))
    results.push(runDoctorChecks.checkBunVersion(bunVersion, requiredBun))
    results.push(await runDoctorChecks.checkLatestVersion(pkg.version))

    // --- Configuration ---
    const configExists = await runDoctorChecks.checkConfigExists(storagePath)
    results.push(configExists)

    if (configExists.status !== 'error') {
      try {
        const config = await configModule.read(configPath)
        results.push({
          group: 'Configuration',
          label: 'Config valid',
          status: 'pass',
          message: 'Config valid',
        })
        results.push({
          group: 'Configuration',
          label: 'Permission',
          status: 'pass',
          message: `Permission: ${config.permission}`,
        })

        // V2-specific checks
        const v2Results = await runDoctorChecks.checkV2Config(configPath)
        results.push(...v2Results)

        const blacklistedColumns = new Map<string, Set<string>>()
        if (config.blacklist?.columns) {
          for (const [table, cols] of Object.entries(config.blacklist.columns)) {
            blacklistedColumns.set(table, new Set(cols as string[]))
          }
        }

        // --- Connection & Data ---
        try {
          if (config.connection.system === 'mongodb') {
            results.push(
              ...(await collectMongoDoctorResults({
                ...config,
                blacklistedColumns,
              }))
            )
          } else if (config.connection.system === 'elasticsearch') {
            results.push(
              ...(await collectElasticsearchDoctorResults({
                ...config,
                blacklistedColumns,
              }))
            )
          } else {
            const adapter = AdapterFactory.createSqlAdapter(
              requireSqlConnection(config.connection as ConnectionOptions)
            )
            await adapter.connect()

            results.push({
              group: 'Connection & Data',
              label: 'Connection',
              status: 'pass',
              message: `Connected to ${config.connection.system} ${config.connection.database}@${config.connection.host}:${config.connection.port}`,
            })

            // Check database server version
            try {
              const rawVersion = await adapter.getServerVersion()
              const versionResult = checkDbVersion(
                rawVersion,
                config.connection.system as 'postgresql' | 'mysql' | 'mariadb'
              )
              results.push(runDoctorChecks.checkDatabaseVersion(versionResult))
            } catch {
              logger.debug('Could not retrieve database version')
            }

            try {
              const tables = await adapter.listTables()
              const tableColumns = new Map<string, string[]>()
              for (const t of tables) {
                tableColumns.set(
                  t.name,
                  t.columns.map((c) => c.name)
                )
              }
              results.push(
                runDoctorChecks.checkBlacklistCompleteness(tableColumns, blacklistedColumns)
              )
              results.push(
                runDoctorChecks.checkLargeTables(
                  tables,
                  config.connection.system as 'postgresql' | 'mysql' | 'mariadb'
                )
              )
            } catch {
              logger.debug('Could not list tables for blacklist/large table check')
            }

            try {
              const schemaConnName = await getSchemaIsolationConnectionName(configPath)
              const indexPath = join(resolveSchemaPath(storagePath, schemaConnName), 'index.json')
              const indexFile = Bun.file(indexPath)
              let indexParsed: unknown = null
              if (await indexFile.exists()) {
                indexParsed = JSON.parse(await indexFile.text()) as unknown
              }
              const lastUpdated = resolveSchemaLastUpdated(indexParsed, config.metadata)
              results.push(runDoctorChecks.checkSchemaCacheFreshness(lastUpdated))
            } catch {
              results.push(
                runDoctorChecks.checkSchemaCacheFreshness(
                  config.metadata?.schemaLastUpdated ?? null
                )
              )
            }

            await adapter.disconnect()
          }
        } catch (error) {
          results.push({
            group: 'Connection & Data',
            label: 'Connection',
            status: 'error',
            message: `Connection failed: ${(error as Error).message}`,
          })
        }
      } catch (error) {
        results.push({
          group: 'Configuration',
          label: 'Config valid',
          status: 'error',
          message: `Config invalid: ${(error as Error).message}`,
        })
      }
    }

    const hasError = results.some((r) => r.status === 'error')

    try {
      const config = await configModule.read(configPath)
      await writeAuditEntry(config, 'doctor', options as any, {
        success: !hasError,
        target: '*',
        metadata: {
          error_count: results.filter((r) => r.status === 'error').length,
          warn_count: results.filter((r) => r.status === 'warn').length,
        },
      })
    } catch {
      // Best effort audit for doctor
    }

    if (options.format === 'json') {
      const remediation = options.remediation ? buildDoctorRemediationPlan(results) : undefined
      console.log(
        JSON.stringify({ results, hasError, ...(remediation && { remediation }) }, null, 2)
      )
    } else {
      console.log(runDoctorChecks.formatTextOutput(results, pkg.version))
    }
    if (hasError) {
      process.exit(1)
    }
  })
