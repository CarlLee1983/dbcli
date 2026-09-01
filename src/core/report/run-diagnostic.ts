import type { DatabaseAdapter } from '@/adapters/types'
import { parseRedisCommand } from '@/adapters/redis-adapter'
import { redisCommandTargets } from '@/adapters/redis/blacklist-enforcer'
import { BlacklistRejection } from '@/adapters/redis/types'
import {
  prepareExecution,
  SavedQueryError,
  type EngineTag,
  type ResolvedSnippet,
} from '@/core/saved-queries'
import { engineFamily } from '@/core/saved-queries/strategies'
import { extractTableReferences, type SqlTablesDialect } from '@/utils/sql-tables'

/** Snippet engine tag to the SQL dialect it runs under. */
const ENGINE_DIALECT: Record<string, SqlTablesDialect | undefined> = {
  postgres: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mariadb',
}
import type { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'
import type { ReportFinding } from './types'

export interface RunDiagnosticInput {
  snippet: ResolvedSnippet
  adapter: DatabaseAdapter
  engine: EngineTag
  timeoutMs: number
  maxRows: number
  /**
   * Blacklist rules for the connection. Evidence rows are embedded in the
   * report, and the collector loads user-writable snippet directories, so an
   * unenforced rule here leaves a durable copy of the withheld data.
   */
  blacklistValidator?: BlacklistValidator
}

/**
 * Runs a single snippet and always returns an ReportFinding — never throws.
 * Statuses: ok / no-data / skipped (engine mismatch, prepare error) / error /
 * timeout. Rows are truncated to `maxRows`; `rowCount` reports the true count.
 */
export async function runDiagnostic(input: RunDiagnosticInput): Promise<ReportFinding> {
  const meta = input.snippet.query.meta
  const base: Pick<ReportFinding, 'snippet' | 'intent' | 'description'> = {
    snippet: meta.key,
    intent: meta.intent ?? '',
    description: meta.description ?? '',
  }

  let prepared
  let redisTokens: string[] = []
  try {
    prepared = prepareExecution(input.snippet, { engine: input.engine, noLimit: false }, {}, {})
    if (engineFamily(input.engine) === 'redis') {
      redisTokens = parseRedisCommand(prepared.rewrittenSql)
    }
  } catch (err) {
    const reason =
      err instanceof SavedQueryError ? err.message : `prepare failed: ${(err as Error).message}`
    return { ...base, rowCount: 0, rows: [], status: 'skipped', reason, durationMs: 0 }
  }

  const family = engineFamily(input.engine)

  // Refuse before executing when the snippet reads a blacklisted table.
  const referencedTables =
    family === 'sql'
      ? extractTableReferences(prepared.rewrittenSql, {
          // Without the dialect the scan has to consider every reading; the
          // engine tag names the one this snippet will actually run under.
          ...(ENGINE_DIALECT[input.engine] ? { dialect: ENGINE_DIALECT[input.engine] } : {}),
        })
      : family === 'es' && prepared.execHints?.index
        ? [prepared.execHints.index]
        : family === 'redis' && redisTokens.length > 0
          ? redisCommandTargets(redisTokens[0]!, redisTokens.slice(1))
          : []
  if (input.blacklistValidator && referencedTables.length > 0) {
    try {
      input.blacklistValidator.checkTablesBlacklist('SELECT', referencedTables)
    } catch (err) {
      if (!(err instanceof BlacklistError)) throw err
      return {
        ...base,
        rowCount: 0,
        rows: [],
        status: 'skipped',
        reason: family === 'redis' ? 'Redis diagnostic skipped by blacklist' : err.message,
        durationMs: 0,
      }
    }
  }

  const start = performance.now()
  const exec = (async () => {
    const indexParams =
      family === 'es' && prepared.execHints?.index ? [prepared.execHints.index] : []
    return input.adapter.execute<Record<string, unknown>>(
      prepared.driver.sql,
      family === 'sql' ? prepared.driver.values : indexParams
    )
  })()

  const timer = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), input.timeoutMs)
  )

  let outcome: { rows: Array<Record<string, unknown>> } | 'timeout' | 'error' | 'skipped'
  let errorMessage: string | null = null
  try {
    outcome = (await Promise.race([exec, timer])) as
      | { rows: Array<Record<string, unknown>> }
      | 'timeout'
  } catch (err) {
    outcome = err instanceof BlacklistRejection ? 'skipped' : 'error'
    errorMessage =
      err instanceof BlacklistRejection
        ? 'Redis diagnostic skipped by blacklist'
        : (err as Error).message
  }

  const durationMs = Math.round(performance.now() - start)

  if (outcome === 'timeout') {
    return {
      ...base,
      rowCount: 0,
      rows: [],
      status: 'timeout',
      reason: `exceeded ${input.timeoutMs}ms`,
      durationMs,
    }
  }
  if (outcome === 'error' || outcome === 'skipped') {
    return {
      ...base,
      rowCount: 0,
      rows: [],
      status: outcome,
      reason: errorMessage ?? 'unknown error',
      durationMs,
    }
  }
  const fetched = outcome.rows ?? []
  // Mask before truncation and before anything renders the evidence.
  const rows = input.blacklistValidator
    ? input.blacklistValidator.filterColumnsForTables(
        referencedTables,
        fetched,
        fetched[0] ? Object.keys(fetched[0]) : []
      ).filteredRows
    : fetched
  if (rows.length === 0) {
    return { ...base, rowCount: 0, rows: [], status: 'no-data', durationMs }
  }
  return {
    ...base,
    rowCount: rows.length,
    rows: rows.slice(0, input.maxRows),
    status: 'ok',
    durationMs,
  }
}
