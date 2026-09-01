import { Command } from 'commander'
import { AdapterFactory, type ConnectionOptions, type SqlConnectionOptions } from '@/adapters'
import { configModule } from '@/core/config'
import { HealthChecker } from '@/core/health-checker'
import { BlacklistManager } from '@/core/blacklist-manager'
import { getSizeCategory } from '@/core/size-category'
import type { CheckType, CheckReport } from '@/types/check'
import { validateFormat } from '@/utils/validation'
import { createConnectionSelectorOption } from '@/core/connection-selector'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const ALLOWED_FORMATS = ['json', 'table'] as const

export const checkCommand = new Command()
  .name('check')
  .description('Run data health checks on tables')
  .argument('[table]', 'Table to check (omit for --all)')
  .option('--all', 'Check all tables (skips huge tables unless --include-large)', false)
  .option('--include-large', 'Include huge tables in --all scan', false)
  .option(
    '--checks <types>',
    'Comma-separated checks: nulls,duplicates,orphans,emptyStrings',
    undefined
  )
  .option('--sample <number>', 'Sample size for large tables (default: 10000)', '10000')
  .option('--format <format>', 'Output format: json (default) or table', 'json')
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
  .addOption(createConnectionSelectorOption())
  .action(checkAction)

async function checkAction(
  table: string | undefined,
  options: {
    all: boolean
    includeLarge: boolean
    checks?: string
    sample: string
    format: string
    config: string
  }
) {
  validateFormat(options.format, ALLOWED_FORMATS, 'check')

  const config = await configModule.read(options.config)
  if (!config.connection) {
    throw new Error('Database not configured. Run: dbcli init')
  }

  const adapter = AdapterFactory.createSqlAdapter(
    requireSqlConnection(config.connection as ConnectionOptions)
  )
  await adapter.connect()

  try {
    const checker = new HealthChecker(adapter)
    const blacklistManager = new BlacklistManager(config)
    const blacklistedColumns = getBlacklistedColumnSet(blacklistManager)

    const checkTypes = options.checks ? (options.checks.split(',') as CheckType[]) : undefined

    const sampleSize = parseInt(options.sample, 10) || 10_000

    if (table) {
      // 問 manager，不要自己查它的私有 state：那份 Set 只有字面條目、而且是用
      // `foldFieldPath` 折的，這裡卻用裸的 `toLowerCase` 查。萬用字元規則因此
      // 對這條路徑完全不存在（ADR-0019 Decision 4），折疊也對不上（ADR-0020）。
      if (blacklistManager.isTableBlacklisted(table)) {
        throw new Error(`Table "${table}" is blacklisted`)
      }

      const schema = await adapter.getTableSchema(table)
      const report = await checker.check(schema, {
        checks: checkTypes,
        sample: sampleSize,
        blacklistedColumns,
      })

      outputReport(report, options.format)
    } else if (options.all) {
      const tables = await adapter.listTables()
      const reports: CheckReport[] = []
      const skipped: string[] = []

      for (const t of tables) {
        if (blacklistManager.isTableBlacklisted(t.name)) {
          skipped.push(`${t.name} (blacklisted)`)
          continue
        }
        if (t.tableType === 'view') {
          skipped.push(`${t.name} (view)`)
          continue
        }

        const category = getSizeCategory(t.estimatedRowCount)
        if (category === 'huge' && !options.includeLarge) {
          skipped.push(`${t.name} (~${(t.estimatedRowCount || 0).toLocaleString()} rows, huge)`)
          continue
        }

        const schema = await adapter.getTableSchema(t.name)
        const report = await checker.check(schema, {
          checks: checkTypes,
          sample: sampleSize,
          blacklistedColumns,
        })
        reports.push(report)
      }

      if (options.format === 'json') {
        console.log(JSON.stringify({ reports, skipped }, null, 2))
      } else {
        for (const report of reports) {
          outputReport(report, 'table')
          console.log('')
        }
        if (skipped.length > 0) {
          console.log(`Skipped: ${skipped.join(', ')}`)
        }
      }
    } else {
      throw new Error('Specify a table name or use --all')
    }
  } finally {
    await adapter.disconnect()
  }
}

function outputReport(report: CheckReport, format: string): void {
  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`\nTable: ${report.table} (${report.rowCount} rows, ${report.sizeCategory})`)
    console.log(`  Nulls: ${report.checks.nulls.length} columns with NULLs`)
    for (const n of report.checks.nulls) {
      console.log(`    ${n.column}: ${n.nullCount} nulls (${n.nullPercent}%)`)
    }
    console.log(`  Orphans: ${report.checks.orphans.length} FK violations`)
    for (const o of report.checks.orphans) {
      console.log(`    ${o.column} -> ${o.references}: ${o.orphanCount} orphans`)
    }
    console.log(`  Duplicates: ${report.checks.duplicates.length} unique index violations`)
    for (const d of report.checks.duplicates) {
      console.log(`    ${d.indexName} (${d.columns.join(',')}): ${d.duplicateCount} duplicates`)
    }
    console.log(`  Empty strings: ${report.checks.emptyStrings.length} columns`)
    for (const e of report.checks.emptyStrings) {
      console.log(`    ${e.column}: ${e.count} empty strings`)
    }
    console.log(
      `  Summary: ${report.summary.issues} issues, ${report.summary.warnings} warnings, ${report.summary.clean} clean`
    )
  }
}

function getBlacklistedColumnSet(manager: BlacklistManager): Set<string> {
  const state = (
    manager as unknown as { state: { columns: Map<string, Set<string>>; tables: Set<string> } }
  ).state
  const result = new Set<string>()
  if (state?.columns) {
    for (const [table, cols] of state.columns.entries()) {
      for (const col of cols) {
        result.add(`${table}.${col}`)
      }
    }
  }
  return result
}
