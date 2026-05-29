// tests/unit/core/guide/missing-index/explain-enricher.test.ts
import { test, expect } from 'bun:test'
import { makeExplainEnricher } from '@/core/guide/missing-index/explain-enricher'
import type { ExplainPlan } from '@/core/explain/types'

test('maps plan rows to per-table facts keyed by driving table', async () => {
  const fakeRunExplain = async (): Promise<ExplainPlan> =>
    ({
      system: 'mysql',
      rawSql: 'SELECT 1',
      raw: {},
      rows: [
        { driving: 'betting_logs', accessType: 'ref', key: 'idx_user', rows: 546, filtered: 20, extra: [], annotations: [] },
        { driving: 'hoster_machines', accessType: 'ALL', key: null, rows: 20, extra: [], annotations: [] },
      ],
    }) as ExplainPlan

  const enrich = makeExplainEnricher('mysql', {} as any, fakeRunExplain)
  const facts = await enrich('SELECT ...')
  expect(facts.get('betting_logs')).toEqual({ accessType: 'ref', key: 'idx_user', rows: 546, filtered: 20 })
  expect(facts.get('hoster_machines')!.accessType).toBe('ALL')
})

test('returns empty map when explain throws', async () => {
  const boom = async (): Promise<ExplainPlan> => {
    throw new Error('explain failed')
  }
  const enrich = makeExplainEnricher('mysql', {} as any, boom)
  expect((await enrich('SELECT ...')).size).toBe(0)
})

test('keeps the first row when two rows share a driving table', async () => {
  const dup = async (): Promise<ExplainPlan> =>
    ({
      system: 'postgresql',
      rawSql: 'x',
      raw: {},
      rows: [
        { driving: 't', accessType: 'Seq Scan', key: null, rows: 1000, extra: [], annotations: [] },
        { driving: 't', accessType: 'Index Scan', key: 'idx', rows: 5, extra: [], annotations: [] },
      ],
    }) as ExplainPlan
  const enrich = makeExplainEnricher('postgresql', {} as any, dup)
  const facts = await enrich('x')
  expect(facts.get('t')!.accessType).toBe('Seq Scan')
})
