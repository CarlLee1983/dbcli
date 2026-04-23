import type { DatabaseAdapter, TableSchema, ColumnSchema } from '@/adapters/types'
import type {
  CheckReport,
  CheckType,
  NullCheckResult,
  OrphanCheckResult,
  DuplicateCheckResult,
  EmptyStringCheckResult,
} from '@/types/check'
import { getSizeCategory } from './size-category'

export interface CheckOptions {
  checks?: CheckType[]
  sample?: number
  blacklistedColumns?: Set<string>
}

export class HealthChecker {
  constructor(private adapter: DatabaseAdapter) {}

  async check(schema: TableSchema, options: CheckOptions = {}): Promise<CheckReport> {
    const checks = options.checks || ['nulls', 'duplicates', 'orphans', 'emptyStrings', 'rowCount']
    const sample = options.sample || 10_000
    const blacklisted = options.blacklistedColumns || new Set<string>()

    const visibleColumns = schema.columns.filter(
      (c) => !blacklisted.has(`${schema.name}.${c.name}`)
    )

    const countResult = await this.adapter.execute<{ count: number }>(
      `SELECT COUNT(*) as count FROM \`${schema.name}\``
    )
    const rowCount = countResult[0]?.count || 0

    const nulls: NullCheckResult[] = checks.includes('nulls')
      ? await this.checkNulls(schema.name, visibleColumns, rowCount, sample)
      : []

    const orphans: OrphanCheckResult[] = checks.includes('orphans')
      ? await this.checkOrphans(schema.name, visibleColumns)
      : []

    const duplicates: DuplicateCheckResult[] = checks.includes('duplicates')
      ? await this.checkDuplicates(schema.name, schema.indexes || [])
      : []

    const emptyStrings: EmptyStringCheckResult[] = checks.includes('emptyStrings')
      ? await this.checkEmptyStrings(schema.name, visibleColumns)
      : []

    const issues = orphans.length + duplicates.length
    const warnings = nulls.filter((n) => n.nullPercent > 50).length + emptyStrings.length
    const clean = Math.max(0, checks.length - (issues > 0 ? 1 : 0) - (warnings > 0 ? 1 : 0))

    return {
      table: schema.name,
      rowCount,
      sizeCategory: getSizeCategory(schema.estimatedRowCount),
      checks: { nulls, orphans, duplicates, emptyStrings },
      summary: { issues, warnings, clean },
      skippedColumns:
        blacklisted.size > 0
          ? Array.from(blacklisted).filter((c) => c.startsWith(`${schema.name}.`))
          : undefined,
    }
  }

  private async checkNulls(
    tableName: string,
    columns: ColumnSchema[],
    totalRows: number,
    sample: number
  ): Promise<NullCheckResult[]> {
    if (totalRows === 0) return []

    const nullableColumns = columns.filter((c) => c.nullable)
    const results: NullCheckResult[] = []

    for (const col of nullableColumns) {
      try {
        const useSample = totalRows > sample
        const sql = useSample
          ? `SELECT COUNT(*) - COUNT(\`${col.name}\`) as null_count FROM (SELECT \`${col.name}\` FROM \`${tableName}\` LIMIT ${sample}) sub`
          : `SELECT COUNT(*) - COUNT(\`${col.name}\`) as null_count FROM \`${tableName}\``

        const result = await this.adapter.execute<{ null_count: number }>(sql)
        const nullCount = result[0]?.null_count || 0

        if (nullCount > 0) {
          const sampleSize = Math.min(totalRows, sample)
          results.push({
            column: col.name,
            nullCount,
            nullPercent: Number(((nullCount / sampleSize) * 100).toFixed(1)),
          })
        }
      } catch {
        // Skip columns that fail
      }
    }

    return results
  }

  private async checkOrphans(
    tableName: string,
    columns: ColumnSchema[]
  ): Promise<OrphanCheckResult[]> {
    const fkColumns = columns.filter((c) => c.foreignKey)
    const results: OrphanCheckResult[] = []

    for (const col of fkColumns) {
      if (!col.foreignKey) continue
      try {
        const sql = `
          SELECT COUNT(*) as orphan_count
          FROM \`${tableName}\` child
          LEFT JOIN \`${col.foreignKey.table}\` parent
            ON child.\`${col.name}\` = parent.\`${col.foreignKey.column}\`
          WHERE child.\`${col.name}\` IS NOT NULL
            AND parent.\`${col.foreignKey.column}\` IS NULL
        `
        const result = await this.adapter.execute<{ orphan_count: number }>(sql)
        const orphanCount = result[0]?.orphan_count || 0

        if (orphanCount > 0) {
          results.push({
            column: col.name,
            references: `${col.foreignKey.table}.${col.foreignKey.column}`,
            orphanCount,
          })
        }
      } catch {
        // Skip if referenced table doesn't exist
      }
    }

    return results
  }

  private async checkDuplicates(
    tableName: string,
    indexes: Array<{ name: string; columns: string[]; unique: boolean }>
  ): Promise<DuplicateCheckResult[]> {
    const uniqueIndexes = indexes.filter((idx) => idx.unique)
    const results: DuplicateCheckResult[] = []

    for (const idx of uniqueIndexes) {
      try {
        const colList = idx.columns.map((c) => `\`${c}\``).join(', ')
        const sql = `
          SELECT COUNT(*) as dup_count FROM (
            SELECT ${colList}
            FROM \`${tableName}\`
            GROUP BY ${colList}
            HAVING COUNT(*) > 1
          ) dups
        `
        const result = await this.adapter.execute<{ dup_count: number }>(sql)
        const dupCount = result[0]?.dup_count || 0

        if (dupCount > 0) {
          results.push({
            columns: idx.columns,
            indexName: idx.name,
            duplicateCount: dupCount,
          })
        }
      } catch {
        // Skip if query fails
      }
    }

    return results
  }

  private async checkEmptyStrings(
    tableName: string,
    columns: ColumnSchema[]
  ): Promise<EmptyStringCheckResult[]> {
    const stringColumns = columns.filter((c) => /varchar|text|char/i.test(c.type))
    const results: EmptyStringCheckResult[] = []

    for (const col of stringColumns) {
      try {
        const sql = `SELECT COUNT(*) as empty_count FROM \`${tableName}\` WHERE \`${col.name}\` = ''`
        const result = await this.adapter.execute<{ empty_count: number }>(sql)
        const count = result[0]?.empty_count || 0

        if (count > 0) {
          results.push({ column: col.name, count })
        }
      } catch {
        // Skip columns that fail
      }
    }

    return results
  }
}
