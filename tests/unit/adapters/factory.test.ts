/**
 * Unit tests for AdapterFactory
 * Tests system-aware adapter instantiation and error handling
 */

import { test, expect } from 'bun:test'
import { AdapterFactory } from 'src/adapters/factory'
import { PostgreSQLAdapter, MySQLAdapter } from 'src/adapters/factory'
import { MongoDBAdapter } from 'src/adapters/mongodb-adapter'
import { RedisAdapter } from 'src/adapters/redis-adapter'
import { ElasticsearchAdapter } from 'src/adapters/elasticsearch-adapter'
import type { ConnectionOptions, QueryableAdapter } from 'src/adapters/types'
import { isBlacklistOverrideEnabled } from '@/core/blacklist-manager'

const validOptions: ConnectionOptions = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'testuser',
  password: 'testpass',
  database: 'testdb',
  timeout: 5000,
}

test('factory injects blacklist rules into RedisAdapter', () => {
  const adapter = AdapterFactory.createRedisAdapter({
    connection: { system: 'redis', host: 'h', port: 6379, user: '', password: '', database: '0' },
    blacklist: { tables: ['secrets:*'] },
  })
  expect((adapter as unknown as { blacklistRules: string[] }).blacklistRules).toEqual(['secrets:*'])
})

test('createAdapter returns PostgreSQLAdapter for postgresql system', () => {
  const adapter = AdapterFactory.createAdapter({
    connection: { ...validOptions, system: 'postgresql' },
    blacklist: { tables: [], columns: {} },
  })
  expect(adapter).toBeInstanceOf(PostgreSQLAdapter)
})

test('createAdapter returns MySQLAdapter for mysql system', () => {
  const adapter = AdapterFactory.createAdapter({
    connection: { ...validOptions, system: 'mysql' },
    blacklist: { tables: [], columns: {} },
  })
  expect(adapter).toBeInstanceOf(MySQLAdapter)
})

test('createAdapter returns MySQLAdapter for mariadb system', () => {
  const adapter = AdapterFactory.createAdapter({
    connection: { ...validOptions, system: 'mariadb' },
    blacklist: { tables: [], columns: {} },
  })
  expect(adapter).toBeInstanceOf(MySQLAdapter)
})

test('createAdapter throws Error for unsupported database system', () => {
  expect(() => {
    AdapterFactory.createAdapter({
      connection: { ...validOptions, system: 'unknown' as any },
      blacklist: { tables: [], columns: {} },
    })
  }).toThrow('Unsupported database system: unknown')
})

test('createAdapter preserves all ConnectionOptions', () => {
  const adapter = AdapterFactory.createAdapter({
    connection: validOptions,
    blacklist: { tables: [], columns: {} },
  })
  // Adapter stores options internally; instance exists and is properly typed
  expect(adapter).toBeDefined()
  expect(adapter).toHaveProperty('connect')
  expect(adapter).toHaveProperty('disconnect')
  expect(adapter).toHaveProperty('execute')
  expect(adapter).toHaveProperty('listTables')
  expect(adapter).toHaveProperty('getTableSchema')
  expect(adapter).toHaveProperty('testConnection')
})

const mongoOptions: ConnectionOptions = {
  system: 'mongodb',
  uri: 'mongodb://localhost:27017/testdb',
  host: 'localhost',
  port: 27017,
  user: '',
  password: '',
  database: 'testdb',
}

test('createMongoDBAdapter returns MongoDBAdapter for mongodb system', () => {
  const adapter = AdapterFactory.createMongoDBAdapter({ connection: mongoOptions })
  expect(adapter).toBeInstanceOf(MongoDBAdapter)
})

test('createMongoDBAdapter exposes full QueryableAdapter interface', () => {
  const adapter: QueryableAdapter = AdapterFactory.createMongoDBAdapter({
    connection: mongoOptions,
  })
  expect(adapter).toHaveProperty('connect')
  expect(adapter).toHaveProperty('disconnect')
  expect(adapter).toHaveProperty('execute')
  expect(adapter).toHaveProperty('listCollections')
  expect(adapter).toHaveProperty('testConnection')
  expect(adapter).toHaveProperty('getServerVersion')
})

