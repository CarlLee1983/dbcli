/**
 * MySQL/MariaDB DDL generator
 * Generates MySQL-dialect DDL SQL statements
 */

import type {
  DDLGenerator,
  DDLResult,
  ColumnDefinition,
  AlterColumnOptions,
  IndexDefinition,
  ConstraintDefinition,
  EnumDefinition,
} from './types'

function q(name: string): string {
  return `\`${name}\``
}

function columnSQL(col: ColumnDefinition): string {
  const parts: string[] = [q(col.name)]

  // MySQL has no SERIAL shorthand — expand to BIGINT UNSIGNED AUTO_INCREMENT
  const lowerType = col.type.toLowerCase()
  if (lowerType === 'serial') {
    parts.push('BIGINT UNSIGNED NOT NULL AUTO_INCREMENT')
    return parts.join(' ')
  }
  if (lowerType === 'bigserial') {
    parts.push('BIGINT UNSIGNED NOT NULL AUTO_INCREMENT')
    return parts.join(' ')
  }
  if (lowerType === 'smallserial') {
    parts.push('SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT')
    return parts.join(' ')
  }

  parts.push(col.type.toUpperCase())

  if (col.autoIncrement) {
    parts.push('AUTO_INCREMENT')
  }

  if (col.nullable === false) {
    parts.push('NOT NULL')
  }

  if (col.default !== undefined) {
    parts.push(`DEFAULT ${col.default}`)
  }

  if (col.unique) {
    parts.push('UNIQUE')
  }

  if (col.references) {
    parts.push(`REFERENCES ${q(col.references.table)}(${q(col.references.column)})`)
  }

  return parts.join(' ')
}

export class MySQLDDLGenerator implements DDLGenerator {
  // ── Table ──────────────────────────────────────────────────────────────

  createTable(table: string, columns: ColumnDefinition[]): DDLResult {
    const warnings: string[] = []
    const pkCols = columns.filter((c) => c.primaryKey)
    const colDefs = columns.map((c) => columnSQL(c))

    if (pkCols.length > 0) {
      colDefs.push(`PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(', ')})`)
    }

    const sql = `CREATE TABLE ${q(table)} (\n  ${colDefs.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    return { sql, warnings }
  }

  dropTable(table: string): DDLResult {
    return { sql: `DROP TABLE ${q(table)};`, warnings: [] }
  }

  // ── Column ─────────────────────────────────────────────────────────────

  addColumn(table: string, column: ColumnDefinition): DDLResult {
    return {
      sql: `ALTER TABLE ${q(table)} ADD COLUMN ${columnSQL(column)};`,
      warnings: [],
    }
  }

  dropColumn(table: string, column: string): DDLResult {
    return {
      sql: `ALTER TABLE ${q(table)} DROP COLUMN ${q(column)};`,
      warnings: [],
    }
  }

  alterColumn(options: AlterColumnOptions): DDLResult {
    const statements: string[] = []
    const warnings: string[] = []
    const t = q(options.table)
    const c = q(options.column)

    if (options.type) {
      // MySQL MODIFY COLUMN requires full column definition
      const nullable = options.dropNullable ? ' NOT NULL' : ''
      const def = options.setDefault !== undefined ? ` DEFAULT ${options.setDefault}` : ''
      statements.push(
        `ALTER TABLE ${t} MODIFY COLUMN ${c} ${options.type.toUpperCase()}${nullable}${def};`
      )
      warnings.push('MySQL MODIFY COLUMN resets column attributes not explicitly specified')
    } else {
      if (options.setDefault !== undefined) {
        statements.push(`ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${options.setDefault};`)
      }

      if (options.dropDefault) {
        statements.push(`ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT;`)
      }

      if (options.setNullable) {
        warnings.push(
          'MySQL requires MODIFY COLUMN with full type to change nullability — use --type to specify'
        )
      }

      if (options.dropNullable) {
        warnings.push(
          'MySQL requires MODIFY COLUMN with full type to change nullability — use --type to specify'
        )
      }
    }

    if (options.rename) {
      statements.push(`ALTER TABLE ${t} RENAME COLUMN ${c} TO ${q(options.rename)};`)
    }

    if (statements.length === 0 && warnings.length === 0) {
      warnings.push('No alter operations specified')
    }

    return { sql: statements.join('\n'), warnings }
  }

  // ── Index ──────────────────────────────────────────────────────────────

  addIndex(index: IndexDefinition): DDLResult {
    const unique = index.unique ? 'UNIQUE ' : ''
    const name = index.name || `idx_${index.table}_${index.columns.join('_')}`
    const using = index.type ? ` USING ${index.type.toUpperCase()}` : ''
    const cols = index.columns.map(q).join(', ')

    return {
      sql: `CREATE ${unique}INDEX ${q(name)} ON ${q(index.table)} (${cols})${using};`,
      warnings: [],
    }
  }

  dropIndex(indexName: string, table?: string): DDLResult {
    const onTable = table ? ` ON ${q(table)}` : ''
    return {
      sql: `DROP INDEX ${q(indexName)}${onTable};`,
      warnings: table ? [] : ['MySQL requires ON <table> — specify table for this operation'],
    }
  }

  // ── Constraint ─────────────────────────────────────────────────────────

  addConstraint(constraint: ConstraintDefinition): DDLResult {
    const t = q(constraint.table)
    const warnings: string[] = []

    switch (constraint.type) {
      case 'foreign_key': {
        const name = constraint.name || `fk_${constraint.table}_${constraint.column}`
        const onDelete = constraint.onDelete
          ? ` ON DELETE ${constraint.onDelete.toUpperCase().replace('_', ' ')}`
          : ''
        return {
          sql: `ALTER TABLE ${t} ADD CONSTRAINT ${q(name)} FOREIGN KEY (${q(constraint.column!)}) REFERENCES ${q(constraint.references!.table)}(${q(constraint.references!.column)})${onDelete};`,
          warnings,
        }
      }
      case 'unique': {
        const name = constraint.name || `uq_${constraint.table}_${constraint.columns!.join('_')}`
        const cols = constraint.columns!.map(q).join(', ')
        return {
          sql: `ALTER TABLE ${t} ADD CONSTRAINT ${q(name)} UNIQUE (${cols});`,
          warnings,
        }
      }
      case 'check': {
        const name = constraint.name || `ck_${constraint.table}`
        return {
          sql: `ALTER TABLE ${t} ADD CONSTRAINT ${q(name)} CHECK (${constraint.expression});`,
          warnings: ['CHECK constraints enforced in MySQL 8.0.16+ and MariaDB 10.2.1+ only'],
        }
      }
    }
  }

  dropConstraint(table: string, constraintName: string): DDLResult {
    return {
      sql: `ALTER TABLE ${q(table)} DROP CONSTRAINT ${q(constraintName)};`,
      warnings: [],
    }
  }

  // ── Enum ───────────────────────────────────────────────────────────────

  addEnum(_definition: EnumDefinition): DDLResult {
    return {
      sql: '',
      warnings: [
        "MySQL has no standalone ENUM type — use ENUM in column definition instead (e.g., \"status:enum('a','b'):not-null\")",
      ],
    }
  }

  alterEnum(_name: string, _addValue: string): DDLResult {
    return {
      sql: '',
      warnings: [
        'MySQL has no standalone ENUM type — use ALTER TABLE MODIFY COLUMN to change enum values',
      ],
    }
  }

  dropEnum(_name: string): DDLResult {
    return {
      sql: '',
      warnings: ['MySQL has no standalone ENUM type — nothing to drop'],
    }
  }
}
