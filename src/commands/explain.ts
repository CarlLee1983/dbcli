/**
 * `dbcli explain` — surfaces query plans across MySQL/MariaDB and PostgreSQL
 * with a unified row schema and severity-coded annotations.
 *
 * Single-query path: `dbcli explain "SELECT ..."` or `dbcli explain @saved-name`
 * Bulk path:         `dbcli explain --bulk @file.sql --format markdown`
 *
 * Read-only: EXPLAIN / ANALYZE SELECT / EXPLAIN (ANALYZE, BUFFERS) are
 * classified read-only since v1.23 P1, so this runs under query-only permission
 * without an upgrade.
 */

import { Command } from 'commander'
import { AdapterFactory, type SqlConnectionOptions, type SqlDatabaseSystem } from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { runQueryExplain } from '@/core/explain/runner'
import { resolveBulkInputs } from '@/core/explain/bulk-runner'
import { formatExplain, type ExplainFormat } from '@/formatters/explain'
import { loadSnippets, resolveSnippetDirs } from '@/core/saved-queries'
import type { ExplainPlan } from '@/core/explain/types'
import { assertAnalyzeReadOnlySql } from '@/core/explain/read-only'

type GlobalOpts = {
  config?: string
  env?: string
  yes?: boolean
}

export const explainCommand = new Command()
  .name('explain')
  .description('Show query plan with annotations (read-only)')
  .argument('[queries...]', 'one or more SQL strings or @saved-query/@file references')
  .option('--analyze', 'use EXPLAIN ANALYZE / ANALYZE SELECT', false)
  .option('--format <fmt>', 'output format: markdown | json | table', 'markdown')
  .option('--bulk <input>', 'comma-separated list of @file / @glob / @saved-query inputs')
  .action(async (queries: string[], options: Record<string, unknown>, command: Command) => {
    const globalOpts = command.parent?.opts<GlobalOpts>() ?? {}
    const configPath = resolveConfigPath(command, globalOpts)
    const config = await configModule.read(configPath)
    const connection = config.connection

    if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
      throw new Error(
        `dbcli explain requires a SQL connection (postgresql/mysql/mariadb), got: ${connection.system}`
      )
    }
    const system = connection.system as SqlDatabaseSystem

    const savedQueryLoader = makeSavedQueryLoader()

    const rawInputs =
      options.bulk !== undefined
        ? (options.bulk as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : queries

    const inputs = await resolveBulkInputs(rawInputs, {
      loadFromSavedQueries: savedQueryLoader,
    })

    if (inputs.length === 0) {
      throw new Error('No query provided. Pass a SQL string, @saved-query, or --bulk @file.sql.')
    }

    if (options.analyze === true) {
      for (const input of inputs) {
        assertAnalyzeReadOnlySql(input.sql, system)
      }
    }

    const adapter = AdapterFactory.createSqlAdapter(connection as SqlConnectionOptions)
    await adapter.connect()
    try {
      const plans: ExplainPlan[] = []
      for (const input of inputs) {
        const plan = await runQueryExplain(
          system,
          adapter,
          input.sql,
          { analyze: Boolean(options.analyze) },
          input.label
        )
        plans.push(plan)
      }

      const format = options.format as ExplainFormat
      console.log(formatExplain(plans, format))
    } finally {
      await adapter.disconnect()
    }
  })

/**
 * Build a saved-query loader that resolves a name (or glob) against the
 * project's saved-queries store. Returns null when no match — callers then
 * fall back to file-path resolution.
 *
 * Store keys carry a leading `@` (e.g. `@analytics/revenue`); the bulk-runner
 * strips `@` before calling here, so we compare against `@`-stripped keys.
 * SQL text lives at ResolvedSnippet.query.sqlBody (top snippet wins).
 */
function makeSavedQueryLoader() {
  return async (nameOrGlob: string): Promise<{ name: string; sql: string }[] | null> => {
    const snippetMap = await loadSnippets(resolveSnippetDirs(process.cwd()))
    const stripAt = (k: string) => k.replace(/^@/, '')

    if (nameOrGlob.includes('*')) {
      const regex = new RegExp(
        '^' + nameOrGlob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      )
      const entries: { name: string; sql: string }[] = []
      for (const [key, snippets] of snippetMap) {
        const name = stripAt(key)
        if (regex.test(name)) {
          const sql = snippets[0]?.query?.sqlBody ?? ''
          if (sql) entries.push({ name, sql })
        }
      }
      return entries.length > 0 ? entries : null
    }

    const direct = snippetMap.get(nameOrGlob) ?? snippetMap.get(`@${nameOrGlob}`)
    const sql = direct?.[0]?.query?.sqlBody
    if (!sql) return null
    return [{ name: nameOrGlob, sql }]
  }
}
