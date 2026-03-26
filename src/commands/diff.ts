import { Command } from 'commander'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { configModule } from '@/core/config'
import type { ColumnSchema } from '@/adapters/types'

export interface SchemaSnapshot {
  tables: Record<string, {
    name: string
    columns: ColumnSchema[]
    indexes?: Array<{ name: string; columns: string[]; unique: boolean }>
  }>
  createdAt: string
}

interface DiffColumnEntry {
  table: string
  column: string
  type: string
  nullable?: boolean
}

interface DiffModifiedColumn {
  table: string
  column: string
  before: { type: string; nullable: boolean }
  after: { type: string; nullable: boolean }
}

interface DiffIndexEntry {
  table: string
  name: string
  change: 'added' | 'removed'
}

export interface DiffResult {
  added: { tables: string[]; columns: DiffColumnEntry[] }
  removed: { tables: string[]; columns: DiffColumnEntry[] }
  modified: { columns: DiffModifiedColumn[]; indexes: DiffIndexEntry[] }
  summary: { added: number; removed: number; modified: number }
}

export function compareSnapshots(before: SchemaSnapshot, after: SchemaSnapshot): DiffResult {
  const beforeTables = new Set(Object.keys(before.tables))
  const afterTables = new Set(Object.keys(after.tables))

  const addedTables = Array.from(afterTables).filter(t => !beforeTables.has(t))
  const removedTables = Array.from(beforeTables).filter(t => !afterTables.has(t))

  const addedColumns: DiffColumnEntry[] = []
  const removedColumns: DiffColumnEntry[] = []
  const modifiedColumns: DiffModifiedColumn[] = []
  const indexChanges: DiffIndexEntry[] = []

  for (const tableName of addedTables) {
    for (const col of after.tables[tableName].columns) {
      addedColumns.push({ table: tableName, column: col.name, type: col.type, nullable: col.nullable })
    }
  }

  for (const tableName of removedTables) {
    for (const col of before.tables[tableName].columns) {
      removedColumns.push({ table: tableName, column: col.name, type: col.type })
    }
  }

  const commonTables = Array.from(afterTables).filter(t => beforeTables.has(t))

  for (const tableName of commonTables) {
    const beforeTable = before.tables[tableName]
    const afterTable = after.tables[tableName]

    const beforeColMap = new Map(beforeTable.columns.map(c => [c.name, c]))
    const afterColMap = new Map(afterTable.columns.map(c => [c.name, c]))

    for (const [name, col] of afterColMap) {
      if (!beforeColMap.has(name)) {
        addedColumns.push({ table: tableName, column: name, type: col.type, nullable: col.nullable })
      }
    }

    for (const [name, col] of beforeColMap) {
      if (!afterColMap.has(name)) {
        removedColumns.push({ table: tableName, column: name, type: col.type })
      }
    }

    for (const [name, afterCol] of afterColMap) {
      const beforeCol = beforeColMap.get(name)
      if (!beforeCol) continue
      if (
        beforeCol.type.toLowerCase() !== afterCol.type.toLowerCase() ||
        beforeCol.nullable !== afterCol.nullable
      ) {
        modifiedColumns.push({
          table: tableName,
          column: name,
          before: { type: beforeCol.type, nullable: beforeCol.nullable },
          after: { type: afterCol.type, nullable: afterCol.nullable },
        })
      }
    }

    const beforeIndexes = new Map((beforeTable.indexes || []).map(i => [i.name, i]))
    const afterIndexes = new Map((afterTable.indexes || []).map(i => [i.name, i]))

    for (const name of afterIndexes.keys()) {
      if (!beforeIndexes.has(name)) {
        indexChanges.push({ table: tableName, name, change: 'added' })
      }
    }
    for (const name of beforeIndexes.keys()) {
      if (!afterIndexes.has(name)) {
        indexChanges.push({ table: tableName, name, change: 'removed' })
      }
    }
  }

  return {
    added: { tables: addedTables, columns: addedColumns },
    removed: { tables: removedTables, columns: removedColumns },
    modified: { columns: modifiedColumns, indexes: indexChanges },
    summary: {
      added: addedTables.length + addedColumns.length,
      removed: removedTables.length + removedColumns.length,
      modified: modifiedColumns.length + indexChanges.length,
    },
  }
}

export const diffCommand = new Command()
  .name('diff')
  .description('Compare schema snapshots to detect changes')
  .option('--snapshot <path>', 'Save current schema snapshot to file')
  .option('--against <path>', 'Compare current schema against a snapshot file')
  .option('--format <format>', 'Output format: json (default) or table', 'json')
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
  .action(diffAction)

async function diffAction(options: {
  snapshot?: string
  against?: string
  format: string
  config: string
}) {
  try {
    if (!options.snapshot && !options.against) {
      console.error('Specify --snapshot <path> to save, or --against <path> to compare')
      process.exit(1)
    }

    const config = await configModule.read(options.config)
    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    const adapter = AdapterFactory.createAdapter(config.connection)
    await adapter.connect()

    try {
      const tables = await adapter.listTables()
      const currentSnapshot: SchemaSnapshot = {
        tables: {},
        createdAt: new Date().toISOString(),
      }

      for (const t of tables) {
        if (t.tableType === 'view') continue
        const schema = await adapter.getTableSchema(t.name)
        currentSnapshot.tables[t.name] = {
          name: schema.name,
          columns: schema.columns,
          indexes: schema.indexes || [],
        }
      }

      if (options.snapshot) {
        await Bun.write(options.snapshot, JSON.stringify(currentSnapshot, null, 2))
        console.error(`Snapshot saved to ${options.snapshot} (${Object.keys(currentSnapshot.tables).length} tables)`)
        return
      }

      if (options.against) {
        const beforeFile = Bun.file(options.against)
        if (!(await beforeFile.exists())) {
          console.error(`Snapshot file not found: ${options.against}`)
          process.exit(1)
        }
        const beforeSnapshot: SchemaSnapshot = JSON.parse(await beforeFile.text())
        const result = compareSnapshots(beforeSnapshot, currentSnapshot)

        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2))
        } else {
          console.log(`\nSchema diff (${beforeSnapshot.createdAt} -> ${currentSnapshot.createdAt}):`)
          if (result.added.tables.length > 0) console.log(`\n  Added tables: ${result.added.tables.join(', ')}`)
          if (result.removed.tables.length > 0) console.log(`\n  Removed tables: ${result.removed.tables.join(', ')}`)
          if (result.added.columns.length > 0) {
            console.log(`\n  Added columns:`)
            for (const c of result.added.columns) console.log(`    ${c.table}.${c.column} (${c.type})`)
          }
          if (result.removed.columns.length > 0) {
            console.log(`\n  Removed columns:`)
            for (const c of result.removed.columns) console.log(`    ${c.table}.${c.column} (${c.type})`)
          }
          if (result.modified.columns.length > 0) {
            console.log(`\n  Modified columns:`)
            for (const c of result.modified.columns) console.log(`    ${c.table}.${c.column}: ${c.before.type} -> ${c.after.type}`)
          }
          if (result.modified.indexes.length > 0) {
            console.log(`\n  Index changes:`)
            for (const i of result.modified.indexes) console.log(`    ${i.table}.${i.name}: ${i.change}`)
          }
          console.log(`\n  Summary: +${result.summary.added} -${result.summary.removed} ~${result.summary.modified}`)
        }
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message)
      if (error instanceof ConnectionError) {
        error.hints.forEach((hint: string) => console.error(`   Hint: ${hint}`))
      }
    }
    process.exit(1)
  }
}
