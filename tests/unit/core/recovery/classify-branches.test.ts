import { describe, test, expect } from 'bun:test'
import { classifyError } from '@/core/recovery/classify'
import { ConnectionError } from '@/adapters/types'
import { BlacklistError } from '@/types/blacklist'

describe('classifyError — connection codes emit branches/branchFork', () => {
  test('CONN_REFUSED carries 4 branches', () => {
    const env = classifyError(new ConnectionError('ECONNREFUSED', 'refused', []), {
      operation: 'query',
    })
    expect(env.error.category).toBe('connection')
    expect(env.branches).toBeDefined()
    expect(Object.keys(env.branches!).sort()).toEqual([
      'doctor-auth-error',
      'doctor-clean',
      'doctor-config-missing',
      'doctor-network-error',
    ])
    expect(env.branchFork).toEqual({
      after: 1,
      branchIds: [
        'doctor-clean',
        'doctor-config-missing',
        'doctor-auth-error',
        'doctor-network-error',
      ],
    })
  })

  test('connection envelope with connectionName puts use step in doctor-network-error', () => {
    const env = classifyError(new ConnectionError('ECONNREFUSED', 'refused', []), {
      operation: 'query',
      connectionName: 'staging',
    })
    const plan = env.branches!['doctor-network-error']!
    expect(plan.steps.map((s) => s.command)).toContain('dbcli use staging')
  })
})

describe('classifyError — non-connection codes do NOT emit branches', () => {
  test('BLACKLIST_TABLE envelope has no branches/branchFork', () => {
    const env = classifyError(
      new BlacklistError("Table 'orders' is blacklisted", 'orders', 'SELECT'),
      { operation: 'query', table: 'orders' }
    )
    expect(env.branches).toBeUndefined()
    expect(env.branchFork).toBeUndefined()
  })
})
