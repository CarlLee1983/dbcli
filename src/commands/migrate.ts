/**
 * dbcli migrate command group
 * Schema DDL operations: CREATE/DROP/ALTER TABLE, INDEX, CONSTRAINT, ENUM
 *
 * All operations default to dry-run. Use --execute to actually run the SQL.
 * Destructive operations (DROP) require --force or interactive confirmation.
 */

import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import { AdapterFactory, ConnectionError } from '@/adapters'
import { DDLGeneratorFactory, parseColumnSpec } from '@/adapters/ddl'
import { DDLExecutor } from '@/core/ddl-executor'
import { BlacklistManager } from '@/core/blacklist-manager'
import type { DDLOperation, DDLExecutionOptions } from '@/types/ddl'
import type { ConstraintType } from '@/adapters/ddl/types'
import { resolveConfigPath } from '@/utils/config-path'

// ── Shared helpers ───────────────────────────────────────────────────────

export async function runDDL(operation: DDLOperation, opts: DDLExecutionOptions & { config?: string }): Promise<void> {
  const configPath = resolveConfigPath(undefined, opts)
  const config = await configModule.read(configPath)
  if (!config.connection) {
    throw new Error('Run "dbcli init" to configure database connection')
  }

  if (config.connection?.system === 'mongodb') {
    console.error('此命令目前不支援 MongoDB')
    process.exit(1)
  }

  const adapter = AdapterFactory.createAdapter(config.connection)
  
  // Skip connection for dry-run if we don't need to refresh schema
  const isDryRun = !opts.execute
  if (!isDryRun) {
    await adapter.connect()
  }

  try {
    const generator = DDLGeneratorFactory.create(config.connection.system)
    const blacklistManager = new BlacklistManager(config)
    const executor = new DDLExecutor(adapter, generator, config.permission, blacklistManager)

    const result = await executor.execute(operation, {
      execute: opts.execute,
      force: opts.force
    })

    // Output JSON result
    console.log(JSON.stringify({
      status: result.status,
      operation: result.operation,
      dryRun: result.dryRun,
      sql: result.sql || undefined,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
      error: result.error || undefined,
      timestamp: result.timestamp
    }, null, 2))

    if (result.status === 'error') {
      process.exit(1)
    }
  } finally {
    if (!isDryRun) {
      await adapter.disconnect()
    }
  }
}

function handleError(error: unknown): void {
  if (error instanceof ConnectionError) {
    console.error(`Connection failed: ${error.message}`)
  } else {
    console.error(JSON.stringify({
      status: 'error',
      error: (error as Error).message
    }, null, 2))
  }
  process.exit(1)
}

// Global options inherited by all subcommands
function addExecOpts(cmd: Command): Command {
  return cmd
    .option('--execute', 'Actually execute the SQL (default: dry-run)')
    .option('--force', 'Skip confirmation for destructive operations')
    .option('--config <path>', 'Path to .dbcli config', '.dbcli')
}

// ── Command registration ─────────────────────────────────────────────────

export const migrateCommand = new Command('migrate')
  .description(t('migrate.description'))

// create <table>
addExecOpts(
  migrateCommand
    .command('create <table>')
    .description(t('migrate.create_description'))
    .option('--column <spec...>', 'Column definitions (e.g., "id:serial:pk" "name:varchar(50):not-null")')
).action(async (table: string, opts) => {
  try {
    const specs: string[] = opts.column || []
    if (specs.length === 0) {
      console.error('At least one --column is required')
      process.exit(1)
    }
    const columns = specs.map(parseColumnSpec)
    await runDDL({ kind: 'createTable', table, columns }, opts)
  } catch (e) { handleError(e) }
})

// drop <table>
addExecOpts(
  migrateCommand
    .command('drop <table>')
    .description(t('migrate.drop_description'))
).action(async (table: string, opts) => {
  try {
    await runDDL({ kind: 'dropTable', table }, opts)
  } catch (e) { handleError(e) }
})

// add-column <table> <column> <type>
addExecOpts(
  migrateCommand
    .command('add-column <table> <column> <type>')
    .description(t('migrate.add_column_description'))
    .option('--nullable', 'Allow NULL values')
    .option('--default <value>', 'Default value')
    .option('--unique', 'Add UNIQUE constraint')
).action(async (table: string, column: string, type: string, opts) => {
  try {
    await runDDL({
      kind: 'addColumn', table,
      column: {
        name: column, type,
        nullable: opts.nullable ?? true,
        default: opts.default,
        unique: opts.unique
      }
    }, opts)
  } catch (e) { handleError(e) }
})

// drop-column <table> <column>
addExecOpts(
  migrateCommand
    .command('drop-column <table> <column>')
    .description(t('migrate.drop_column_description'))
).action(async (table: string, column: string, opts) => {
  try {
    await runDDL({ kind: 'dropColumn', table, column }, opts)
  } catch (e) { handleError(e) }
})

