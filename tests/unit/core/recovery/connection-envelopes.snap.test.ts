import { describe, test, expect } from 'bun:test'
import { classifyError } from '@/core/recovery/classify'
import { ConnectionError } from '@/adapters/types'

function stableEnvelope(makeError: () => Error, ctx: Parameters<typeof classifyError>[1]) {
  const env = classifyError(makeError(), ctx)
  return { ...env, generatedAt: '__stripped__' }
}

describe('connection envelopes — snapshots', () => {
  test('CONN_REFUSED v1 (no connectionName)', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('ECONNREFUSED', 'refused', []),
        { operation: 'query' }
      )
    ).toMatchSnapshot()
  })

  test('CONN_REFUSED v2 (named connection)', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('ECONNREFUSED', 'refused', []),
        { operation: 'query', connectionName: 'staging' }
      )
    ).toMatchSnapshot()
  })

  test('CONN_AUTH_FAILED', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('AUTH_FAILED', 'auth failed', []),
        { operation: 'query' }
      )
    ).toMatchSnapshot()
  })

  test('CONN_TIMEOUT', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('ETIMEDOUT', 'timeout', []),
        { operation: 'query' }
      )
    ).toMatchSnapshot()
  })

  test('CONN_HOST_NOT_FOUND', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('ENOTFOUND', 'host not found', []),
        { operation: 'query' }
      )
    ).toMatchSnapshot()
  })

  test('CONN_UNKNOWN', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('UNKNOWN', 'unknown failure', []),
        { operation: 'query' }
      )
    ).toMatchSnapshot()
  })
})
