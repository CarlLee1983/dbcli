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
      stableEnvelope(() => new ConnectionError('ECONNREFUSED', 'refused', []), {
        operation: 'query',
      })
    ).toMatchSnapshot()
  })

  test('CONN_REFUSED v2 (named connection)', () => {
    expect(
      stableEnvelope(() => new ConnectionError('ECONNREFUSED', 'refused', []), {
        operation: 'query',
        connectionName: 'staging',
      })
    ).toMatchSnapshot()
  })

  test('CONN_AUTH_FAILED', () => {
    expect(
      stableEnvelope(() => new ConnectionError('AUTH_FAILED', 'auth failed', []), {
        operation: 'query',
      })
    ).toMatchSnapshot()
  })

  test('CONN_TIMEOUT', () => {
    expect(
      stableEnvelope(() => new ConnectionError('ETIMEDOUT', 'timeout', []), { operation: 'query' })
    ).toMatchSnapshot()
  })

  test('CONN_HOST_NOT_FOUND', () => {
    expect(
      stableEnvelope(() => new ConnectionError('ENOTFOUND', 'host not found', []), {
        operation: 'query',
      })
    ).toMatchSnapshot()
  })

  test('CONN_UNKNOWN', () => {
    expect(
      stableEnvelope(() => new ConnectionError('UNKNOWN', 'unknown failure', []), {
        operation: 'query',
      })
    ).toMatchSnapshot()
  })

  // 語句逾時共用 CONN_TIMEOUT，但整個 envelope 的形狀不同：計畫針對查詢、沒有
  // verify、沒有 branches。這張快照就是那三點的釘樁。
  test('CONN_TIMEOUT — statement timeout variant', () => {
    expect(
      stableEnvelope(
        () => new ConnectionError('STATEMENT_TIMEOUT', 'statement timed out (800ms)', [], 800),
        { operation: 'query' }
      )
    ).toMatchSnapshot()
  })
})
