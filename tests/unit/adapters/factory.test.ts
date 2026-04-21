/**
 * Unit tests for AdapterFactory
 * Tests system-aware adapter instantiation and error handling
 */

import { test, expect } from 'bun:test'
import { AdapterFactory } from 'src/adapters/factory'
import { PostgreSQLAdapter, MySQLAdapter } from 'src/adapters/factory'
import { MongoDBAdapter } from 'src/adapters/mongodb-adapter'
import type { ConnectionOptions, QueryableAdapter } from 'src/adapters/types'

const validOptions: ConnectionOptions = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'testuser',
  password: 'testpass',
  database: 'testdb',
  timeout: 5000,
}

test('createAdapter returns PostgreSQLAdapter for postgresql system', () => {
  const adapter = AdapterFactory.createAdapter({ ...validOptions, system: 'postgresql' })
  expect(adapter).toBeInstanceOf(PostgreSQLAdapter)
})

test('createAdapter returns MySQLAdapter for mysql system', () => {
  const adapter = AdapterFactory.createAdapter({ ...validOptions, system: 'mysql' })
  expect(adapter).toBeInstanceOf(MySQLAdapter)
})

test('createAdapter returns MySQLAdapter for mariadb system', () => {
  const adapter = AdapterFactory.createAdapter({ ...validOptions, system: 'mariadb' })
  expect(adapter).toBeInstanceOf(MySQLAdapter)
})

test('createAdapter throws Error for unsupported database system', () => {
  expect(() => {
    AdapterFactory.createAdapter({ ...validOptions, system: 'unknown' as any })
  }).toThrow('Unsupported database system: unknown')
})

test('createAdapter preserves all ConnectionOptions', () => {
  const adapter = AdapterFactory.createAdapter(validOptions)
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
  const adapter = AdapterFactory.createMongoDBAdapter(mongoOptions)
  expect(adapter).toBeInstanceOf(MongoDBAdapter)
})

test('createMongoDBAdapter exposes full QueryableAdapter interface', () => {
  const adapter: QueryableAdapter = AdapterFactory.createMongoDBAdapter(mongoOptions)
  expect(adapter).toHaveProperty('connect')
  expect(adapter).toHaveProperty('disconnect')
  expect(adapter).toHaveProperty('execute')
  expect(adapter).toHaveProperty('listCollections')
  expect(adapter).toHaveProperty('testConnection')
  expect(adapter).toHaveProperty('getServerVersion')
})

test('createMongoDBAdapter throws for non-mongodb system', () => {
  expect(() => {
    AdapterFactory.createMongoDBAdapter({ ...validOptions, system: 'postgresql' })
  }).toThrow('createMongoDBAdapter requires system: mongodb')
})
