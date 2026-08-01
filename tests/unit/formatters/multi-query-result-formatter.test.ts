import { describe, expect, test } from 'bun:test'
import { MultiQueryResultFormatter } from '@/formatters/multi-query-result-formatter'
import type { ConnectionQueryOutcome } from '@/core/query-fanout'

const outcomes: ConnectionQueryOutcome[] = [
  {
    connection: 'primary',
    status: 'ok',
    result: {
      rows: [{ id: 1 }],
      rowCount: 1,
      columnNames: ['id'],
      appliedLimit: { truncated: false, limitApplied: 1000 },
    },
  },
  {
    connection: 'analytics',
    status: 'error',
    error: { code: 'ETIMEDOUT', message: 'Connection timed out', hints: ['Check VPN'] },
  },
]

describe('multi-query result formatter', () => {
  test('renders ordered JSON outcomes with public limit metadata', () => {
    expect(JSON.parse(new MultiQueryResultFormatter().format(outcomes, { format: 'json' }))).toEqual({
      results: [
        {
          connection: 'primary',
          status: 'ok',
          rows: [{ id: 1 }],
          rowCount: 1,
          columnNames: ['id'],
          metadata: { truncated: false, limit_applied: 1000 },
        },
        {
          connection: 'analytics',
          status: 'error',
          error: {
            code: 'ETIMEDOUT',
            message: 'Connection timed out',
            hints: ['Check VPN'],
          },
        },
      ],
    })
  })

  test('renders heterogeneous table results as independent labeled sections', () => {
    const secondSuccess: ConnectionQueryOutcome = {
      connection: 'analytics',
      status: 'ok',
      result: {
        rows: [{ event: 'login' }],
        rowCount: 1,
        columnNames: ['event'],
      },
    }
    const output = new MultiQueryResultFormatter().format([outcomes[0]!, secondSuccess], {
      format: 'table',
      truncate: 120,
    })

    expect(output).toContain('Connection: primary [ok]')
    expect(output).toContain('Connection: analytics [ok]')
    expect(output.indexOf('Connection: primary')).toBeLessThan(output.indexOf('Connection: analytics'))
    expect(output).toContain(' id ')
    expect(output).toContain(' event ')
  })

  test('renders a security notice inside its connection table section', () => {
    const notified: ConnectionQueryOutcome = {
      connection: 'primary',
      status: 'ok',
      result: {
        rows: [{ id: 1 }],
        rowCount: 1,
        columnNames: ['id'],
        metadata: {
          statement: 'SELECT',
          securityNotification: 'Security: a column was omitted',
        },
      },
    }
    const next: ConnectionQueryOutcome = {
      connection: 'analytics',
      status: 'ok',
      result: { rows: [{ id: 2 }], rowCount: 1, columnNames: ['id'] },
    }

    const output = new MultiQueryResultFormatter().format([notified, next], { format: 'table' })
    const noticeIndex = output.indexOf('Security: a column was omitted')
    expect(noticeIndex).toBeGreaterThan(output.indexOf('Connection: primary [ok]'))
    expect(noticeIndex).toBeLessThan(output.indexOf('Connection: analytics [ok]'))
  })

  test('renders bounded table errors without stacks', () => {
    const output = new MultiQueryResultFormatter().format([outcomes[1]!], { format: 'table' })
    expect(output).toBe(
      'Connection: analytics [error]\nETIMEDOUT: Connection timed out\nHint: Check VPN'
    )
    expect(output).not.toContain('Stack:')
  })
})
