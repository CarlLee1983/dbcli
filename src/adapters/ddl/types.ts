/**
 * DDL Generator type definitions and interfaces
 * Defines the contract for cross-database DDL SQL generation
 */

// ---------------------------------------------------------------------------
// Column Definition
// ---------------------------------------------------------------------------

export interface ColumnDefinition {
  name: string
  type: string
  nullable?: boolean
  default?: string
  primaryKey?: boolean
  unique?: boolean
  autoIncrement?: boolean
  references?: { table: string; column: string }
}

// ---------------------------------------------------------------------------
// Index / Constraint / Enum Definitions
// ---------------------------------------------------------------------------

export interface IndexDefinition {
  table: string
  columns: string[]
  unique?: boolean
  type?: 'btree' | 'hash' | 'gin' | 'gist'
  name?: string
}

export type ConstraintType = 'foreign_key' | 'unique' | 'check'

export interface ConstraintDefinition {
  table: string
  type: ConstraintType
  name?: string
  /** Foreign key: source column */
  column?: string
  /** Foreign key: referenced table.column */
  references?: { table: string; column: string }
  /** Foreign key: ON DELETE action */
  onDelete?: 'cascade' | 'set null' | 'restrict' | 'no action'
  /** Unique constraint: columns */
  columns?: string[]
  /** Check constraint: expression */
  expression?: string
}

export interface EnumDefinition {
  name: string
  values: string[]
}

// ---------------------------------------------------------------------------
// DDL Result
// ---------------------------------------------------------------------------

export interface DDLResult {
  sql: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Alter Column Options
// ---------------------------------------------------------------------------

export interface AlterColumnOptions {
  table: string
  column: string
  type?: string
  rename?: string
  setDefault?: string
  dropDefault?: boolean
  setNullable?: boolean
  dropNullable?: boolean
}

// ---------------------------------------------------------------------------
// DDL Generator Interface
// ---------------------------------------------------------------------------

export interface DDLGenerator {
  // Table operations
  createTable(table: string, columns: ColumnDefinition[]): DDLResult
  dropTable(table: string): DDLResult

  // Column operations
  addColumn(table: string, column: ColumnDefinition): DDLResult
  dropColumn(table: string, column: string): DDLResult
  alterColumn(options: AlterColumnOptions): DDLResult

  // Index operations
  addIndex(index: IndexDefinition): DDLResult
  dropIndex(indexName: string, table?: string): DDLResult

  // Constraint operations
  addConstraint(constraint: ConstraintDefinition): DDLResult
  dropConstraint(table: string, constraintName: string): DDLResult

  // Enum operations
  addEnum(definition: EnumDefinition): DDLResult
  alterEnum(name: string, addValue: string): DDLResult
  dropEnum(name: string): DDLResult
}
