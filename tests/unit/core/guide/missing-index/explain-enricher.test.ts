// tests/unit/core/guide/missing-index/explain-enricher.test.ts
import { test, expect } from 'bun:test'
import { makeExplainEnricher } from '@/core/guide/missing-index/explain-enricher'
import type { ExplainOptions, ExplainPlan } from '@/core/explain/types'

test('forwards the query-only execution boundary to explain', async () => {
  let options: ExplainOptions | undefined
  const runExplain = async (
    _system: string,
    _adapter: unknown,
    _sql: string,
    received: ExplainOptions
  ): Promise<ExplainPlan> => {
    options = received
    return { system: 'mysql', rawSql: 'SELECT 1', raw: {}, rows: [] }
  }

  const enrich = makeExplainEnricher('mysql', {} as any, 'native-read-only', runExplain as any)
  await enrich('SELECT 1')

  expect(options?.executionMode).toBe('native-read-only')
})

test('maps plan rows to per-table facts keyed by driving table', async () => {
  const fakeRunExplain = async (): Promise<ExplainPlan> =>
    ({
      system: 'mysql',
      rawSql: 'SELECT 1',
      raw: {},
      rows: [
        {
          driving: 'betting_logs',
          accessType: 'ref',
          key: 'idx_user',
          rows: 546,
          filtered: 20,
          extra: [],
          annotations: [],
        },
        {
          driving: 'hoster_machines',
          accessType: 'ALL',
          key: null,
          rows: 20,
          extra: [],
          annotations: [],
        },
      ],
    }) as ExplainPlan

  const enrich = makeExplainEnricher('mysql', {} as any, 'normal', fakeRunExplain)
  const facts = await enrich('SELECT ...')
  expect(facts.get('betting_logs')).toEqual({
    accessType: 'ref',
    key: 'idx_user',
    rows: 546,
    filtered: 20,
  })
  expect(facts.get('hoster_machines')!.accessType).toBe('ALL')
})

test('returns empty map when explain throws', async () => {
  const boom = async (): Promise<ExplainPlan> => {
    throw new Error('explain failed')
  }
  const enrich = makeExplainEnricher('mysql', {} as any, 'normal', boom)
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
  const enrich = makeExplainEnricher('postgresql', {} as any, 'normal', dup)
  const facts = await enrich('x')
  expect(facts.get('t')!.accessType).toBe('Seq Scan')
})
