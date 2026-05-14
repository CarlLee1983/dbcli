import { describe, expect, test } from 'bun:test'
import { buildRedisDmlPlan } from '@/core/redis/dml-plan'

describe('buildRedisDmlPlan', () => {
  test('insert intent passes through data', () => {
    const intent = buildRedisDmlPlan({
      operation: 'insert',
      target: 'session:abc',
      data: { value: '1' },
    })
    expect(intent).toEqual({
      operation: 'insert',
      target: 'session:abc',
      data: { value: '1' },
    })
  })

  test('update intent normalizes set', () => {
    const intent = buildRedisDmlPlan({
      operation: 'update',
      target: 'user:42',
      set: { name: 'Alice' },
      rawWhere: '',
    })
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.target).toBe('user:42')
    expect(intent.set).toEqual({ name: 'Alice' })
    expect(intent.where).toBeNull()
    expect(intent.rawWhere).toBe('')
  })

  test('delete intent preserves wildcard target verbatim', () => {
    const intent = buildRedisDmlPlan({ operation: 'delete', target: '*', rawWhere: '' })
    if (intent.operation !== 'delete') throw new Error('type guard')
    expect(intent.target).toBe('*')
  })

  test('rejects empty target', () => {
    expect(() => buildRedisDmlPlan({ operation: 'delete', target: '   ', rawWhere: '' })).toThrow(
      /key/i
    )
  })
})

import { analyzeRedisDmlRisk } from '@/core/redis/dml-plan'
import type { NonSqlAnalyzerContext } from '@/core/dml-plan'

function ctx(overrides: Partial<NonSqlAnalyzerContext> = {}): NonSqlAnalyzerContext {
  return {
    permission: 'admin',
    blacklist: { tables: [], columns: {} },
    schema: { 'user:*': { name: 'user:*', columns: [] } },
    ...overrides,
  }
}

describe('analyzeRedisDmlRisk', () => {
  test('ALLOW for single-key delete', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'delete', target: 'user:42', where: null, rawWhere: '' },
      ctx()
    )
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('DELETE')
    expect(result.targetTables).toEqual(['user:42'])
  })

  test('BLOCK on wildcard `*` delete', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'delete', target: '*', where: null, rawWhere: '' },
      ctx()
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_key_pattern_broad')
  })

  test('BLOCK when permission insufficient', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'delete', target: 'user:42', where: null, rawWhere: '' },
      ctx({ permission: 'query-only' })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('permission_denied')
  })

  test('BLOCK when key prefix matches blacklist table', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'delete', target: 'user:42', where: null, rawWhere: '' },
      ctx({ blacklist: { tables: ['user:42'], columns: {} } })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('table_blacklisted')
  })

  test('BLOCK when update writes blacklisted field', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'update', target: 'user:42', set: { ssn: '1' }, where: null, rawWhere: '' },
      ctx({ blacklist: { tables: [], columns: { 'user:42': ['ssn'] } } })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('blacklisted_column')
  })

  test('WARN on wildcard-suffix key pattern', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'delete', target: 'user:*', where: null, rawWhere: '' },
      ctx()
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_key_pattern_broad')
  })

  test('WARN on update with empty set (no field info)', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'update', target: 'user:42', set: {}, where: null, rawWhere: '' },
      ctx()
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_overwrite_unknown')
  })

  test('WARN when schema cache empty', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'delete', target: 'user:42', where: null, rawWhere: '' },
      ctx({ schema: {} })
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('schema_cache_missing')
  })

  test('insert maps to INSERT operation', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'insert', target: 'user:42', data: { value: '1' } },
      ctx()
    )
    expect(result.operation).toBe('INSERT')
  })

  test('update maps to UPDATE operation', () => {
    const result = analyzeRedisDmlRisk(
      { operation: 'update', target: 'user:42', set: { name: 'A' }, where: null, rawWhere: '' },
      ctx()
    )
    expect(result.operation).toBe('UPDATE')
  })
})
