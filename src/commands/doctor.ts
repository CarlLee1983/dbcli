import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { configModule } from '@/core/config'
import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import type { ConnectionConfig } from '@/types'
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
import { getSchemaIsolationConnectionName } from '@/core/config'
import { resolveSrv } from 'node:dns/promises'

const ALLOWED_FORMATS = ['text', 'json'] as const

export interface DoctorResult {
  group: string
  label: string
  status: 'pass' | 'warn' | 'error'
  message: string
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

    const url = new URL(uri)
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

  checkLargeTables(tables: Array<{ name: string; estimatedRowCount?: number }>): DoctorResult {
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
}): Promise<DoctorResult[]> {
  const results: DoctorResult[] = []

  const mongoConn = config.connection.system === 'mongodb' ? config.connection : null
  const mongoUriString =
    mongoConn && typeof mongoConn.uri === 'string' ? mongoConn.uri : undefined
  const srvCheck = await runDoctorChecks.checkMongoSrvConnectivity(mongoUriString)
  if (srvCheck) {
    results.push(srvCheck)
    if (srvCheck.status === 'error') {
      return results
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

    const collections = await adapter.listCollections()
    results.push(
      runDoctorChecks.checkLargeTables(
        collections.map((collection) => ({
          name: collection.name,
          estimatedRowCount: collection.documentCount,
        }))
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

    results.push({
      group: 'Connection & Data',
      label: 'Schema cache',
      status: 'warn',
      message: config.metadata?.schemaLastUpdated
        ? `Schema cache timestamp present: ${config.metadata.schemaLastUpdated}`
        : 'Schema cache is not tracked for MongoDB — run collection inspections instead',
    })
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

export const doctorCommand = new Command('doctor')
  .description('Run diagnostic checks on dbcli configuration, environment, and connection')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(async (options) => {
    validateFormat(options.format, ALLOWED_FORMATS, 'doctor')

    const logger = getLogger()
    const results: DoctorResult[] = []
    const configPath = resolveConfigPath(doctorCommand)
    const storagePath = await resolveConfigStoragePath(configPath)

    // --- Environment ---
    const bunVersion = (process.versions as Record<string, string>).bun ?? 'unknown'
    const requiredBun = (pkg.engines as Record<string, string>)?.bun?.replace('>=', '') ?? '1.3.3'
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
            results.push(...(await collectMongoDoctorResults(config)))
          } else {
            const adapter = AdapterFactory.createAdapter(
              config.connection as ConnectionOptions
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
              results.push(runDoctorChecks.checkLargeTables(tables))
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
    if (options.format === 'json') {
      console.log(JSON.stringify({ results, hasError }, null, 2))
    } else {
      console.log(runDoctorChecks.formatTextOutput(results, pkg.version))
    }
    if (hasError) {
      process.exit(1)
    }
  })
