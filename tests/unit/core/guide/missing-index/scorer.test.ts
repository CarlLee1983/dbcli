// tests/unit/core/guide/missing-index/scorer.test.ts
import { test, expect } from 'bun:test'
import { scoreCandidate } from '@/core/guide/missing-index/scorer'
import type { IndexCandidate, TableColumnUsage, EnrichedPlanFacts } from '@/core/guide/missing-index/types'

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
  reason: '',
  confidence: 'low',
  existingIndexCollision: null,
}

test('full scan + full coverage → high', () => {
  const facts: EnrichedPlanFacts = { accessType: 'ALL', key: null, rows: 50000 }
  const out = scoreCandidate(candidate, usage, facts)
  expect(out.confidence).toBe('high')
  expect(out.reason.length).toBeGreaterThan(0)
  expect(out.reason).toContain('settled_at')
})

test('PG Seq Scan counts as full scan → high', () => {
  const facts: EnrichedPlanFacts = { accessType: 'Seq Scan', key: null, rows: 9000 }
  expect(scoreCandidate(candidate, usage, facts).confidence).toBe('high')
})

test('collision with existing single-col index → medium', () => {
  const facts: EnrichedPlanFacts = { accessType: 'ref', key: 'idx_user', rows: 546, filtered: 20 }
  const out = scoreCandidate({ ...candidate, existingIndexCollision: 'idx_user' }, usage, facts)
  expect(out.confidence).toBe('medium')
  expect(out.reason).toContain('idx_user')
})

test('no plan facts → low (heuristic)', () => {
  const out = scoreCandidate(candidate, usage, undefined)
  expect(out.confidence).toBe('low')
  expect(out.reason.toLowerCase()).toContain('heuristic')
})

test('populates estimatedRowsReduction when filtered% present', () => {
  const facts: EnrichedPlanFacts = { accessType: 'ref', key: 'idx_user', rows: 546, filtered: 20 }
  const out = scoreCandidate({ ...candidate, existingIndexCollision: 'idx_user' }, usage, facts)
  expect(out.estimatedRowsReduction).toBeDefined()
})
