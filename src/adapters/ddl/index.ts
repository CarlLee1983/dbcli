/**
 * DDL Generator factory and public exports
 */

import type { SqlDatabaseSystem } from '@/adapters/types'
import type { DDLGenerator } from './types'
import { PostgreSQLDDLGenerator } from './postgresql-ddl'
import { MySQLDDLGenerator } from './mysql-ddl'

export class DDLGeneratorFactory {
  // SQLite has no generator: its ALTER TABLE supports a small subset of
  // operations and a column change is a table rebuild, so `migrate` is
  // `unsupported` for it in ENGINE_CAPABILITIES rather than half-implemented.
  // The refusal is here so a caller that reaches this anyway is told why.
  static create(system: SqlDatabaseSystem): DDLGenerator {
    switch (system) {
      case 'postgresql':
        return new PostgreSQLDDLGenerator()
      case 'mysql':
      case 'mariadb':
        return new MySQLDDLGenerator()
      default:
        throw new Error(`Unsupported database system for DDL: ${system}`)
    }
  }
}

export { PostgreSQLDDLGenerator, MySQLDDLGenerator }
export { parseColumnSpec } from './column-parser'
export type {
  DDLGenerator,
  DDLResult,
  ColumnDefinition,
  AlterColumnOptions,
  IndexDefinition,
  ConstraintDefinition,
  ConstraintType,
  EnumDefinition,
} from './types'
