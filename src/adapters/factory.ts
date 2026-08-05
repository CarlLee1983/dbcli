/**
 * Database adapter factory for system-aware instantiation
 * Routes to correct adapter implementation based on database system type
 */

import type {
  ConnectionOptions,
  DatabaseAdapter,
  QueryableAdapter,
  QueryableConnectionOptions,
  SqlConnectionOptions,
} from './types'
import { PostgreSQLAdapter } from './postgresql-adapter'
import { MySQLAdapter } from './mysql-adapter'
import { MongoDBAdapter } from './mongodb-adapter'
import { RedisAdapter } from './redis-adapter'
import { ElasticsearchAdapter } from './elasticsearch-adapter'
import type { RedisMaskRule } from '@/types/blacklist'
import { withResolvedTimeout } from '@/utils/connection-timeout'

/**
 * Factory for creating database adapters
 * Implements factory pattern to route to correct adapter based on system type
 * Enables system-aware instantiation without coupling CLI commands to specific drivers
 */
export class AdapterFactory {
  static createSqlAdapter(rawOptions: SqlConnectionOptions): DatabaseAdapter {
    // Adapter construction is the single place the per-invocation --timeout
    // override is applied: resolving it any earlier would let a read → mutate →
    // write command persist a one-shot flag into config.json.
    const options = withResolvedTimeout(rawOptions)
    switch (options.system) {
      case 'postgresql':
        return new PostgreSQLAdapter(options)
      case 'mysql':
      case 'mariadb':
        return new MySQLAdapter(options)
      default:
        throw new Error(
          `createSqlAdapter requires a SQL system, got: ${(options as { system?: string }).system}`
        )
    }
  }

  static createQueryableAdapter(rawOptions: QueryableConnectionOptions): QueryableAdapter {
    const options = withResolvedTimeout(rawOptions)
    switch (options.system) {
      case 'mongodb':
        return new MongoDBAdapter(options)
      case 'redis':
        return new RedisAdapter(options)
      case 'elasticsearch':
        return new ElasticsearchAdapter(options)
      default:
        throw new Error(
          `createQueryableAdapter requires a non-SQL queryable system, got: ${(options as { system?: string }).system}`
        )
    }
  }

  static createAdapter(options: SqlConnectionOptions): DatabaseAdapter
  static createAdapter(options: QueryableConnectionOptions): QueryableAdapter
  static createAdapter(options: ConnectionOptions): DatabaseAdapter | QueryableAdapter
  static createAdapter(options: ConnectionOptions): DatabaseAdapter | QueryableAdapter {
    switch (options.system) {
      case 'postgresql':
      case 'mysql':
      case 'mariadb':
        return AdapterFactory.createSqlAdapter(options as SqlConnectionOptions)
      case 'mongodb':
      case 'redis':
      case 'elasticsearch':
        return AdapterFactory.createQueryableAdapter(options as QueryableConnectionOptions)
      default:
        throw new Error(`Unsupported database system: ${(options as { system?: string }).system}`)
    }
  }

  static createMongoDBAdapter(options: ConnectionOptions): QueryableAdapter {
    if (options.system !== 'mongodb') {
      throw new Error('createMongoDBAdapter requires system: mongodb')
    }
    return AdapterFactory.createQueryableAdapter(options as QueryableConnectionOptions)
  }

  static createRedisAdapter(
    rawOptions: ConnectionOptions,
    blacklistRules: string[] = [],
    maskRules: RedisMaskRule[] = []
  ): QueryableAdapter {
    if (rawOptions.system !== 'redis') {
      throw new Error('createRedisAdapter requires system: redis')
    }
    const options = withResolvedTimeout(rawOptions)
    const adapter = new RedisAdapter(options as QueryableConnectionOptions)
    adapter.setBlacklistRules(blacklistRules)
    adapter.setMaskRules(maskRules)
    return adapter
  }

  static createElasticsearchAdapter(options: ConnectionOptions): QueryableAdapter {
    if (options.system !== 'elasticsearch') {
      throw new Error('createElasticsearchAdapter requires system: elasticsearch')
    }
    return AdapterFactory.createQueryableAdapter(options as QueryableConnectionOptions)
  }
}

// Export adapter classes for testing
export { PostgreSQLAdapter, MySQLAdapter, MongoDBAdapter, RedisAdapter, ElasticsearchAdapter }
