/**
 * Schema Optimizer - Performance Diagnostics and Recommendations
 *
 * Analyzes schema structure and provides recommendations for:
 * - Schema design improvements
 * - Performance optimizations
 * - Potential issues
 */

import type { TableSchema } from '@/adapters/types'

/**
 * Optimization issue - detected problem or warning
 */
export interface OptimizationIssue {
  /** Issue severity: error, warning, info */
  severity: 'error' | 'warning' | 'info'
  /** Issue type/category */
  type: string
  /** Human-readable message */
  message: string
  /** Table affected (if applicable) */
  table?: string
  /** Column affected (if applicable) */
  column?: string
  /** Recommended action */
  recommendation?: string
}

/**
 * Schema report - analysis results
 */
export interface SchemaReport {
  /** Total tables analyzed */
  totalTables: number
  /** Total columns analyzed */
  totalColumns: number
  /** Average columns per table */
  averageColumnsPerTable: number
  /** Detected issues */
  issues: OptimizationIssue[]
  /** Performance metrics */
  metrics: {
    maxColumnsInTable: number
    tableWithMostColumns?: string
    maxColumnNameLength: number
    averageColumnNameLength: number
  }
  /** Cache recommendations */
  cacheRecommendations: {
    recommendedHotTables: string[]
    reason: string
  }
}

/**
 * Schema Optimizer - analyzes and provides optimization recommendations
 *
 * Scans schema structure to identify:
 * - Potential performance issues (too many columns, long names)
 * - Design issues (missing primary keys, all nullable columns)
 * - Hot table recommendations based on complexity
 */
export class SchemaOptimizer {
  /**
   * Analyze schema and generate report
   *
   * @param schemas Map of table name → TableSchema
   * @returns SchemaReport with analysis and recommendations
   */
  analyzeSchema(schemas: Record<string, TableSchema>): SchemaReport {
    const issues: OptimizationIssue[] = []
    const tableNames = Object.keys(schemas)
    let totalColumns = 0
    let maxColumnsInTable = 0
    let tableWithMostColumns: string | undefined
    let maxColumnNameLength = 0
    let totalColumnNameLength = 0

    // Analyze each table
    for (const [tableName, table] of Object.entries(schemas)) {
      const columnCount = table.columns.length
      totalColumns += columnCount

      // Track metrics
      if (columnCount > maxColumnsInTable) {
        maxColumnsInTable = columnCount
        tableWithMostColumns = tableName
      }

      // Check for empty table
      if (columnCount === 0) {
        issues.push({
          severity: 'warning',
          type: 'empty-table',
          message: `Table "${tableName}" has no columns`,
          table: tableName,
          recommendation: 'Consider removing empty tables'
        })
      }

      // Check for too many columns (performance concern)
      if (columnCount > 50) {
        issues.push({
          severity: 'warning',
          type: 'wide-table',
          message: `Table "${tableName}" has ${columnCount} columns (exceeds recommendation)`,
          table: tableName,
          recommendation: 'Consider normalizing table structure'
        })
      }

      // Check for missing primary key
      const hasPrimaryKey = table.columns.some(c => c.primaryKey)
      if (!hasPrimaryKey) {
        issues.push({
          severity: 'warning',
          type: 'no-primary-key',
          message: `Table "${tableName}" has no primary key`,
          table: tableName,
          recommendation: 'Add a primary key for optimal performance'
        })
      }

      // Check columns
      let allNullable = true
      for (const column of table.columns) {
        totalColumnNameLength += column.name.length
        if (column.name.length > maxColumnNameLength) {
          maxColumnNameLength = column.name.length
        }

        // Check for very long column names
        if (column.name.length > 50) {
          issues.push({
            severity: 'info',
            type: 'long-column-name',
            message: `Column "${column.name}" in table "${tableName}" has very long name`,
            table: tableName,
            column: column.name,
            recommendation: 'Consider using shorter column names'
          })
        }

        // Track nullable status
        if (!column.nullable) {
          allNullable = false
        }
      }

      // Check if all columns are nullable (unusual pattern)
      if (allNullable && table.columns.length > 0) {
        issues.push({
          severity: 'info',
          type: 'all-nullable',
          message: `Table "${tableName}" has all nullable columns`,
          table: tableName,
          recommendation: 'Ensure at least some columns are NOT NULL'
        })
      }
    }

    const averageColumnsPerTable = tableNames.length > 0 ? totalColumns / tableNames.length : 0
    const averageColumnNameLength = totalColumns > 0 ? totalColumnNameLength / totalColumns : 0

    // Determine hot tables (for caching)
    const recommendedHotTables = this.selectHotTables(schemas, Math.ceil(tableNames.length * 0.2))

    const report: SchemaReport = {
      totalTables: tableNames.length,
      totalColumns,
      averageColumnsPerTable: Math.round(averageColumnsPerTable * 100) / 100,
      issues,
      metrics: {
        maxColumnsInTable,
        tableWithMostColumns,
        maxColumnNameLength,
        averageColumnNameLength: Math.round(averageColumnNameLength * 100) / 100
      },
      cacheRecommendations: {
        recommendedHotTables,
        reason: 'Most frequently accessed tables should be cached in hot storage'
      }
    }

    return report
  }

