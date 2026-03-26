import { describe, it, expect } from 'vitest'
import { shouldBlockQuery } from '@/commands/query-size-guard'

describe('shouldBlockQuery', () => {
  it('blocks SELECT * on huge table without WHERE or LIMIT', () => {
    const result = shouldBlockQuery('SELECT * FROM logs', { estimatedRowCount: 2_000_000 })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('huge')
  })

  it('allows SELECT * on huge table with WHERE clause', () => {
    const result = shouldBlockQuery('SELECT * FROM logs WHERE id = 1', { estimatedRowCount: 2_000_000 })
    expect(result.blocked).toBe(false)
  })

  it('allows SELECT * on huge table with LIMIT', () => {
    const result = shouldBlockQuery('SELECT * FROM logs LIMIT 100', { estimatedRowCount: 2_000_000 })
    expect(result.blocked).toBe(false)
  })

  it('allows any query on small table', () => {
    const result = shouldBlockQuery('SELECT * FROM users', { estimatedRowCount: 500 })
    expect(result.blocked).toBe(false)
  })

  it('does not block when schema info is unavailable', () => {
    const result = shouldBlockQuery('SELECT * FROM unknown', undefined)
    expect(result.blocked).toBe(false)
  })

  it('allows non-SELECT statements', () => {
    const result = shouldBlockQuery('SHOW TABLES', { estimatedRowCount: 2_000_000 })
    expect(result.blocked).toBe(false)
  })
})
