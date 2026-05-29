// tests/unit/core/guide/missing-index/candidate-builder.test.ts
import { test, expect } from 'bun:test'
import { buildCandidates } from '@/core/guide/missing-index/candidate-builder'
import type { TableColumnUsage, ExistingIndex } from '@/core/guide/missing-index/types'

const usage = (over: Partial<TableColumnUsage>): TableColumnUsage => ({
  table: 'betting_logs',
  equalityColumns: [],
  rangeColumns: [],
  joinColumns: [],
  orderColumns: [],
  functionalColumns: [],
  ...over,
})

test('orders columns equality → range → order', () => {
  const out = buildCandidates(
    usage({
      rangeColumns: ['settled_at'],
      equalityColumns: ['user_id'],
      orderColumns: ['created_at'],
    }),
    []
  )
  expect(out[0].columns).toEqual(['user_id', 'settled_at', 'created_at'])
})

test('join columns count as equality and lead the prefix', () => {
  const out = buildCandidates(usage({ joinColumns: ['user_id'], rangeColumns: ['settled_at'] }), [])
  expect(out[0].columns).toEqual(['user_id', 'settled_at'])
})

test('dedups a column used in both join and where', () => {
  const out = buildCandidates(usage({ joinColumns: ['user_id'], equalityColumns: ['user_id'] }), [])
  expect(out[0].columns).toEqual(['user_id'])
})

test('drops candidate already fully covered by an existing index prefix', () => {
  const existing: ExistingIndex[] = [
    { name: 'idx_user_time', columns: ['user_id', 'settled_at'], unique: false },
  ]
  const out = buildCandidates(
    usage({ equalityColumns: ['user_id'], rangeColumns: ['settled_at'] }),
    existing
  )
  expect(out).toEqual([])
})

test('marks collision when an existing index shares the leftmost column', () => {
  const existing: ExistingIndex[] = [{ name: 'idx_user', columns: ['user_id'], unique: false }]
  const out = buildCandidates(
    usage({ equalityColumns: ['user_id'], rangeColumns: ['settled_at'] }),
    existing
  )
  expect(out[0].columns).toEqual(['user_id', 'settled_at'])
  expect(out[0].existingIndexCollision).toBe('idx_user')
})

test('returns no candidate when table has no indexable columns', () => {
  expect(buildCandidates(usage({}), [])).toEqual([])
})
