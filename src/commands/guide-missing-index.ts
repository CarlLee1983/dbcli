// src/commands/guide-missing-index.ts
/**
 * `dbcli guide missing-index-for "<SQL>"` — per-query composite-index advisor.
 *
 * Reuses P2's explain runner (via the analyzer's explain-enricher) and the
 * saved-query loader pattern from `src/commands/explain.ts`. Read-only: only
 * runs EXPLAIN + information_schema/pg_indexes lookups.
 */

import { Command } from 'commander'
import { AdapterFactory, type SqlConnectionOptions } from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { loadSnippets, resolveSnippetDirs } from '@/core/saved-queries'
import { analyzeMissingIndex } from '@/core/guide/missing-index'
import { parseSelect } from '@/core/guide/missing-index/parse-sql'
import { extract } from '@/core/guide/missing-index/sql-extractor'
import { makeIndexIntrospector } from '@/core/guide/missing-index/index-introspector'
import { makeExplainEnricher } from '@/core/guide/missing-index/explain-enricher'
import { formatMissingIndex, type MissingIndexFormat } from '@/formatters/guide'
import type { Confidence } from '@/core/guide/missing-index/types'

type SavedQueryLoader = (name: string) => Promise<{ name: string; sql: string }[] | null>

const FORMATS: MissingIndexFormat[] = ['yaml', 'json', 'markdown']
const CONFIDENCES: Confidence[] = ['low', 'medium', 'high']

/** Resolve one input (raw SQL or single @saved-query) to a SQL string. */
export async function resolveSingleQuery(
  input: string | undefined,
  loader: SavedQueryLoader
): Promise<string> {
  const raw = (input ?? '').trim()
  if (!raw) throw new Error('No query provided. Pass a SQL string or @saved-query.')
  if (!raw.startsWith('@')) return raw
  const ref = raw.slice(1)
  const hits = await loader(ref)
  if (!hits || hits.length === 0) throw new Error(`Saved query '${ref}' not found`)
  return hits[0].sql
}

function makeSavedQueryLoader(): SavedQueryLoader {
  return async (name: string) => {
    const snippetMap = await loadSnippets(resolveSnippetDirs(process.cwd()))
    const direct = snippetMap.get(name) ?? snippetMap.get(`@${name}`)
    const sql = direct?.[0]?.query?.sqlBody
    return sql ? [{ name, sql }] : null
  }
}

export function registerMissingIndexCommand(parent: Command): Command {
  parent
    .command('missing-index-for')
    .description('Suggest composite indexes for a single SELECT (read-only)')
    .argument('<query>', 'SQL string or @saved-query reference')
    .option('--format <fmt>', `output format: ${FORMATS.join(' | ')}`, 'yaml')
    .option('--min-confidence <level>', `drop candidates below: ${CONFIDENCES.join(' | ')}`)
    .action(async (query: string, options: Record<string, unknown>, command: Command) => {
      const format = options.format as MissingIndexFormat
      if (!FORMATS.includes(format)) {
        console.error(`Unknown format '${format}'. Allowed: ${FORMATS.join(', ')}`)
        process.exit(1)
      }
      const minConfidence = options.minConfidence as Confidence | undefined
      if (minConfidence && !CONFIDENCES.includes(minConfidence)) {
        console.error(`Unknown --min-confidence '${minConfidence}'. Allowed: ${CONFIDENCES.join(', ')}`)
        process.exit(1)
      }

      // guide (parent) is itself a top-level command on `program`, so the
      // global program opts are two levels up from this subcommand.
      const globalOpts = command.parent?.parent?.opts<{ config?: string; env?: string }>() ?? {}
      const configPath = resolveConfigPath(command, globalOpts)
      const config = await configModule.read(configPath)
      const connection = config.connection

      if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
        console.error(
          `dbcli guide missing-index-for requires a SQL connection (postgresql/mysql/mariadb), got: ${connection.system}`
        )
        process.exit(1)
      }
      const system = connection.system as SqlConnectionOptions['system']

      const sql = await resolveSingleQuery(query, makeSavedQueryLoader())

      const adapter = AdapterFactory.createSqlAdapter(connection as SqlConnectionOptions)
      await adapter.connect()
      try {
        const report = await analyzeMissingIndex(
          sql,
          {
            system,
            parseSelect,
            extract,
            getExistingIndexes: makeIndexIntrospector(adapter),
            enrich: makeExplainEnricher(system, adapter),
          },
          { minConfidence }
        )
        console.log(formatMissingIndex(report, format))
      } finally {
        await adapter.disconnect()
      }
    })

  return parent
}
