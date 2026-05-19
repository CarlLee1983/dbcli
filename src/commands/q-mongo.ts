import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { maskMongoRows } from '@/core/mongo/field-masker'
import { QueryResultFormatter } from '@/formatters'
import { generateHtmlReport } from '@/formatters/html-formatter'
import { openInBrowser } from '@/utils/opener'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedSnippet } from '@/core/saved-queries'
import type { PreparedExecution } from '@/core/saved-queries/runner'
import type { DbcliConfig } from '@/utils/validation'
import type { QCommandOptions } from '@/commands/q'

export async function qMongoBranch(
  snippet: ResolvedSnippet,
  prepared: PreparedExecution,
  options: QCommandOptions,
  config: DbcliConfig
): Promise<void> {
  const collection = (options.collection as string | undefined) ?? prepared.execHints?.collection
  if (!collection) {
    throw new Error(
      `MongoDB snippet '${snippet.query.meta.key}' resolved without a target collection`
    )
  }
  const blacklistManager = new BlacklistManager(config)
  const blacklistValidator = new BlacklistValidator(blacklistManager)
  blacklistValidator.checkTableBlacklist('SELECT', collection)

  if (options.dryRun) {
    console.log(`Dry-run preview (no execution):`)
    console.log(`Collection: ${collection}`)
    console.log(`Operation: ${prepared.execHints?.mongoOperation ?? 'find'}`)
    console.log(prepared.driver.sql)
    return
  }

  const adapter = AdapterFactory.createMongoDBAdapter(config.connection as ConnectionOptions)
  await adapter.connect()
  try {
    const start = performance.now()
    const result = await adapter.execute<Record<string, unknown>>(prepared.driver.sql, [collection])
    const executionTimeMs = Math.round(performance.now() - start)

    const blacklistCfg = (
      config as { blacklist?: { tables: string[]; columns: Record<string, string[]> } }
    ).blacklist ?? { tables: [], columns: {} }
    const masked = maskMongoRows(result.rows, collection, blacklistCfg)

    if (options.ui || options.format === 'html') {
      const html = await generateHtmlReport({ meta: snippet.query.meta, rows: masked })
      if (options.ui) {
        const tempPath = join(tmpdir(), `dbcli-report-${Date.now()}.html`)
        await Bun.write(tempPath, html)
        await openInBrowser(tempPath)
      } else {
        console.log(html)
      }
    } else {
      const columnNames = masked[0] ? Object.keys(masked[0]) : []
      const formatter = new QueryResultFormatter()
      console.log(
        formatter.format(
          {
            rows: masked,
            rowCount: masked.length,
            columnNames,
            columnTypes: [],
            executionTimeMs,
            metadata: { statement: 'SELECT', affectedRows: 0 },
          },
          { format: (options.format as 'table' | 'json' | 'csv' | 'html') ?? 'table' }
        )
      )
    }

    await writeAuditEntry(config, 'q', options, {
      success: true,
      target: collection,
      sql: prepared.driver.sql,
      metadata: { rows_affected: masked.length, execution_ms: executionTimeMs },
    })
  } finally {
    await adapter.disconnect()
  }
}
