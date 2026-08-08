import { expect, test } from 'bun:test'
import { ConnectionError } from '@/adapters/types'
import { requireConnected, withMappedConnectionError } from '@/adapters/sql-adapter-utils'

const options = {
  system: 'postgresql' as const,
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'test',
}

test('requireConnected returns a live driver connection unchanged', () => {
  const connection = { query: () => undefined }

  expect(requireConnected(connection)).toBe(connection)
})

test('requireConnected preserves the adapter contract before connect()', () => {
  expect(() => requireConnected(null)).toThrow(ConnectionError)
  expect(() => requireConnected(undefined)).toThrow(ConnectionError)

  try {
    requireConnected(undefined)
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).code).toBe('UNKNOWN')
    expect((error as ConnectionError).message).toBe('Database connection not established')
    expect((error as ConnectionError).hints).toEqual(['Call connect() to establish a connection'])
  }
})

test('withMappedConnectionError returns successful driver results', async () => {
  await expect(
    withMappedConnectionError('postgresql', options, async () => ({ rows: 1 }))
  ).resolves.toEqual({ rows: 1 })
})

test('withMappedConnectionError preserves categorized failures and maps driver failures', async () => {
  const categorized = new ConnectionError('SQL_SYNTAX_ERROR', 'sentinel', ['hint'])
  await expect(
    withMappedConnectionError('postgresql', options, async () => {
      throw categorized
    })
  ).rejects.toBe(categorized)

  await expect(
    withMappedConnectionError('mysql', { ...options, system: 'mysql', port: 3306 }, async () => {
      throw { code: 'ECONNREFUSED', message: 'Connection refused' }
    })
  ).rejects.toMatchObject({ code: 'ECONNREFUSED' })
})
