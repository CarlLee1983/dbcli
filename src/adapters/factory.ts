/**
 * Database adapter factory for system-aware instantiation
 * Routes to correct adapter implementation based on database system type
 */

import type { ConnectionOptions, DatabaseAdapter } from './types'
import { PostgreSQLAdapter } from './postgresql-adapter'
import { MySQLAdapter } from './mysql-adapter'

/**
 * Factory for creating database adapters
 * Implements factory pattern to route to correct adapter based on system type
 * Enables system-aware instantiation without coupling CLI commands to specific drivers
 */
export class AdapterFactory {
  /**
   * Create a database adapter instance based on connection options
   * Routes to PostgreSQL or MySQL adapter depending on system type
   * MySQL adapter handles both MySQL and MariaDB (compatible drivers)
   *
   * @param options Connection configuration including system type
   * @returns DatabaseAdapter instance for the specified system
   * @throws {Error} If database system type is unsupported
   */
  static createAdapter(options: ConnectionOptions): DatabaseAdapter {
    switch (options.system) {
      case 'postgresql':
        return new PostgreSQLAdapter(options)
      case 'mysql':
      case 'mariadb':
        return new MySQLAdapter(options)
      default:
        throw new Error(`Unsupported database system: ${options.system}`)
    }
  }
}

// Export adapter classes for testing
export { PostgreSQLAdapter, MySQLAdapter }
