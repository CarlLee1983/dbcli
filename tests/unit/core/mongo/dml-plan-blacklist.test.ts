import { describe, test, expect } from 'bun:test'
import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'
import type { DmlPlanIntent, NonSqlAnalyzerContext } from '@/core/dml-plan'

const ctx = (cols: string[]): NonSqlAnalyzerContext => ({
  permission: 'admin',
  blacklist: { tables: [], columns: { users: cols } },
  schema: {
    users: {
      name: 'users',
      columns: [{ name: '_id', type: 'ObjectId', nullable: false }],
    },
  },
})

const updateIntent = (set: Record<string, unknown>): DmlPlanIntent => ({
  operation: 'update',
  target: 'users',
  set,
  where: { _id: 'abc' },
  rawWhere: '{"_id":"abc"}',
})

const insertIntent = (data: Record<string, unknown>): DmlPlanIntent => ({
  operation: 'insert',
  target: 'users',
  data,
})

describe('mongo blacklist nested-path enforcement on writes', () => {
  test('exact dotted path hits via $set', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $set: { 'profile.email': 'x' } }),
      ctx(['profile.email'])
    )
    expect(r.decision).toBe('BLOCK')
    expect(r.riskFactors.find((f) => f.code === 'blacklisted_column')).toBeDefined()
  })

  test('suffix wildcard hits via $set on subtree leaf', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $set: { 'profile.tokens.access': 'X' } }),
      ctx(['profile.tokens.*'])
    )
    expect(r.decision).toBe('BLOCK')
  })

  test('suffix wildcard hits via $unset on the root', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $unset: { 'profile.tokens': '' } }),
      ctx(['profile.tokens.*'])
    )
    expect(r.decision).toBe('BLOCK')
  })

  test('$inc payload key is matched as a dot-path', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $inc: { 'profile.tokens.uses': 1 } }),
      ctx(['profile.tokens.*'])
    )
    expect(r.decision).toBe('BLOCK')
  })

  test('non-matching path passes', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $set: { 'profile.name': 'A' } }),
      ctx(['profile.email'])
    )
    expect(r.decision).toBe('ALLOW')
  })

  test('insert with nested blacklisted path is blocked', () => {
    const r = analyzeMongoDmlRisk(
      insertIntent({ _id: 'x', profile: { email: 'a@b' } }),
      ctx(['profile.email'])
    )
    expect(r.decision).toBe('BLOCK')
  })

  test('insert with non-blacklisted top-level is allowed', () => {
    const r = analyzeMongoDmlRisk(insertIntent({ _id: 'x', name: 'A' }), ctx(['password']))
    expect(r.decision).toBe('ALLOW')
  })

  test('_id write hit is blocked', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $set: { _id: 'new' } }), ctx(['_id']))
    expect(r.decision).toBe('BLOCK')
  })
})
