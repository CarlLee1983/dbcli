/**
 * The gate every SQL-shaped command puts its connection through.
 *
 * It existed seven times over as a private copy of the same three-element
 * literal, one per command file. The copies were invisible to the compiler —
 * `SqlDatabaseSystem` gained `sqlite`, `SqlConnectionOptions` widened with it,
 * and all seven literals kept refusing SQLite while the capability matrix said
 * the commands supported it. Nothing failed to build; the commands just said
 * no.
 *
 * `migrate`, `diff`, `shell`, `check`, `lint` and `explain` keep their own
 * narrower guards on purpose: those refuse SQLite for reasons of their own
 * (no DDL generator, no snapshot support, no REPL) rather than because SQLite
 * is not SQL, and folding them in here would silently claim them.
 */

import { SQL_DATABASE_SYSTEMS } from '@/adapters/types'
import type { ConnectionOptions, SqlConnectionOptions } from '@/adapters'

export function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!(SQL_DATABASE_SYSTEMS as readonly string[]).includes(connection.system)) {
    throw new Error(`This command requires a SQL connection, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}
