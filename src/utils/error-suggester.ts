/**
 * Error suggestion utility for intelligent error handling
 * Suggests similar table names when a query fails with table-not-found errors
 */

import type { DatabaseAdapter } from '../adapters/types'
import { levenshteinDistance } from './levenshtein-distance'

/**
 * Result of error analysis with suggestions
 */
export interface ErrorSuggestion {
  /** Array of suggested table names (up to 3, sorted by distance) */
  suggestions: string[]
  /** All available table names (for fallback reference) */
  tables: string[]
}

/**
 * Analyzes error messages and suggests similar table names
 * Extracts the missing table name from database error messages and suggests
 * similar table names using Levenshtein distance.
 *
 * Handles error message formats from:
 * - PostgreSQL: relation "table_name" does not exist
 * - MySQL/MariaDB: table `table_name` doesn't exist, Table not found
 *
 * @param errorMessage The error message from the database
 * @param adapter Database adapter to list available tables
 * @returns Object with suggestions (closest matches) and tables (all available)
 */
export async function suggestTableName(
  errorMessage: string,
  adapter: DatabaseAdapter
): Promise<ErrorSuggestion> {
  try {
    // Extract table name from error message
    const extractedTableName = extractTableNameFromError(errorMessage)

    if (!extractedTableName) {
      // Could not extract table name, return all tables
      const allTables = await getAllTablesFromAdapter(adapter)
      return {
        suggestions: [],
        tables: allTables
      }
    }

    // Get all available tables
    const allTables = await getAllTablesFromAdapter(adapter)

    if (allTables.length === 0) {
      return {
        suggestions: [],
        tables: []
      }
    }

    // Calculate distances and filter for suggestions
    const distances = allTables
      .map(tableName => ({
        name: tableName,
        distance: levenshteinDistance(extractedTableName.toLowerCase(), tableName.toLowerCase())
      }))
      .filter(item => item.distance < 3) // Only suggest if distance < 3
      .sort((a, b) => a.distance - b.distance) // Sort by distance (closest first)
      .slice(0, 3) // Keep top 3 suggestions

    return {
      suggestions: distances.map(d => d.name),
      tables: allTables
    }
  } catch (error) {
    // If anything goes wrong, return empty suggestions but try to list tables
    console.warn('Error generating table suggestions:', error)
    try {
      const allTables = await getAllTablesFromAdapter(adapter)
      return {
        suggestions: [],
        tables: allTables
      }
    } catch {
      return {
        suggestions: [],
        tables: []
      }
    }
  }
}

/**
 * Extracts table name from database error message
 * Supports PostgreSQL and MySQL error formats with various quote styles
 *
 * Patterns:
 * - relation "table_name" does not exist
 * - relation 'table_name' does not exist
 * - table `table_name` not found
 * - table "table_name" not found
 * - table 'table_name' not found
 *
 * @param errorMessage Error message from database
 * @returns Extracted table name or null if not found
 */
function extractTableNameFromError(errorMessage: string): string | null {
  // PostgreSQL format: relation "table" or relation 'table' or relation `table`
  const pgMatch = errorMessage.match(/relation\s+['""`](\w+)['""`]/i)
  if (pgMatch && pgMatch[1]) {
    return pgMatch[1] as string
  }

  // MySQL format: table `table` or table "table" or table 'table'
  const mysqlMatch = errorMessage.match(/table\s+['""`](\w+)['""`]/i)
  if (mysqlMatch && mysqlMatch[1]) {
    return mysqlMatch[1] as string
  }

  return null
}

/**
 * Helper to safely get all tables from adapter
 * Handles adapter failures gracefully
 *
 * @param adapter Database adapter
 * @returns Array of table names, empty array if error
 */
async function getAllTablesFromAdapter(adapter: DatabaseAdapter): Promise<string[]> {
  try {
    const tables = await adapter.listTables()
    return tables.map(t => t.name)
  } catch (error) {
    console.warn('Failed to list tables for suggestions:', error)
    return []
  }
}
