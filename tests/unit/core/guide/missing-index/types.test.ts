// tests/unit/core/guide/missing-index/types.test.ts
import { test, expect } from 'bun:test'
import type {
  MissingIndexReport,
  IndexCandidate,
  TableColumnUsage,
} from '@/core/guide/missing-index/types'

test('MissingIndexReport shape is constructable', () => {
  const usage: TableColumnUsage = {
    table: 'betting_logs',
    alias: 'b',
    equalityColumns: ['user_id'],
    rangeColumns: ['settled_at'],
    joinColumns: ['user_id'],
    orderColumns: [],
    functionalColumns: [],
  }
  const candidate: IndexCandidate = {
    table: 'betting_logs',
    columns: ['user_id', 'settled_at'],
    reason: 'covers WHERE + JOIN',
    confidence: 'high',
    existingIndexCollision: null,
  }
  const report: MissingIndexReport = {
    query: 'SELECT ...',
    candidates: [candidate],
    warnings: [{ rule: 'parser-limit', detail: 'window function ignored' }],
  }
  expect(report.candidates[0]!.columns).toEqual(['user_id', 'settled_at'])
  expect(usage.table).toBe('betting_logs')
})
