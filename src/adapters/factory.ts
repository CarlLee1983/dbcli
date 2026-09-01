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
import { isBlacklistOverrideEnabled } from '@/core/blacklist-manager'
import { t } from '@/i18n/message-loader'
import { withResolvedTimeout } from '@/utils/connection-timeout'

/**
 * The part of a dbcli configuration a Redis adapter needs.
 *
 * Structural rather than the full `RuntimeDbcliConfig`, so a test can build one
 * without a config file — but it still carries both protections, which is the
 * point of taking a config at all.
 */
export interface AdapterConfig {
  connection: ConnectionOptions | object
  blacklist: { tables: string[]; columns: Record<string, string[]> }
  redis?: { mask?: RedisMaskRule[] }
}

export interface MongoAdapterConfig {
  connection: ConnectionOptions | object
  blacklist?: { columns?: Record<string, string[]> }
}

export interface RedisAdapterConfig {
  connection: ConnectionOptions | object
  blacklist?: { tables?: string[]; columns?: Record<string, string[]> }
  redis?: { mask?: RedisMaskRule[] }
}

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

  private static createQueryableAdapterWithoutRules(
    rawOptions: QueryableConnectionOptions
  ): QueryableAdapter {
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
          `createQueryableAdapterWithoutRules requires a non-SQL queryable system, got: ${(options as { system?: string }).system}`
        )
    }
  }

  static createAdapter(config: AdapterConfig): DatabaseAdapter | QueryableAdapter {
    const options = config.connection as ConnectionOptions
    switch (options.system) {
      case 'postgresql':
      case 'mysql':
      case 'mariadb':
        return AdapterFactory.createSqlAdapter(options as SqlConnectionOptions)
      case 'redis':
        return AdapterFactory.createRedisAdapter(config)
      case 'mongodb':
        return AdapterFactory.createMongoDBAdapter(config)
      case 'elasticsearch':
        return AdapterFactory.createElasticsearchAdapter(options)
      default:
        throw new Error(`Unsupported database system: ${(options as { system?: string }).system}`)
    }
  }

  static createAdapterWithoutRules(options: SqlConnectionOptions): DatabaseAdapter
  static createAdapterWithoutRules(options: QueryableConnectionOptions): QueryableAdapter
  static createAdapterWithoutRules(options: ConnectionOptions): DatabaseAdapter | QueryableAdapter
  static createAdapterWithoutRules(options: ConnectionOptions): DatabaseAdapter | QueryableAdapter {
    switch (options.system) {
      case 'postgresql':
      case 'mysql':
      case 'mariadb':
        return AdapterFactory.createSqlAdapter(options as SqlConnectionOptions)
      case 'mongodb':
      case 'redis':
      case 'elasticsearch':
        return AdapterFactory.createQueryableAdapterWithoutRules(
          options as QueryableConnectionOptions
        )
      default:
        throw new Error(`Unsupported database system: ${(options as { system?: string }).system}`)
    }
  }

  /**
   * Build a MongoDB adapter from the configuration.
   *
   * Same reason as `createRedisAdapter`: the field rules have to arrive with
   * the adapter, because the check that uses them is on the request and every
   * caller would otherwise have to remember to supply them.
   */
  static createMongoDBAdapter(config: MongoAdapterConfig): QueryableAdapter {
    const options = config.connection as ConnectionOptions
    if (options.system !== 'mongodb') {
      throw new Error('createMongoDBAdapter requires system: mongodb')
    }
    const adapter = AdapterFactory.createQueryableAdapterWithoutRules(
      options as QueryableConnectionOptions
    )
    ;(adapter as unknown as MongoDBAdapter).setBlacklistColumns(config.blacklist?.columns ?? {})
    return adapter
  }

  /**
   * Build a Redis adapter from the configuration, not from a connection plus
   * two things the caller has to remember.
   *
   * The blacklist patterns and `redis.mask` rules used to be optional trailing
   * arguments. Six of the eight call sites passed the blacklist and not the
   * mask — `query`, `list`, `schema`, `insert`, `update`, `delete` — so
   * `dbcli query "GET secret:api_key"` returned the plaintext that the user
   * documentation promised would be `[REDACTED]`. `export` and `shell` did pass
   * them, which is exactly why nobody noticed: the feature worked on the two
   * paths anyone would use to check it.
   *
   * A control mounted at the call site is a control the next call site will not
   * have. Taking the configuration is not a tidier signature, it is the reason
   * the omission can no longer be written.
   */
  static createRedisAdapter(config: RedisAdapterConfig): QueryableAdapter {
    const rawOptions = config.connection as ConnectionOptions
    if (rawOptions.system !== 'redis') {
      throw new Error('createRedisAdapter requires system: redis')
    }
    const options = withResolvedTimeout(rawOptions)
    const adapter = new RedisAdapter(options as QueryableConnectionOptions)
    const blacklistRules = config.blacklist?.tables ?? []
    const overrideEnabled = isBlacklistOverrideEnabled()
    if (overrideEnabled && blacklistRules.length > 0) {
      console.error(t('warnings.redis_blacklist_override_active'))
    }
    adapter.setBlacklistRules(overrideEnabled ? [] : blacklistRules)
    adapter.setMaskRules(config.redis?.mask ?? [])
    return adapter
  }

  static createElasticsearchAdapter(options: ConnectionOptions): QueryableAdapter {
    if (options.system !== 'elasticsearch') {
      throw new Error('createElasticsearchAdapter requires system: elasticsearch')
    }
    return AdapterFactory.createQueryableAdapterWithoutRules(options as QueryableConnectionOptions)
  }
}

// Export adapter classes for testing
export { PostgreSQLAdapter, MySQLAdapter, MongoDBAdapter, RedisAdapter, ElasticsearchAdapter }
