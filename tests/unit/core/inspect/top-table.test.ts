import { describe, test, expect } from 'bun:test'
import { topQueriedTable } from '@/core/inspect/top-table'
import type { AuditEntryBrief } from '@/core/audit/types'

function e(target: string): AuditEntryBrief {
  return { id: target + '-id', ts: '2026-05-01T00:00:00Z', command: 'query', target, success: true }
}

describe('topQueriedTable', () => {
  test('returns the most frequent real table', () => {
    expect(topQueriedTable([e('orders'), e('users'), e('orders')])).toBe('orders')
  })

  test('skips non-table targets (* and <unknown-*>)', () => {
    expect(topQueriedTable([e('*'), e('<unknown-target>'), e('users')])).toBe('users')
  })

  test('ties break alphabetically', () => {
    expect(topQueriedTable([e('zebra'), e('apple')])).toBe('apple')
  })

  test('empty / no real targets → null', () => {
    expect(topQueriedTable([])).toBeNull()
    expect(topQueriedTable([e('*'), e('')])).toBeNull()
  })
})
