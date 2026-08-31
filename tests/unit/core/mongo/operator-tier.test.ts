import { describe, test, expect } from 'bun:test'
import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'
import type { DmlPlanIntent, NonSqlAnalyzerContext } from '@/core/dml-plan'

const baseContext = (): NonSqlAnalyzerContext => ({
  permission: 'admin',
  blacklist: { tables: [], columns: {} },
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

describe('mongo operator tier classification', () => {
  test('SAFE: $set keeps decision ALLOW', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $set: { name: 'A' } }), baseContext())
    expect(r.decision).toBe('ALLOW')
    expect(r.riskFactors.find((f) => f.code.startsWith('mongo_'))).toBeUndefined()
  })

  test('SAFE: implicit $set keeps decision ALLOW', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ name: 'A' }), baseContext())
    expect(r.decision).toBe('ALLOW')
  })

  test('RENAME tier emits factor', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $rename: { old: 'newer' } }), baseContext())
    const factor = r.riskFactors.find((f) => f.code === 'mongo_rename_operator')
    expect(factor).toBeDefined()
    // A renamed field's value survives under the new name, which the read mask
    // does not recognize — this is not a safe, non-exfiltrating operation.
    expect(factor?.message).not.toContain('does not exfiltrate')
    expect(factor?.message).toContain('read mask')
  })

  test('ARITHMETIC tier emits warn factor, decision WARN', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $inc: { credits: 10 } }), baseContext())
    expect(r.decision).toBe('WARN')
    expect(r.riskFactors.find((f) => f.code === 'mongo_arithmetic_operator')).toBeDefined()
  })

  test('ARRAY tier emits warn factor', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $push: { tags: 'new' } }), baseContext())
    expect(r.decision).toBe('WARN')
    expect(r.riskFactors.find((f) => f.code === 'mongo_array_operator')).toBeDefined()
  })

  test('BITWISE tier emits warn factor', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $bit: { flags: { or: 1 } } }), baseContext())
    expect(r.decision).toBe('WARN')
    expect(r.riskFactors.find((f) => f.code === 'mongo_bitwise_operator')).toBeDefined()
  })

  test('BLOCK tier: $where forces BLOCK', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $where: 'function() { return true }' }),
      baseContext()
    )
    expect(r.decision).toBe('BLOCK')
    expect(r.riskFactors.find((f) => f.code === 'mongo_unknown_operator')).toBeDefined()
  })

  test('Unknown $ operator forces BLOCK', () => {
    const r = analyzeMongoDmlRisk(updateIntent({ $weirdOp: { x: 1 } }), baseContext())
    expect(r.decision).toBe('BLOCK')
    expect(r.riskFactors.find((f) => f.code === 'mongo_unknown_operator')).toBeDefined()
  })

  test('multiple operators stack their factors', () => {
    const r = analyzeMongoDmlRisk(
      updateIntent({ $set: { a: 1 }, $inc: { b: 1 }, $push: { c: 'x' } }),
      baseContext()
    )
    const codes = r.riskFactors.map((f) => f.code)
    expect(codes).toContain('mongo_arithmetic_operator')
    expect(codes).toContain('mongo_array_operator')
    expect(r.decision).toBe('WARN')
  })
})
