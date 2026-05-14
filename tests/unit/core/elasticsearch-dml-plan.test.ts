import { describe, expect, test } from 'bun:test'
import { buildElasticsearchDmlPlan } from '@/core/elasticsearch/dml-plan'

describe('buildElasticsearchDmlPlan', () => {
  test('insert intent records document body', () => {
    const intent = buildElasticsearchDmlPlan({
      operation: 'insert',
      target: 'products',
      data: { name: 'Widget' },
    })
    expect(intent).toEqual({
      operation: 'insert',
      target: 'products',
      data: { name: 'Widget' },
    })
  })

  test('update intent parses JSON where', () => {
    const intent = buildElasticsearchDmlPlan({
      operation: 'update',
      target: 'products',
      set: { stock: 0 },
      rawWhere: '{"_id":"abc"}',
    })
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.where).toEqual({ _id: 'abc' })
  })

  test('delete intent falls back to key=value where', () => {
    const intent = buildElasticsearchDmlPlan({
      operation: 'delete',
      target: 'products',
      rawWhere: '_id=abc',
    })
    if (intent.operation !== 'delete') throw new Error('type guard')
    expect(intent.where).toEqual({ _id: 'abc' })
  })

  test('rejects empty index', () => {
    expect(() =>
      buildElasticsearchDmlPlan({
        operation: 'insert',
        target: '',
        data: { name: 'x' },
      })
    ).toThrow(/index/i)
  })

  test('throws when rawWhere is neither JSON nor key=value', () => {
    expect(() =>
      buildElasticsearchDmlPlan({
        operation: 'delete',
        target: 'products',
        rawWhere: 'this is not parseable',
      })
    ).toThrow(/JSON object or simple key=value/i)
  })
})

import { analyzeElasticsearchDmlRisk } from '@/core/elasticsearch/dml-plan'
import type { NonSqlAnalyzerContext } from '@/core/dml-plan'

function ctx(overrides: Partial<NonSqlAnalyzerContext> = {}): NonSqlAnalyzerContext {
  return {
    permission: 'admin',
    blacklist: { tables: [], columns: {} },
    schema: { products: { name: 'products', columns: [{ name: 'name', type: 'text' }] } },
    ...overrides,
  }
}

describe('analyzeElasticsearchDmlRisk', () => {
  test('ALLOW for insert with _id and non-blacklisted fields', () => {
    const result = analyzeElasticsearchDmlRisk(
      { operation: 'insert', target: 'products', data: { _id: 'a', name: 'Widget' } },
      ctx()
    )
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('INSERT')
    expect(result.targetTables).toEqual(['products'])
  })

  test('WARN on insert without _id', () => {
    const result = analyzeElasticsearchDmlRisk(
      { operation: 'insert', target: 'products', data: { name: 'Widget' } },
      ctx()
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_missing_id')
  })

  test('BLOCK on update without _id', () => {
    const result = analyzeElasticsearchDmlRisk(
      {
        operation: 'update',
        target: 'products',
        set: { stock: 0 },
        where: { name: 'Widget' },
        rawWhere: '{"name":"Widget"}',
      },
      ctx()
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_missing_id')
  })

  test('BLOCK on delete without _id', () => {
    const result = analyzeElasticsearchDmlRisk(
      {
        operation: 'delete',
        target: 'products',
        where: { name: 'Widget' },
        rawWhere: '{"name":"Widget"}',
      },
      ctx()
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_missing_id')
  })

  test('BLOCK when index blacklisted', () => {
    const result = analyzeElasticsearchDmlRisk(
      { operation: 'insert', target: 'products', data: { _id: 'a', name: 'x' } },
      ctx({ blacklist: { tables: ['products'], columns: {} } })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('table_blacklisted')
  })

  test('BLOCK when insert writes blacklisted field', () => {
    const result = analyzeElasticsearchDmlRisk(
      { operation: 'insert', target: 'products', data: { _id: 'a', secret: 'x' } },
      ctx({ blacklist: { tables: [], columns: { products: ['secret'] } } })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('blacklisted_column')
  })

  test('BLOCK when permission insufficient', () => {
    const result = analyzeElasticsearchDmlRisk(
      {
        operation: 'delete',
        target: 'products',
        where: { _id: 'a' },
        rawWhere: '{"_id":"a"}',
      },
      ctx({ permission: 'query-only' })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('permission_denied')
  })

  test('ALLOW on delete by _id', () => {
    const result = analyzeElasticsearchDmlRisk(
      {
        operation: 'delete',
        target: 'products',
        where: { _id: 'abc' },
        rawWhere: '{"_id":"abc"}',
      },
      ctx()
    )
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('DELETE')
  })

  test('WARN when schema cache missing', () => {
    const result = analyzeElasticsearchDmlRisk(
      {
        operation: 'delete',
        target: 'orders',
        where: { _id: 'a' },
        rawWhere: '{"_id":"a"}',
      },
      ctx({ schema: {} })
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('schema_cache_missing')
  })

  test('update maps to UPDATE operation', () => {
    const result = analyzeElasticsearchDmlRisk(
      {
        operation: 'update',
        target: 'products',
        set: { stock: 0 },
        where: { _id: 'abc' },
        rawWhere: '{"_id":"abc"}',
      },
      ctx()
    )
    expect(result.operation).toBe('UPDATE')
  })
})
