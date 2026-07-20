import crypto from 'node:crypto'
import { resolve } from 'node:path'
import { Command } from 'commander'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { configModule } from '@/core/config'
import type { ColumnSchema, SqlDatabaseSystem, TableSchema } from '@/adapters/types'
import { detectOrmFormat, type OrmFormat } from '@/core/orm-drift/adapters/detect'
import { parseDdl, parseDdlFiles } from '@/core/orm-drift/adapters/ddl'
import { parseDrizzleSnapshot } from '@/core/orm-drift/adapters/drizzle'
import { parsePrismaSchema } from '@/core/orm-drift/adapters/prisma'
import { compareNormalized, type DriftReport } from '@/core/orm-drift/compare'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import {
  normalizedSchemaZod,
  type NormalizedSchema,
  type OrmSource,
} from '@/core/orm-drift/normalized-schema'
import { formatDrift, type DriftFormat } from '@/formatters/orm-drift'
import { validateFormat, type DbcliConfig } from '@/utils/validation'

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!['postgresql', 'mysql', 'mariadb'].includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

const ALLOWED_FORMATS = ['json', 'table'] as const
const DRIFT_FORMATS = ['json', 'table', 'markdown'] as const
const ORM_FORMATS = ['prisma', 'ddl', 'json', 'drizzle', 'typeorm', 'sequelize'] as const
const ORM_ALIASES = {
  typeorm: { defaultIgnore: ['typeorm_metadata', 'migrations'] },
  sequelize: { defaultIgnore: ['SequelizeMeta'] },
} as const satisfies Record<string, { defaultIgnore: readonly string[] }>

type OrmAlias = keyof typeof ORM_ALIASES
type DriftOrmFormat = OrmFormat | OrmAlias

export interface DriftOptions {
  ormFormat?: DriftOrmFormat
  ignore?: string
}

export interface DiffActionOptions {
  snapshot?: string
  against?: string
  againstOrm?: string[] | string
  ormFormat?: string
  ignore?: string
  recovery?: boolean
  format: string
  config: string
}

export function parseAgainstOrmValues(values: string[] | string): string[] {
  const rawValues = Array.isArray(values) ? values : [values]
  const paths = rawValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0) {
    throw new Error('At least one ORM schema input is required')
  }
  return uniquePaths
}

function hasGlobMagic(path: string): boolean {
  return /[*?[\]{}!]/.test(path)
}

