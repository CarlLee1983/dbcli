/**
 * Database adapter factory for system-aware instantiation
 * Routes to correct adapter implementation based on database system type
 */

import type { ConnectionOptions, DatabaseAdapter, QueryableAdapter } from './types'
import { PostgreSQLAdapter } from './postgresql-adapter'
import { MySQLAdapter } from './mysql-adapter'
import { MongoDBAdapter } from './mongodb-adapter'
import { RedisAdapter } from './redis-adapter'
import { ElasticsearchAdapter } from './elasticsearch-adapter'

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
      case 'mongodb':
        return new MongoDBAdapter(options) as unknown as DatabaseAdapter
      case 'redis':
        return new RedisAdapter(options) as unknown as DatabaseAdapter
      case 'elasticsearch':
        return new ElasticsearchAdapter(options) as unknown as DatabaseAdapter
      default:
        throw new Error(`Unsupported database system: ${options.system}`)
    }
  }

  /**
   * Create a MongoDB adapter instance for queryable MongoDB operations
   * MongoDB adapters support read-focused operations via QueryableAdapter interface
   *
   * @param options Connection configuration (system must be 'mongodb')
   * @returns QueryableAdapter instance for MongoDB
   * @throws {Error} If system type is not 'mongodb'
   */
  static createMongoDBAdapter(options: ConnectionOptions): QueryableAdapter {
    if (options.system !== 'mongodb') {
      throw new Error('createMongoDBAdapter requires system: mongodb')
    }
    return new MongoDBAdapter(options)
  }

  /**
   * Create a Redis adapter instance for queryable Redis operations.
   * Redis adapters share the QueryableAdapter contract with MongoDB so
   * commands like list/schema/query can route to a single CLI surface.
   *
   * @param options Connection configuration (system must be 'redis')
   * @returns QueryableAdapter instance for Redis
   * @throws {Error} If system type is not 'redis'
   */
  static createRedisAdapter(options: ConnectionOptions): QueryableAdapter {
    if (options.system !== 'redis') {
      throw new Error('createRedisAdapter requires system: redis')
    }
    return new RedisAdapter(options)
  }

  /**
   * Create an Elasticsearch adapter instance for queryable Elasticsearch operations.
   * Elasticsearch adapters share the QueryableAdapter contract with MongoDB/Redis.
   *
   * @param options Connection configuration (system must be 'elasticsearch')
   * @returns QueryableAdapter instance for Elasticsearch
   * @throws {Error} If system type is not 'elasticsearch'
   */
  static createElasticsearchAdapter(options: ConnectionOptions): QueryableAdapter {
    if (options.system !== 'elasticsearch') {
      throw new Error('createElasticsearchAdapter requires system: elasticsearch')
    }
    return new ElasticsearchAdapter(options)
  }
}

// Export adapter classes for testing
export { PostgreSQLAdapter, MySQLAdapter, MongoDBAdapter, RedisAdapter, ElasticsearchAdapter }
