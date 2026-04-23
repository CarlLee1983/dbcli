/**
 * DDL Generator factory and public exports
 */

import type { DDLGenerator } from './types'
import { PostgreSQLDDLGenerator } from './postgresql-ddl'
import { MySQLDDLGenerator } from './mysql-ddl'

export class DDLGeneratorFactory {
  static create(system: 'postgresql' | 'mysql' | 'mariadb'): DDLGenerator {
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
