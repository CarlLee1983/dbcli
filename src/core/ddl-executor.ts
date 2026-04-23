/**
 * DDL Executor — orchestrates DDL operations with safety checks
 *
 * Pipeline: permission → blacklist → generate SQL → dry-run/execute → schema refresh
 */

import type { DatabaseAdapter } from '@/adapters/types'
import type { DDLGenerator } from '@/adapters/ddl/types'
import type { Permission } from '@/types'
import type { BlacklistManager } from '@/core/blacklist-manager'
import type { SchemaCacheManager } from '@/core/schema-cache'
import type { DDLOperation, DDLExecutionOptions, DDLExecutionResult } from '@/types/ddl'
import { getOperationTable, isDestructiveOperation } from '@/types/ddl'
import { promptUser } from '@/utils/prompts'

export class DDLExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DDLExecutionError'
    Object.setPrototypeOf(this, DDLExecutionError.prototype)
  }
}

export class DDLExecutor {
  constructor(
    private adapter: DatabaseAdapter,
    private generator: DDLGenerator,
    private permission: Permission,
    private blacklistManager?: BlacklistManager,
    private schemaCache?: SchemaCacheManager
  ) {}

  async execute(
    operation: DDLOperation,
    options: DDLExecutionOptions = {}
  ): Promise<DDLExecutionResult> {
    const timestamp = new Date().toISOString()
    const dryRun = !options.execute

    try {
      // 1. Permission check — DDL requires admin
      if (this.permission !== 'admin') {
        return {
          status: 'error',
          operation: operation.kind,
          sql: '',
          warnings: [],
          timestamp,
          dryRun,
          error: `Permission denied: DDL operations require admin permission (current: ${this.permission})`,
        }
      }

      // 2. Blacklist check
      const table = getOperationTable(operation)
      if (table && this.blacklistManager?.isTableBlacklisted(table)) {
        return {
          status: 'error',
          operation: operation.kind,
          sql: '',
          warnings: [],
          timestamp,
          dryRun,
          error: `Table "${table}" is blacklisted — DDL operations are blocked`,
        }
      }

      // 3. Generate SQL
      const { sql, warnings } = this.generateSQL(operation)

      if (!sql) {
        return {
          status: 'success',
          operation: operation.kind,
          sql: '',
          warnings,
          timestamp,
          dryRun: true,
        }
      }

      // 4. Dry-run mode — return SQL without executing
      if (dryRun) {
        return {
          status: 'success',
          operation: operation.kind,
          sql,
          warnings,
          timestamp,
          dryRun: true,
        }
      }

      // 5. Destructive operations require confirmation
      if (isDestructiveOperation(operation) && !options.force) {
        const confirmed = await promptUser.confirm(
          `This is a destructive operation (${operation.kind}). Proceed?`
        )
        if (!confirmed) {
          return {
            status: 'success',
            operation: operation.kind,
            sql,
            warnings: [...warnings, 'Operation cancelled by user'],
            timestamp,
            dryRun: false,
          }
        }
      }

      // 6. Execute SQL (may contain multiple statements separated by ;)
      // Split by semicolons at end of statements, not within statements
      const statements = sql
        .split(/;\s*\n/)
        .map((s) => s.trim().replace(/;$/, ''))
        .filter((s) => s.length > 0)
      for (const stmt of statements) {
        await this.adapter.execute(stmt)
      }

      // 7. Schema refresh for table-affecting operations
      if (table) {
        await this.refreshSchema(operation, table)
      }

      return {
        status: 'success',
        operation: operation.kind,
        sql,
        warnings,
        timestamp,
        dryRun: false,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        status: 'error',
        operation: operation.kind,
        sql: '',
        warnings: [],
        timestamp,
        dryRun,
        error: `DDL execution failed: ${errorMessage}`,
      }
    }
  }

  private generateSQL(operation: DDLOperation) {
    switch (operation.kind) {
      case 'createTable':
        return this.generator.createTable(operation.table, operation.columns)
      case 'dropTable':
        return this.generator.dropTable(operation.table)
      case 'addColumn':
        return this.generator.addColumn(operation.table, operation.column)
      case 'dropColumn':
        return this.generator.dropColumn(operation.table, operation.column)
      case 'alterColumn':
        return this.generator.alterColumn(operation.options)
      case 'addIndex':
        return this.generator.addIndex(operation.index)
      case 'dropIndex':
        return this.generator.dropIndex(operation.indexName, operation.table)
      case 'addConstraint':
        return this.generator.addConstraint(operation.constraint)
      case 'dropConstraint':
        return this.generator.dropConstraint(operation.table, operation.constraintName)
      case 'addEnum':
        return this.generator.addEnum(operation.definition)
      case 'alterEnum':
        return this.generator.alterEnum(operation.name, operation.addValue)
      case 'dropEnum':
        return this.generator.dropEnum(operation.name)
    }
  }

  private async refreshSchema(operation: DDLOperation, table: string): Promise<void> {
    if (!this.schemaCache) return

    try {
      if (operation.kind === 'dropTable') {
        this.schemaCache.invalidateTable(table)
      } else {
        const schema = await this.adapter.getTableSchema(table)
        this.schemaCache.refreshTable(table, schema)
      }
    } catch {
      // Schema refresh failure is non-fatal
    }
  }
}
