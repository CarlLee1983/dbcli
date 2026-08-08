import { expect, test } from 'bun:test'
import { ConnectionError } from '@/adapters/types'
import { requireConnected } from '@/adapters/sql-adapter-utils'

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