  /**
   * Select hot tables based on complexity heuristics
   *
   * Hot tables are those that are likely to be frequently accessed
   * Selection criteria:
   * - Primary keys (often queried)
   * - Moderate complexity (not too wide, not too narrow)
   * - Named as entities (users, products, etc.)
   *
   * @param schemas Map of table name → TableSchema
   * @param maxCount Maximum tables to select
   * @returns Array of table names recommended for hot storage
   */
  private selectHotTables(schemas: Record<string, TableSchema>, maxCount: number): string[] {
    const candidates = Object.entries(schemas).map(([tableName, table]) => {
      let score = 0

      // Has primary key (+3 points)
      if (table.columns.some(c => c.primaryKey)) {
        score += 3
      }

      // Moderate column count - not too wide (+2 points)
      if (table.columns.length >= 5 && table.columns.length <= 30) {
        score += 2
      }

      // Simple names suggest frequent access (+1 point)
      if (tableName.length < 20) {
        score += 1
      }

      return { tableName, score }
    })

    // Sort by score descending and take top maxCount
    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCount)
      .map(c => c.tableName)
  }

  /**
   * Get optimization suggestions
   *
   * Returns human-readable suggestions based on analysis
   *
   * @param report SchemaReport from analyzeSchema
   * @returns Array of suggestion strings
   */
  getSuggestions(report: SchemaReport): string[] {
    const suggestions: string[] = []

    if (report.issues.length === 0) {
      suggestions.push('Schema is well-optimized')
      return suggestions
    }

    // Group issues by type
    const issuesByType = new Map<string, OptimizationIssue[]>()
    for (const issue of report.issues) {
      if (!issuesByType.has(issue.type)) {
        issuesByType.set(issue.type, [])
      }
      issuesByType.get(issue.type)!.push(issue)
    }

    // Generate suggestions from issues
    if (issuesByType.has('wide-table')) {
      const count = issuesByType.get('wide-table')!.length
      suggestions.push(
        `${count} table(s) have too many columns. Consider normalizing table structures.`
      )
    }

    if (issuesByType.has('no-primary-key')) {
      const count = issuesByType.get('no-primary-key')!.length
      suggestions.push(`${count} table(s) missing primary keys. Add them for better performance.`)
    }

    if (issuesByType.has('empty-table')) {
      suggestions.push('Remove or properly populate empty tables')
    }

    if (report.cacheRecommendations.recommendedHotTables.length > 0) {
      suggestions.push(
        `Cache these hot tables: ${report.cacheRecommendations.recommendedHotTables.join(', ')}`
      )
    }

    return suggestions
  }

  /**
   * Estimate schema size in memory
   *
   * Rough estimate of how much memory schema would consume
   *
   * @param schemas Map of table name → TableSchema
   * @returns Estimated size in bytes
   */
  estimateSchemaSize(schemas: Record<string, TableSchema>): number {
    let totalSize = 0

    for (const [tableName, table] of Object.entries(schemas)) {
      // Table name
      totalSize += tableName.length

      // Columns
      for (const column of table.columns) {
        totalSize += column.name.length + column.type.length
        if (column.default) {
          totalSize += JSON.stringify(column.default).length
        }
      }
    }

    // Add ~30% overhead for metadata and structure
    return Math.ceil(totalSize * 1.3)
  }
}
