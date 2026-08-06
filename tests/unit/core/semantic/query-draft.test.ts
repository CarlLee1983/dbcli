import { describe, expect, test } from 'bun:test'
import { validateQueryDraft, type QueryDraftValidationInput } from '@/core/semantic'

const semanticContext = {
  version: 2 as const,
  models: [
    {
      name: 'orders',
      table: 'orders',
      aliases: [],
      fields: [{ column: 'id', aliases: [] }],
    },
  ],
  relationships: [],
  metrics: [{ name: 'daily-revenue', query: '@analytics/revenue' }],
}

const baseInput: Omit<QueryDraftValidationInput, 'draft'> = {
  context: semanticContext,
  schema: { orders: { columns: [{ name: 'id' }] } },
  savedQueryNames: ['@analytics/revenue'],
  system: 'postgresql',
}

function validDraft() {
  const select = 'SELECT id FROM orders'
  return {
    version: 1,
    questionHash: 'a'.repeat(64),
    candidate: { kind: 'sql', sql: select },
    semanticReferences: ['metric:daily-revenue', 'field:orders.id', 'model:orders'],
  }
}

describe('validateQueryDraft', () => {
  test('returns a byte-stable, candidate-free report for equivalent valid drafts', () => {
    const first = validateQueryDraft({ ...baseInput, draft: validDraft() })
    const second = validateQueryDraft({
      ...baseInput,
      draft: {
        semanticReferences: ['model:orders', 'field:orders.id', 'metric:daily-revenue'],
        candidate: { sql: 'SELECT id FROM orders', kind: 'sql' },
        questionHash: 'a'.repeat(64),
        version: 1,
      },
    })

    expect(first).toEqual({
      status: 'valid',
      draftHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      questionHash: 'a'.repeat(64),
      canonicalReferences: ['field:orders.id', 'metric:daily-revenue', 'model:orders'],
      violations: [],
    })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.stringify(first)).not.toContain('SELECT')
  })

  test('fails closed with safe violations for malformed, unsafe, and unavailable inputs', () => {
    const write = 'UPDATE orders SET id = 1'
    const multiStatement = 'SELECT id FROM orders; SELECT id FROM orders'
    const blocked = 'SELECT id FROM vault'
    const cases: Array<[string, QueryDraftValidationInput]> = [
      ['malformed', { ...baseInput, draft: { version: 1 } }],
      [
        'write',
        { ...baseInput, draft: { ...validDraft(), candidate: { kind: 'sql', sql: write } } },
      ],
      [
        'multi-statement',
        {
          ...baseInput,
          draft: { ...validDraft(), candidate: { kind: 'sql', sql: multiStatement } },
        },
      ],
      [
        'unknown semantic reference',
        { ...baseInput, draft: { ...validDraft(), semanticReferences: ['field:orders.missing'] } },
      ],
      [
        'blacklisted SQL reference',
        {
          ...baseInput,
          blockedTerms: ['vault'],
          draft: { ...validDraft(), candidate: { kind: 'sql', sql: blocked } },
        },
      ],
      [
        'unknown saved query',
        {
          ...baseInput,
          draft: {
            ...validDraft(),
            candidate: { kind: 'saved-query', name: '@analytics/unknown' },
          },
        },
      ],
    ]

    for (const [name, input] of cases) {
      const report = validateQueryDraft(input)
      expect(report.status, name).toBe('invalid')
      expect(report.violations.length, name).toBeGreaterThan(0)
      expect(JSON.stringify(report), name).not.toContain('SELECT')
      expect(JSON.stringify(report), name).not.toContain('UPDATE')
      expect(JSON.stringify(report), name).not.toContain('vault')
      expect(JSON.stringify(report), name).not.toContain('missing')
      expect(JSON.stringify(report), name).not.toContain('@analytics/unknown')
    }
  })

  test('validates a named saved query from explicit metadata without reading its SQL body', () => {
    const report = validateQueryDraft({
      ...baseInput,
      draft: {
        version: 1,
        questionHash: 'b'.repeat(64),
        candidate: { kind: 'saved-query', name: '@analytics/revenue' },
        semanticReferences: ['metric:daily-revenue'],
      },
    })

    expect(report).toMatchObject({
      status: 'valid',
      questionHash: 'b'.repeat(64),
      canonicalReferences: ['metric:daily-revenue'],
      violations: [],
    })
  })

  test('accepts a declared field reference using a conventional schema identifier', () => {
    const select = 'SELECT created_at FROM orders'
    const report = validateQueryDraft({
      ...baseInput,
      context: {
        ...semanticContext,
        models: [
          {
            ...semanticContext.models[0],
            fields: [{ column: 'created_at', aliases: [] }],
          },
        ],
      },
      schema: { orders: { columns: [{ name: 'created_at' }] } },
      draft: {
        version: 1,
        questionHash: 'c'.repeat(64),
        candidate: { kind: 'sql', sql: select },
        semanticReferences: ['field:orders.created_at', 'model:orders'],
      },
    })

    expect(report.status).toBe('valid')
  })

  test('accepts a field reference without a redundant model reference', () => {
    const report = validateQueryDraft({
      ...baseInput,
      draft: {
        ...validDraft(),
        semanticReferences: ['field:orders.id'],
      },
    })

    expect(report.status).toBe('valid')
  })

  test('rejects wildcard and schema-qualified SQL without exposing protected names', () => {
    const wildcard = 'SELECT * FROM orders'
    const qualified = 'SELECT id FROM private.orders'
    const reports = [
      validateQueryDraft({
        ...baseInput,
        draft: { ...validDraft(), candidate: { kind: 'sql', sql: wildcard } },
      }),
      validateQueryDraft({
        ...baseInput,
        blockedTerms: ['private'],
        draft: { ...validDraft(), candidate: { kind: 'sql', sql: qualified } },
      }),
    ]

    for (const report of reports) {
      expect(report.status).toBe('invalid')
      expect(report.violations).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: expect.any(String) })])
      )
      expect(JSON.stringify(report)).not.toContain('private')
    }
  })

  test('validates an available saved query without reading or requiring a metric definition', () => {
    const report = validateQueryDraft({
      ...baseInput,
      savedQueryNames: ['@analytics/revenue', '@private/export'],
      draft: {
        version: 1,
        questionHash: 'd'.repeat(64),
        candidate: { kind: 'saved-query', name: '@private/export' },
        semanticReferences: ['model:orders'],
      },
    })

    expect(report).toMatchObject({
      status: 'valid',
      violations: [],
    })
    expect(JSON.stringify(report)).not.toContain('@private/export')
  })

  test('rejects malformed canonical field references', () => {
    const report = validateQueryDraft({
      ...baseInput,
      draft: { ...validDraft(), semanticReferences: ['field:orders.id;DROP'] },
    })

    expect(report).toMatchObject({
      status: 'invalid',
      violations: expect.arrayContaining([{ code: 'UNKNOWN_SEMANTIC_REFERENCE' }]),
    })
  })

  test('does not send a request or return an executable command while validating', () => {
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = async () => {
      fetchCalls++
      throw new Error('network must not be used')
    }

    try {
      const report = validateQueryDraft({ ...baseInput, draft: validDraft() })
      expect(fetchCalls).toBe(0)
      expect(report).toEqual({
        status: 'valid',
        draftHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        questionHash: 'a'.repeat(64),
        canonicalReferences: ['field:orders.id', 'metric:daily-revenue', 'model:orders'],
        violations: [],
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
