import { describe, expect, test } from 'bun:test'
import { buildMongoDmlPlan, flattenInsertPaths } from '@/core/mongo/dml-plan'

describe('buildMongoDmlPlan', () => {
  test('insert intent passes data through', () => {
    const intent = buildMongoDmlPlan({
      operation: 'insert',
      target: 'users',
      data: { name: 'Alice' },
    })
    expect(intent).toEqual({
      operation: 'insert',
      target: 'users',
      data: { name: 'Alice' },
    })
  })

  test('update intent parses JSON where', () => {
    const intent = buildMongoDmlPlan({
      operation: 'update',
      target: 'users',
      set: { status: 'inactive' },
      rawWhere: '{"_id":"abc"}',
    })
    expect(intent.operation).toBe('update')
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.set).toEqual({ status: 'inactive' })
    expect(intent.where).toEqual({ _id: 'abc' })
    expect(intent.rawWhere).toBe('{"_id":"abc"}')
  })

  test('update intent falls back to key=value where', () => {
    const intent = buildMongoDmlPlan({
      operation: 'update',
      target: 'users',
      set: { status: 'inactive' },
      rawWhere: 'id=42',
    })
    if (intent.operation !== 'update') throw new Error('type guard')
    expect(intent.where).toEqual({ id: 42 })
  })

  test('delete intent records empty filter as empty object', () => {
    const intent = buildMongoDmlPlan({
      operation: 'delete',
      target: 'users',
      rawWhere: '{}',
    })
    if (intent.operation !== 'delete') throw new Error('type guard')
    expect(intent.where).toEqual({})
    expect(intent.rawWhere).toBe('{}')
  })

  test('throws on rawWhere that is neither JSON nor key=value', () => {
    expect(() =>
      buildMongoDmlPlan({
        operation: 'delete',
        target: 'users',
        rawWhere: 'this is not parseable',
      })
    ).toThrow(/JSON object or simple key=value/i)
  })

  test('rejects empty target', () => {
    expect(() =>
      buildMongoDmlPlan({
        operation: 'insert',
        target: '',
        data: { name: 'Alice' },
      })
    ).toThrow(/collection/i)
  })
})

import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'
import type { NonSqlAnalyzerContext } from '@/core/dml-plan'

function ctx(overrides: Partial<NonSqlAnalyzerContext> = {}): NonSqlAnalyzerContext {
  return {
    permission: 'admin',
    blacklist: { tables: [], columns: {} },
    schema: {
      users: { name: 'users', columns: [{ name: '_id', type: 'string', nullable: false }] },
    },
    ...overrides,
  }
}

describe('analyzeMongoDmlRisk', () => {
  test('ALLOW for insert with non-blacklisted fields', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'insert', target: 'users', data: { name: 'Alice' } },
      ctx()
    )
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('INSERT')
    expect(result.targetTables).toEqual(['users'])
    expect(result.riskFactors).toEqual([])
  })

  test('BLOCK when permission insufficient (query-only on insert)', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'insert', target: 'users', data: { name: 'Alice' } },
      ctx({ permission: 'query-only' })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('permission_denied')
  })

  test('BLOCK when collection blacklisted', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'insert', target: 'users', data: { name: 'Alice' } },
      ctx({ blacklist: { tables: ['users'], columns: {} } })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('table_blacklisted')
  })

  test('BLOCK when insert writes blacklisted field', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'insert', target: 'users', data: { ssn: '123' } },
      ctx({ blacklist: { tables: [], columns: { users: ['ssn'] } } })
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('blacklisted_column')
  })

  test('BLOCK when update filter is empty object', () => {
    const result = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { status: 'inactive' },
        where: {},
        rawWhere: '{}',
      },
      ctx()
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_filter_empty')
  })

  test('BLOCK when delete filter is empty object', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'delete', target: 'users', where: {}, rawWhere: '{}' },
      ctx()
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_filter_empty')
  })

  test('BLOCK when update uses $where operator', () => {
    const result = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { $where: 'function() { return true }' },
        where: { _id: 'abc' },
        rawWhere: '{"_id":"abc"}',
      },
      ctx()
    )
    expect(result.decision).toBe('BLOCK')
    expect(result.riskFactors.map((f) => f.code)).toContain('mongo_unknown_operator')
  })

  test('WARN when update uses $rename (RENAME tier)', () => {
    const result = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { $rename: { old: 'new' } },
        where: { _id: 'abc' },
        rawWhere: '{"_id":"abc"}',
      },
      ctx()
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('mongo_rename_operator')
  })

  test('ALLOW update by _id with $set', () => {
    const result = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { $set: { status: 'inactive' } },
        where: { _id: 'abc' },
        rawWhere: '{"_id":"abc"}',
      },
      ctx()
    )
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('UPDATE')
  })

  test('ALLOW delete by _id', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'delete', target: 'users', where: { _id: 'abc' }, rawWhere: '{"_id":"abc"}' },
      ctx()
    )
    expect(result.decision).toBe('ALLOW')
    expect(result.operation).toBe('DELETE')
  })

  test('WARN on $regex filter even with equality field', () => {
    const result = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { $set: { status: 'x' } },
        where: { name: { $regex: '^A' } },
        rawWhere: '{"name":{"$regex":"^A"}}',
      },
      ctx()
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_filter_broad')
  })

  test('WARN on update with equality filter that is not _id', () => {
    const result = analyzeMongoDmlRisk(
      {
        operation: 'update',
        target: 'users',
        set: { $set: { status: 'x' } },
        where: { email: 'a@b.com' },
        rawWhere: '{"email":"a@b.com"}',
      },
      ctx()
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('nonsql_missing_id')
  })

  test('WARN when schema cache missing for target', () => {
    const result = analyzeMongoDmlRisk(
      { operation: 'delete', target: 'orders', where: { _id: 'abc' }, rawWhere: '{"_id":"abc"}' },
      ctx({ schema: {} })
    )
    expect(result.decision).toBe('WARN')
    expect(result.riskFactors.map((f) => f.code)).toContain('schema_cache_missing')
  })
})

describe('flattenInsertPaths', () => {
  test('for a flat object (e.g. SQL insert data), the result equals Object.keys', () => {
    const data = { name: 'Alice', age: 30, active: true }
    expect(flattenInsertPaths(data).sort()).toEqual(Object.keys(data).sort())
  })

  test('includes both the parent key and dotted child paths for a nested object', () => {
    const data = { user: { password: 'secret' }, name: 'Alice' }
    expect(flattenInsertPaths(data).sort()).toEqual(['name', 'user', 'user.password'].sort())
  })
})
