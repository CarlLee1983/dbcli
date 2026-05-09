import { describe, test, expect } from 'bun:test'
import { classifyError } from '@/core/recovery/classify'
import { ConnectionError } from '@/adapters/types'
import { PermissionError, type StatementClassification } from '@/core/permission-guard'
import { BlacklistError } from '@/types/blacklist'
import { SavedQueryError } from '@/core/saved-queries/types'
import { SchemaCacheMissingError } from '@/core/recovery/types'

const stmt: StatementClassification = {
  type: 'INSERT',
  isDangerous: false,
  keywords: ['INSERT'],
  isComposite: false,
  confidence: 'HIGH',
}

describe('classifyError', () => {
  test('ConnectionError ECONNREFUSED → CONN_REFUSED', () => {
    const err = new ConnectionError('ECONNREFUSED', 'Connection refused at localhost:5432', [])
    const env = classifyError(err, { operation: 'query', system: 'postgresql' })
    expect(env.error.code).toBe('CONN_REFUSED')
    expect(env.error.category).toBe('connection')
    expect(env.error.details?.connectionCode).toBe('ECONNREFUSED')
    expect(env.error.message).not.toContain('localhost')
    expect(env.error.message).not.toContain('5432')
    expect(env.recovery.length).toBeGreaterThan(0)
    expect(env.ok).toBe(false)
    expect(env.schemaVersion).toBe(1)
    expect(typeof env.generatedAt).toBe('string')
    expect(new Date(env.generatedAt).toString()).not.toBe('Invalid Date')
  })

  test('ConnectionError AUTH_FAILED → CONN_AUTH_FAILED', () => {
    const err = new ConnectionError('AUTH_FAILED', 'Authentication failed: role "x"', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_AUTH_FAILED')
    expect(env.error.message).not.toContain('role "x"')
  })

  test('ConnectionError ETIMEDOUT → CONN_TIMEOUT', () => {
    const err = new ConnectionError('ETIMEDOUT', 'Timed out after 5000ms', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_TIMEOUT')
  })

  test('ConnectionError ENOTFOUND → CONN_HOST_NOT_FOUND', () => {
    const err = new ConnectionError('ENOTFOUND', 'Host not found: db.invalid', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_HOST_NOT_FOUND')
    expect(env.error.message).not.toContain('db.invalid')
  })

  test('ConnectionError UNKNOWN → CONN_UNKNOWN', () => {
    const err = new ConnectionError('UNKNOWN', 'Mystery failure', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_UNKNOWN')
  })

  test('PermissionError → PERMISSION_DENIED preserves requiredPermission', () => {
    const err = new PermissionError('INSERT not allowed', stmt, 'read-write')
    const env = classifyError(err, { operation: 'insert' })
    expect(env.error.code).toBe('PERMISSION_DENIED')
    expect(env.error.details?.requiredPermission).toBe('read-write')
  })

  test('BlacklistError on read → BLACKLIST_TABLE preserves table', () => {
    const err = new BlacklistError("Table 'users' is blacklisted", 'users', 'SELECT')
    const env = classifyError(err, { operation: 'query', table: 'users' })
    expect(env.error.code).toBe('BLACKLIST_TABLE')
    expect(env.error.details?.table).toBe('users')
  })

  test('BlacklistError column-write phrasing → BLACKLIST_COLUMN_WRITE', () => {
    const err = new BlacklistError(
      "INSERT on table 'users' touches blacklisted columns: ssn",
      'users',
      'INSERT'
    )
    const env = classifyError(err, { operation: 'insert', table: 'users' })
    expect(env.error.code).toBe('BLACKLIST_COLUMN_WRITE')
    expect(env.error.details?.columns).toBe('ssn')
  })

  test('SavedQueryError NOT_FOUND → SNIPPET_NOT_FOUND', () => {
    const err = new SavedQueryError('Snippet not found: @diag/foo', 'NOT_FOUND')
    const env = classifyError(err, { operation: 'q', snippet: '@diag/foo' })
    expect(env.error.code).toBe('SNIPPET_NOT_FOUND')
    expect(env.error.details?.snippet).toBe('@diag/foo')
  })

  test('SavedQueryError AMBIGUOUS → SNIPPET_AMBIGUOUS', () => {
    const err = new SavedQueryError('Ambiguous match: @diag/foo', 'AMBIGUOUS')
    const env = classifyError(err, { operation: 'q', snippet: '@diag/foo' })
    expect(env.error.code).toBe('SNIPPET_AMBIGUOUS')
  })

  test('SavedQueryError PARAM_MISSING → SNIPPET_PARAM_MISSING captures paramName', () => {
    const err = new SavedQueryError(
      'Missing required parameters: min_seconds',
      'PARAM_MISSING'
    )
    const env = classifyError(err, { operation: 'q', snippet: '@diag/long-running' })
    expect(env.error.code).toBe('SNIPPET_PARAM_MISSING')
    expect(env.error.details?.paramName).toBe('min_seconds')
  })

  test('SchemaCacheMissingError → SCHEMA_CACHE_MISSING', () => {
    const err = new SchemaCacheMissingError('No schema cache for users', 'users')
    const env = classifyError(err, { operation: 'query', table: 'users' })
    expect(env.error.code).toBe('SCHEMA_CACHE_MISSING')
    expect(env.error.details?.table).toBe('users')
  })

  test('Run dbcli init message → CONFIG_MISSING', () => {
    const err = new Error('Run "dbcli init" first')
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONFIG_MISSING')
  })

  test('unrecognized Error → UNKNOWN with original message', () => {
    const err = new Error('something else broke')
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('UNKNOWN')
    expect(env.error.message).toBe('something else broke')
  })

  test('non-Error thrown value → UNKNOWN with stringified message', () => {
    const env = classifyError('plain string failure', { operation: 'query' })
    expect(env.error.code).toBe('UNKNOWN')
    expect(env.error.message).toContain('plain string failure')
  })
})
