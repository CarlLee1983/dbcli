import type { DatabaseAdapter } from '@/adapters/types'
import {
  prepareExecution,
  SavedQueryError,
  type EngineTag,
  type ResolvedSnippet,
} from '@/core/saved-queries'
import { engineFamily } from '@/core/saved-queries/strategies'
import type { EvidenceItem } from './types'

export interface RunDiagnosticInput {
  snippet: ResolvedSnippet
  adapter: DatabaseAdapter
  engine: EngineTag
  timeoutMs: number
  maxRows: number
}

/**
 * Runs a single snippet and always returns an EvidenceItem — never throws.
 * Statuses: ok / no-data / skipped (engine mismatch, prepare error) / error /
 * timeout. Rows are truncated to `maxRows`; `rowCount` reports the true count.
 */
export async function runDiagnostic(input: RunDiagnosticInput): Promise<EvidenceItem> {
  const meta = input.snippet.query.meta
  const base: Pick<EvidenceItem, 'snippet' | 'intent' | 'description'> = {
    snippet: meta.key,
    intent: meta.intent ?? '',
    description: meta.description ?? '',
  }

  let prepared
  try {
    prepared = prepareExecution(input.snippet, { engine: input.engine, noLimit: false }, {}, {})
  } catch (err) {
    const reason =
      err instanceof SavedQueryError ? err.message : `prepare failed: ${(err as Error).message}`
    return { ...base, rowCount: 0, rows: [], status: 'skipped', reason, durationMs: 0 }
  }

  const family = engineFamily(input.engine)
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

  let outcome: { rows: Array<Record<string, unknown>> } | 'timeout' | 'error'
  let errorMessage: string | null = null
  try {
    outcome = (await Promise.race([exec, timer])) as
      | { rows: Array<Record<string, unknown>> }
      | 'timeout'
  } catch (err) {
    outcome = 'error'
    errorMessage = (err as Error).message
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
  if (outcome === 'error') {
    return {
      ...base,
      rowCount: 0,
      rows: [],
      status: 'error',
      reason: errorMessage ?? 'unknown error',
      durationMs,
    }
  }
  const rows = outcome.rows ?? []
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
