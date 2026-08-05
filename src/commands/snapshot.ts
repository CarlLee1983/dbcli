// src/commands/snapshot.ts
import { Command } from 'commander'
import { join } from 'node:path'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { QueryExecutor } from '@/core/query-executor'
import { SQL_DIALECTS } from '@/core/permission-guard'
import { extractTableReferences } from '@/utils/sql-tables'
import { buildFingerprint } from '@/core/result-snapshot/fingerprint'
import { writeSnapshot } from '@/core/result-snapshot/serializer'
import {
  loadSnippets,
  mapSystemToEngine,
  resolveByName,
  resolveSnippetDirs,
} from '@/core/saved-queries'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { SnapshotEngine } from '@/core/result-snapshot/types'

const ALLOWED_FORMATS = ['json', 'table'] as const
const SQL_SYSTEMS = ['postgresql', 'mysql', 'mariadb']

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!SQL_SYSTEMS.includes(connection.system)) {
    throw new Error(`snapshot currently supports SQL engines only, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function defaultSnapshotPath(): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return join('.dbcli', 'snapshots', `snap-${stamp}.json`)
}

export const snapshotCommand = new Command()
  .name('snapshot')
  .description(
    'Capture a result fingerprint (rowCount + per-column aggregates) for later comparison'
  )
  .argument('<query>', 'SQL string or @saved-query reference')
  .option(
    '--out <path>',
    'Write snapshot to this path (default: .dbcli/snapshots/snap-<timestamp>.json)'
  )
  .option('--rows', 'Also include full (blacklist-masked) rows in the snapshot', false)
  .option('--stdout', 'Print snapshot JSON to stdout instead of writing a file', false)
  .option('--format <format>', 'Output format for --stdout: json (default) or table', 'json')
  .option('--no-limit', 'Disable the automatic query-only LIMIT')
  .action(async (query: string, options: Record<string, unknown>, command: Command) => {
    try {
      validateFormat(options.format as string, ALLOWED_FORMATS, 'snapshot')
      const configPath = resolveConfigPath(command, options as { config?: string })
      const config = await configModule.read(configPath)
      if (!config.connection) {
        console.error('Database not configured. Run: dbcli init')
        process.exit(1)
      }

      // Resolve @saved-query references to raw SQL.
      let sql = query
      if (query.startsWith('@')) {
        const engine = mapSystemToEngine(config.connection.system)
        const dirs = resolveSnippetDirs(process.cwd())
        const snippets = await loadSnippets(dirs)
        sql = resolveByName(snippets, query.slice(1), engine).query.sqlBody
      }

      const adapter = AdapterFactory.createSqlAdapter(
        requireSqlConnection(config.connection as ConnectionOptions)
      )
      await adapter.connect()
      try {
        const blacklistManager = new BlacklistManager(config)
        const blacklistValidator = new BlacklistValidator(blacklistManager)
        const sqlDialect = SQL_DIALECTS.find((dialect) => dialect === config.connection?.system)
        const executor = new QueryExecutor(
          adapter,
          config.permission,
          blacklistValidator,
          config,
          options as { config?: string }
        )
        const result = await executor.execute(sql, { autoLimit: options.limit !== false })

        // The executor redacted the union of the rules of every referenced
        // table, so the snapshot's record of what was redacted has to be built
        // from the same list or it understates itself.
        const redactedColumns = Array.from(
          new Set(
            extractTableReferences(sql, {
              ...(sqlDialect ? { dialect: sqlDialect } : {}),
            }).flatMap((table) => blacklistManager.getBlacklistedColumns(table))
          )
        )
        const snap = buildFingerprint(result, {
          includeRows: options.rows === true,
          redactedColumns,
          query: sql,
          engine: config.connection.system as SnapshotEngine,
        })

        if (options.stdout === true) {
          console.log(JSON.stringify(snap, null, 2))
        } else {
          const outPath = (options.out as string) ?? defaultSnapshotPath()
          await writeSnapshot(outPath, snap)
          console.error(
            `Snapshot saved to ${outPath} (${snap.rowCount} rows, ${snap.columns.length} columns)`
          )
        }
        await writeAuditEntry(config, 'snapshot', options as { config?: string }, {
          success: true,
          sql,
        })
      } finally {
        await adapter.disconnect()
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
        if (error instanceof ConnectionError)
          error.hints.forEach((h) => console.error(`   Hint: ${h}`))
      }
      process.exit(1)
    }
  })
