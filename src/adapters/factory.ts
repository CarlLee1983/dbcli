/**
 * Database adapter factory for system-aware instantiation
 * Routes to correct adapter implementation based on database system type
 */

import type { ConnectionOptions, DatabaseAdapter } from './types'

/**
 * Stub implementation of PostgreSQL adapter
 * Full implementation comes in Phase 3 Plan 02
 */
class PostgreSQLAdapter implements DatabaseAdapter {
  constructor(private options: ConnectionOptions) {}

  async connect(): Promise<void> {
    // Stub implementation
  }

  async disconnect(): Promise<void> {
    // Stub implementation
  }

  async execute<T>(_sql: string, _params?: (string | number | boolean | null)[]): Promise<T[]> {
    // Stub implementation
    return []
  }

  async listTables() {
    // Stub implementation
    return []
  }

  async getTableSchema(_tableName: string) {
    // Stub implementation
    return {
      name: _tableName,
      columns: [],
      rowCount: 0,
      engine: 'PostgreSQL',
    }
  }

  async testConnection(): Promise<boolean> {
    // Stub implementation
    return true
  }
}

/**
 * Stub implementation of MySQL adapter
 * Handles both MySQL and MariaDB (they use compatible drivers)
 * Full implementation comes in Phase 3 Plan 02
 */
class MySQLAdapter implements DatabaseAdapter {
  constructor(private options: ConnectionOptions) {}

  async connect(): Promise<void> {
    // Stub implementation
  }

  async disconnect(): Promise<void> {
    // Stub implementation
  }

  async execute<T>(_sql: string, _params?: (string | number | boolean | null)[]): Promise<T[]> {
    // Stub implementation
    return []
  }

  async listTables() {
    // Stub implementation
    return []
  }

  async getTableSchema(_tableName: string) {
    // Stub implementation
    return {
      name: _tableName,
      columns: [],
      rowCount: 0,
      engine: 'MySQL',
    }
  }

  async testConnection(): Promise<boolean> {
    // Stub implementation
    return true
  }
}

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
        throw new Error(`不支持的資料庫系統: ${options.system}`)
    }
  }
}

// Export adapter classes for testing
export { PostgreSQLAdapter, MySQLAdapter }