// alter-column <table> <column>
addExecOpts(
  migrateCommand
    .command('alter-column <table> <column>')
    .description(t('migrate.alter_column_description'))
    .option('--type <type>', 'Change column type')
    .option('--rename <name>', 'Rename column')
    .option('--set-default <value>', 'Set default value')
    .option('--drop-default', 'Remove default value')
    .option('--set-nullable', 'Allow NULL')
    .option('--drop-nullable', 'Disallow NULL')
).action(async (table: string, column: string, opts) => {
  try {
    await runDDL({
      kind: 'alterColumn',
      options: {
        table, column,
        type: opts.type,
        rename: opts.rename,
        setDefault: opts.setDefault,
        dropDefault: opts.dropDefault,
        setNullable: opts.setNullable,
        dropNullable: opts.dropNullable
      }
    }, opts)
  } catch (e) { handleError(e) }
})

// add-index <table>
addExecOpts(
  migrateCommand
    .command('add-index <table>')
    .description(t('migrate.add_index_description'))
    .requiredOption('--columns <cols>', 'Comma-separated column names')
    .option('--unique', 'Create unique index')
    .option('--type <type>', 'Index type (btree, hash, gin, gist)')
    .option('--name <name>', 'Custom index name')
).action(async (table: string, opts) => {
  try {
    const columns = opts.columns.split(',').map((c: string) => c.trim())
    await runDDL({
      kind: 'addIndex',
      index: { table, columns, unique: opts.unique, type: opts.type, name: opts.name }
    }, opts)
  } catch (e) { handleError(e) }
})

// drop-index <index>
addExecOpts(
  migrateCommand
    .command('drop-index <index>')
    .description(t('migrate.drop_index_description'))
    .option('--table <table>', 'Table name (required for MySQL/MariaDB)')
).action(async (indexName: string, opts) => {
  try {
    await runDDL({ kind: 'dropIndex', indexName, table: opts.table }, opts)
  } catch (e) { handleError(e) }
})

// add-constraint <table>
addExecOpts(
  migrateCommand
    .command('add-constraint <table>')
    .description(t('migrate.add_constraint_description'))
    .option('--fk <column>', 'Foreign key column')
    .option('--references <table.column>', 'Referenced table.column')
    .option('--on-delete <action>', 'ON DELETE action (cascade, set null, restrict, no action)')
    .option('--unique <columns>', 'Unique constraint columns (comma-separated)')
    .option('--check <expression>', 'Check constraint expression')
    .option('--name <name>', 'Custom constraint name')
).action(async (table: string, opts) => {
  try {
    let type: ConstraintType
    let op: DDLOperation

    if (opts.fk) {
      if (!opts.references) {
        console.error('--references is required with --fk')
        process.exit(1)
      }
      const [refTable, refColumn] = opts.references.split('.')
      if (!refTable || !refColumn) {
        console.error('--references must be in format "table.column"')
        process.exit(1)
      }
      type = 'foreign_key'
      op = {
        kind: 'addConstraint',
        constraint: {
          table, type, column: opts.fk, name: opts.name,
          references: { table: refTable, column: refColumn },
          onDelete: opts.onDelete
        }
      }
    } else if (opts.unique) {
      type = 'unique'
      const columns = opts.unique.split(',').map((c: string) => c.trim())
      op = {
        kind: 'addConstraint',
        constraint: { table, type, columns, name: opts.name }
      }
    } else if (opts.check) {
      type = 'check'
      op = {
        kind: 'addConstraint',
        constraint: { table, type, expression: opts.check, name: opts.name }
      }
    } else {
      console.error('Specify one of: --fk, --unique, --check')
      process.exit(1)
      return
    }

    await runDDL(op, opts)
  } catch (e) { handleError(e) }
})

// drop-constraint <table> <constraint>
addExecOpts(
  migrateCommand
    .command('drop-constraint <table> <constraint>')
    .description(t('migrate.drop_constraint_description'))
).action(async (table: string, constraintName: string, opts) => {
  try {
    await runDDL({ kind: 'dropConstraint', table, constraintName }, opts)
  } catch (e) { handleError(e) }
})

// add-enum <name> <values...>
addExecOpts(
  migrateCommand
    .command('add-enum <name> <values...>')
    .description(t('migrate.add_enum_description'))
).action(async (name: string, values: string[], opts) => {
  try {
    await runDDL({ kind: 'addEnum', definition: { name, values } }, opts)
  } catch (e) { handleError(e) }
})

// alter-enum <name>
addExecOpts(
  migrateCommand
    .command('alter-enum <name>')
    .description(t('migrate.alter_enum_description'))
    .requiredOption('--add-value <value>', 'Value to add')
).action(async (name: string, opts) => {
  try {
    await runDDL({ kind: 'alterEnum', name, addValue: opts.addValue }, opts)
  } catch (e) { handleError(e) }
})

// drop-enum <name>
addExecOpts(
  migrateCommand
    .command('drop-enum <name>')
    .description(t('migrate.drop_enum_description'))
).action(async (name: string, opts) => {
  try {
    await runDDL({ kind: 'dropEnum', name }, opts)
  } catch (e) { handleError(e) }
})