test('createMongoDBAdapter throws for non-mongodb system', () => {
  expect(() => {
    AdapterFactory.createMongoDBAdapter({ connection: { ...validOptions, system: 'postgresql' } })
  }).toThrow('createMongoDBAdapter requires system: mongodb')
})

const esOptions: ConnectionOptions = {
  system: 'elasticsearch',
  protocol: 'http',
  host: 'localhost',
  port: 9200,
  user: '',
  password: '',
  database: '',
}

test('createElasticsearchAdapter returns ElasticsearchAdapter for elasticsearch system', async () => {
  const { ElasticsearchAdapter } = await import('src/adapters/elasticsearch-adapter')
  const adapter = AdapterFactory.createElasticsearchAdapter(esOptions)
  expect(adapter).toBeInstanceOf(ElasticsearchAdapter)
})

test('createAdapter routes to elasticsearch', async () => {
  const adapter = AdapterFactory.createAdapter({
    connection: esOptions,
    blacklist: { tables: [], columns: {} },
  })
  expect(adapter).toBeInstanceOf(ElasticsearchAdapter)
})

test('createSqlAdapter returns SQL adapters only', () => {
  expect(AdapterFactory.createSqlAdapter({ ...validOptions, system: 'postgresql' })).toBeInstanceOf(
    PostgreSQLAdapter
  )
  expect(AdapterFactory.createSqlAdapter({ ...validOptions, system: 'mysql' })).toBeInstanceOf(
    MySQLAdapter
  )
  expect(AdapterFactory.createSqlAdapter({ ...validOptions, system: 'mariadb' })).toBeInstanceOf(
    MySQLAdapter
  )
})

test('createSqlAdapter rejects queryable non-SQL systems', () => {
  expect(() => AdapterFactory.createSqlAdapter(mongoOptions as never)).toThrow(
    'createSqlAdapter requires a SQL system'
  )
  expect(() => AdapterFactory.createSqlAdapter(esOptions as never)).toThrow(
    'createSqlAdapter requires a SQL system'
  )
})

test('createAdapterWithoutRules makes connection-only probes explicit', () => {
  expect(AdapterFactory.createAdapterWithoutRules(mongoOptions)).toBeInstanceOf(MongoDBAdapter)
  expect(
    AdapterFactory.createAdapterWithoutRules({
      system: 'redis',
      host: 'localhost',
      port: 6379,
      user: '',
      password: '',
      database: '0',
    })
  ).toBeInstanceOf(RedisAdapter)
  expect(AdapterFactory.createAdapterWithoutRules(esOptions)).toBeInstanceOf(ElasticsearchAdapter)
})

test('createAdapter routes Redis through its configured factory', () => {
  const adapter = AdapterFactory.createAdapter({
    connection: { system: 'redis', host: 'h', port: 6379, user: '', password: '', database: '0' },
    blacklist: { tables: ['secrets:*'], columns: {} },
  })
  expect((adapter as unknown as { blacklistRules: string[] }).blacklistRules).toEqual(['secrets:*'])
})

test('blacklist break-glass parsing stays shared with the Redis factory', () => {
  expect(isBlacklistOverrideEnabled('true')).toBe(true)
  expect(isBlacklistOverrideEnabled('TRUE')).toBe(false)
})

test('Redis break-glass emits a warning without exposing a key', async () => {
  const factoryUrl = new URL('../../../src/adapters/factory.ts', import.meta.url).href
  const script = `import { AdapterFactory } from ${JSON.stringify(factoryUrl)}; AdapterFactory.createRedisAdapter({ connection: { system: 'redis', host: 'h', port: 6379, user: '', password: '', database: '0' }, blacklist: { tables: ['secrets:*'] } });`
  const child = Bun.spawn([process.execPath, '-e', script], {
    env: { ...Bun.env, DBCLI_OVERRIDE_BLACKLIST: 'true' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  expect(exitCode).toBe(0)
  expect(stderr).toContain('DBCLI_OVERRIDE_BLACKLIST=true')
  expect(stderr).not.toContain('secrets:*')
})
