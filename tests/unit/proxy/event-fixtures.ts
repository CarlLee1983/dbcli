// tests/unit/proxy/event-fixtures.ts
import type {
  ProxyEvent,
  QueryCompletedEvent,
  QueryErroredEvent,
} from '@/proxy/events'

export function completed(overrides: Partial<QueryCompletedEvent> = {}): QueryCompletedEvent {
  return {
    version: 1,
    type: 'query_completed',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'qry_1',
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
    sql: 'SELECT * FROM users WHERE id = 1',
    statement: 'SELECT',
    tables: ['users'],
    durationMs: 10,
    requestBytes: 64,
    responseBytes: 128,
    rowCount: 1,
    slow: false,
    error: null,
    tags: [],
    ...overrides,
  }
}

export function errored(overrides: Partial<QueryErroredEvent> = {}): QueryErroredEvent {
  return {
    version: 1,
    type: 'query_errored',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId: 'pxy_1',
    queryId: 'qry_err_1',
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
    sql: "SELECT * FROM missing WHERE id = 1",
    statement: 'SELECT',
    tables: ['missing'],
    durationMs: 5,
    requestBytes: 32,
    responseBytes: 16,
    rowCount: null,
    error: { code: '1146', message: "Table 'missing' doesn't exist" },
    tags: [],
    ...overrides,
  }
}

export function sessionStarted(sessionId: string): ProxyEvent {
  return {
    version: 1,
    type: 'session_started',
    timestamp: '2026-06-04T12:00:00.000Z',
    engine: 'mysql',
    sessionId,
    client: '127.0.0.1:1',
    target: '127.0.0.1:3306',
  }
}