export async function expandOrmPaths(inputs: string[] | string): Promise<string[]> {
  const paths = parseAgainstOrmValues(inputs)
  const expanded = new Set<string>()

  for (const path of paths) {
    if (!hasGlobMagic(path)) {
      expanded.add(resolve(path))
      continue
    }

    const matches = await Array.fromAsync(
      new Bun.Glob(path).scan({
        cwd: process.cwd(),
        absolute: true,
        onlyFiles: true,
      })
    )
    if (matches.length === 0) {
      throw new Error(`ORM schema glob matched no files: ${path}`)
    }
    for (const match of matches) expanded.add(resolve(match))
  }

  return [...expanded].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function parseOrmFormat(value: string | undefined): DriftOrmFormat | undefined {
  if (value === undefined) return undefined
  validateFormat(value, ORM_FORMATS, 'diff --orm-format')
  return value as DriftOrmFormat
}

function mergeNormalizedSchemas(schemas: NormalizedSchema[]): NormalizedSchema {
  const first = schemas[0]
  if (!first) throw new Error('At least one ORM schema input is required')

  return normalizedSchemaZod.parse({
    source: first.source,
    ...(first.defaultSchema !== undefined && { defaultSchema: first.defaultSchema }),
    tables: schemas.flatMap((schema) => schema.tables),
    unparsed: schemas.flatMap((schema) => schema.unparsed),
  })
}

export async function runDrift(
  paths: string[],
  options: DriftOptions,
  config: DbcliConfig
): Promise<{ report: DriftReport }> {
  const system = config.connection?.system
  if (!system || !['postgresql', 'mysql', 'mariadb'].includes(system)) {
    throw new Error(`This command requires a SQL connection, got: ${system ?? 'none'}`)
  }

  const cached = (config.schema ?? {}) as Record<string, TableSchema>
  if (Object.keys(cached).length === 0) {
    throw new Error("Schema cache is empty. Run 'dbcli schema' first.")
  }

  const ormFormat = parseOrmFormat(options.ormFormat)
  const includesGlob = parseAgainstOrmValues(paths).some(hasGlobMagic)
  const expandedPaths = await expandOrmPaths(paths)
  const inputs: Array<{ path: string; content: string; format: DriftOrmFormat }> = []

  for (const path of expandedPaths) {
    if (path.toLowerCase().endsWith('.ts')) {
      throw new Error(
        "Drizzle/TypeORM TypeScript sources are not parsed directly. Run 'drizzle-kit generate' and pass drizzle/meta/<NNNN>_snapshot.json (or export DDL) instead."
      )
    }
    const file = Bun.file(path)
    if (!(await file.exists())) throw new Error(`ORM schema file not found: ${path}`)
    const content = await file.text()
    inputs.push({
      path,
      content,
      format: ormFormat ?? detectOrmFormat(path, content),
    })
  }

  if (inputs.length > 1 && inputs.some((input) => input.format !== 'ddl')) {
    throw new Error('Multiple ORM schema files are supported only for DDL inputs')
  }
  if (includesGlob && inputs.some((input) => input.format !== 'ddl')) {
    throw new Error('Glob ORM schema inputs are supported only for DDL')
  }

  const merged =
    inputs[0]?.format === 'ddl'
      ? parseDdlFiles(
          inputs.map((input) => input.content),
          system as SqlDatabaseSystem
        )
      : mergeNormalizedSchemas(
          inputs.map(({ content, format }) => {
            if (format === 'prisma') return parsePrismaSchema(content)
            if (format === 'ddl' || format in ORM_ALIASES) {
              return parseDdl(content, system as SqlDatabaseSystem)
            }
            if (format === 'drizzle') return parseDrizzleSnapshot(JSON.parse(content))
            const parsed = normalizedSchemaZod.parse(JSON.parse(content))
            return { ...parsed, source: 'json' as const }
          })
        )
  const alias = ormFormat && ormFormat in ORM_ALIASES ? (ormFormat as OrmAlias) : undefined
  const orm = alias ? { ...merged, source: alias as OrmSource } : merged
  const ignore = (options.ignore ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
  const db = normalizeDbSchema(
    cached,
    system === 'postgresql' ? { defaultSchema: 'public' } : undefined
  )

  return {
    report: compareNormalized(orm, db, {
      ignore,
      extraDefaultIgnore: alias ? [...ORM_ALIASES[alias].defaultIgnore] : undefined,
    }),
  }
}

export function validateDiffModes(options: {
  snapshot?: string
  against?: string
  againstOrm?: string[] | string
}): 'snapshot' | 'against' | 'againstOrm' {
  const modes = [
    options.snapshot ? 'snapshot' : undefined,
    options.against ? 'against' : undefined,
    Array.isArray(options.againstOrm)
      ? options.againstOrm.length > 0
        ? 'againstOrm'
        : undefined
      : options.againstOrm !== undefined
        ? 'againstOrm'
        : undefined,
  ].filter(Boolean) as Array<'snapshot' | 'against' | 'againstOrm'>

  if (modes.length > 1) {
    throw new Error('Choose exactly one of --snapshot, --against, or --against-orm')
  }
  if (modes.length === 0) {
    throw new Error(
      'Specify --snapshot <path> to save, --against <path> to compare, or --against-orm <path> for ORM drift'
    )
  }
  return modes[0]!
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

export interface SchemaSnapshot {
  tables: Record<
    string,
    {
      name: string
      columns: ColumnSchema[]
      indexes?: Array<{ name: string; columns: string[]; unique: boolean }>
    }
  >
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

  const addedTables = Array.from(afterTables).filter((t) => !beforeTables.has(t))
  const removedTables = Array.from(beforeTables).filter((t) => !afterTables.has(t))

  const addedColumns: DiffColumnEntry[] = []
  const removedColumns: DiffColumnEntry[] = []
  const modifiedColumns: DiffModifiedColumn[] = []
  const indexChanges: DiffIndexEntry[] = []

  for (const tableName of addedTables) {
    const added = after.tables[tableName]
    if (!added) continue
    for (const col of added.columns) {
      addedColumns.push({
        table: tableName,
        column: col.name,
        type: col.type,
        nullable: col.nullable,
      })
    }
  }

  for (const tableName of removedTables) {
    const removed = before.tables[tableName]
    if (!removed) continue
    for (const col of removed.columns) {
      removedColumns.push({ table: tableName, column: col.name, type: col.type })
    }
  }

  const commonTables = Array.from(afterTables).filter((t) => beforeTables.has(t))

  for (const tableName of commonTables) {
    const beforeTable = before.tables[tableName]
    const afterTable = after.tables[tableName]
    if (!beforeTable || !afterTable) continue

    const beforeColMap = new Map(beforeTable.columns.map((c) => [c.name, c]))
    const afterColMap = new Map(afterTable.columns.map((c) => [c.name, c]))

    for (const [name, col] of afterColMap) {
      if (!beforeColMap.has(name)) {
        addedColumns.push({
          table: tableName,
          column: name,
          type: col.type,
          nullable: col.nullable,
        })
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

    const beforeIndexes = new Map((beforeTable.indexes || []).map((i) => [i.name, i]))
    const afterIndexes = new Map((afterTable.indexes || []).map((i) => [i.name, i]))

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
  .option(
    '--against-orm <paths>',
    'Compare ORM schema definition(s), repeatable or comma-separated; DDL supports globs',
    collectOption,
    []
  )
  .option('--orm-format <fmt>', 'Force ORM input format: prisma | ddl | json | drizzle')
  .option('--ignore <globs>', 'Comma-separated table globs excluded from drift')
  .option(
    '--format <format>',
    'Output format: json (default), table, or markdown (ORM drift only)',
    'json'
  )
  .option('--config <path>', 'Path to .dbcli config file', '.dbcli')
  .option(
    '--recovery',
    'On failure, emit a structured recovery envelope to stdout (suppresses human stderr message)',
    false
  )
  .action(diffAction)

export async function diffAction(options: DiffActionOptions): Promise<void> {
  const driftMode =
    (Array.isArray(options.againstOrm)
      ? options.againstOrm.length > 0
      : options.againstOrm !== undefined) === true

  try {
    const mode = validateDiffModes(options)

    if (mode === 'againstOrm') {
      validateFormat(options.format, DRIFT_FORMATS, 'diff --against-orm')
      const ormFormat = parseOrmFormat(options.ormFormat)
      const config = await configModule.read(options.config)
      const paths = parseAgainstOrmValues(options.againstOrm ?? [])
      const { report } = await runDrift(
        paths,
        { ...(ormFormat !== undefined && { ormFormat }), ignore: options.ignore },
        config
      )
      console.log(formatDrift(report, options.format as DriftFormat))
      process.exitCode = report.summary.errors > 0 ? 1 : 0
      return
    }

    validateFormat(options.format, ALLOWED_FORMATS, 'diff')

    const config = await configModule.read(options.config)
    if (!config.connection) {
      console.error('Database not configured. Run: dbcli init')
      process.exit(1)
    }

    if (config.connection?.system === 'mongodb') {
      console.error('此命令目前不支援 MongoDB')
      process.exit(1)
    }

    if (config.connection?.system === 'redis') {
      console.error('Redis 不支援 diff 指令（key/value 並無固定 schema 概念）')
      process.exit(1)
    }

    if (config.connection?.system === 'elasticsearch') {
      console.error(
        'Elasticsearch 不支援 diff 指令；如需追蹤 mapping 變化，請改用 schema 並自行版本化 mapping JSON'
      )
      process.exit(1)
    }

    const adapter = AdapterFactory.createSqlAdapter(
      requireSqlConnection(config.connection as ConnectionOptions)
    )
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
        console.error(
          `Snapshot saved to ${options.snapshot} (${Object.keys(currentSnapshot.tables).length} tables)`
        )
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
          console.log(
            `\nSchema diff (${beforeSnapshot.createdAt} -> ${currentSnapshot.createdAt}):`
          )
          if (result.added.tables.length > 0)
            console.log(`\n  Added tables: ${result.added.tables.join(', ')}`)
          if (result.removed.tables.length > 0)
            console.log(`\n  Removed tables: ${result.removed.tables.join(', ')}`)
          if (result.added.columns.length > 0) {
            console.log(`\n  Added columns:`)
            for (const c of result.added.columns)
              console.log(`    ${c.table}.${c.column} (${c.type})`)
          }
          if (result.removed.columns.length > 0) {
            console.log(`\n  Removed columns:`)
            for (const c of result.removed.columns)
              console.log(`    ${c.table}.${c.column} (${c.type})`)
          }
          if (result.modified.columns.length > 0) {
            console.log(`\n  Modified columns:`)
            for (const c of result.modified.columns)
              console.log(`    ${c.table}.${c.column}: ${c.before.type} -> ${c.after.type}`)
          }
          if (result.modified.indexes.length > 0) {
            console.log(`\n  Index changes:`)
            for (const i of result.modified.indexes)
              console.log(`    ${i.table}.${i.name}: ${i.change}`)
          }
          console.log(
            `\n  Summary: +${result.summary.added} -${result.summary.removed} ~${result.summary.modified}`
          )
        }
      }
    } finally {
      await adapter.disconnect()
    }
  } catch (error) {
    if (driftMode && options.recovery === true) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(error, { operation: 'diff' }, { envelopeId: crypto.randomUUID() })
    }

    if (error instanceof Error) {
      console.error(error.message)
      if (error instanceof ConnectionError) {
        error.hints.forEach((hint: string) => console.error(`   Hint: ${hint}`))
      }
    }
    process.exit(1)
  }
}
