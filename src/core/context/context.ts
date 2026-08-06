import { configModule } from '@/core/config'
import { BlacklistManager } from '@/core/blacklist-manager'
import { loadSnippets } from '@/core/saved-queries/loader'
import { resolveSnippetDirs } from '@/core/saved-queries/snippet-paths'
import type { TableSchema } from '@/adapters/types'
import type { ResolvedSnippet } from '@/core/saved-queries/types'
import { loadSemanticContext, type SemanticContext } from '@/core/semantic'
import type { DbcliConfig } from '@/utils/validation'

export interface CompactColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey?: boolean
  default?: string
  foreignKey?: {
    table: string
    column: string
  }
}

export interface CompactTable {
  name: string
  columns: CompactColumn[]
  rowCount?: number
  primaryKey?: string[]
  foreignKeys?: Array<{
    columns: string[]
    refTable: string
    refColumns: string[]
  }>
}

export interface CompactSnippet {
  key: string
  description?: string
  params: Array<{
    name: string
    type: string
    required?: boolean
    default?: string | number | boolean | null
  }>
  engines?: string[]
}

export interface ContextPayload {
  version: string
  system: string
  permission: string
  blacklist: {
    tables: string[]
    columns: Record<string, string[]>
  }
  schema: Record<string, CompactTable>
  snippets: CompactSnippet[]
  semantic?: SemanticContext
}

/**
 * Build the only schema view agent-facing context may consume. Blacklist
 * filtering occurs before semantic validation, so hidden objects cannot be
 * named by a semantic model.
 */
export function compactVisibleSchema(
  config: Pick<DbcliConfig, 'schema' | 'blacklist'>
): Record<string, CompactTable> {
  const blacklistManager = new BlacklistManager(config as DbcliConfig)
  const compactSchema: Record<string, CompactTable> = {}
  const rawSchema = (config.schema ?? {}) as Record<string, TableSchema>

  for (const [tableName, tableSchema] of Object.entries(rawSchema)) {
    if (blacklistManager.isTableBlacklisted(tableName)) continue

    const columns: CompactColumn[] = []
    for (const col of tableSchema.columns || []) {
      if (blacklistManager.isColumnBlacklisted(tableName, col.name)) continue

      const compactCol: CompactColumn = {
        name: col.name,
        type: col.type,
        nullable: col.nullable,
      }
      if (col.primaryKey) compactCol.primaryKey = true
      if (col.default !== undefined) compactCol.default = col.default
      if (col.foreignKey) {
        compactCol.foreignKey = {
          table: col.foreignKey.table,
          column: col.foreignKey.column,
        }
      }
      columns.push(compactCol)
    }

    const compactTable: CompactTable = {
      name: tableSchema.name || tableName,
      columns,
    }
    const rowCount = tableSchema.estimatedRowCount ?? tableSchema.rowCount
    if (rowCount !== undefined) compactTable.rowCount = rowCount
    if (tableSchema.primaryKey && tableSchema.primaryKey.length > 0) {
      compactTable.primaryKey = tableSchema.primaryKey
    }
    if (tableSchema.foreignKeys && tableSchema.foreignKeys.length > 0) {
      compactTable.foreignKeys = tableSchema.foreignKeys.map((fk) => ({
        columns: fk.columns,
        refTable: fk.refTable,
        refColumns: fk.refColumns,
      }))
    }
    compactSchema[tableName] = compactTable
  }

  return compactSchema
}

export async function gatherContext(
  workspaceRoot: string,
  configPath: string,
  options: { includeSemantic?: boolean } = {}
): Promise<ContextPayload> {
  const config = await configModule.read(configPath)

  // 1. Gather Connection & Permission Info
  const system = config.connection?.system ?? 'unknown'
  const permission = config.permission ?? 'query-only'
  const version = config.metadata?.version ?? '1.0'

  // 2. Gather Blacklist Configuration
  const blacklistTables: string[] = []
  const blacklistColumns: Record<string, string[]> = {}

  if (config.blacklist?.tables) {
    blacklistTables.push(...config.blacklist.tables)
  }
  if (config.blacklist?.columns) {
    for (const [table, cols] of Object.entries(config.blacklist.columns)) {
      blacklistColumns[table] = [...cols]
    }
  }

  // 3. Process & filter schema cache before exposing it to agents.
  const compactSchema = compactVisibleSchema(config)

  // 4. Gather Snippets
  const dirs = resolveSnippetDirs(workspaceRoot)
  let snippetsMap: Map<string, ResolvedSnippet[]>
  try {
    snippetsMap = await loadSnippets(dirs)
  } catch {
    snippetsMap = new Map()
  }

  const compactSnippets: CompactSnippet[] = []
  for (const [key, variants] of snippetsMap.entries()) {
    // Get the first variant matching the current system engine if possible, otherwise use the first available
    const matched =
      variants.find((v) => {
        const engs = v.query.meta.engine ?? []
        return engs.includes(system as any)
      }) ?? variants[0]

    if (matched) {
      const q = matched.query
      compactSnippets.push({
        key,
        description: q.meta.description,
        params: (q.meta.params ?? []).map((p) => ({
          name: p.name,
          type: p.type,
          ...(p.required ? { required: true } : {}),
          ...(p.default !== undefined ? { default: p.default } : {}),
        })),
        engines: q.meta.engine,
      })
    }
  }

  const payload: ContextPayload = {
    version,
    system,
    permission,
    blacklist: {
      tables: blacklistTables,
      columns: blacklistColumns,
    },
    schema: compactSchema,
    snippets: compactSnippets.sort((a, b) => a.key.localeCompare(b.key)),
  }

  if (options.includeSemantic !== false) {
    const semantic = await loadSemanticContext({
      workspaceRoot,
      schema: compactSchema,
      snippets: compactSnippets,
      missingFile: 'allow',
    })
    if (semantic) payload.semantic = semantic
  }

  return payload
}
