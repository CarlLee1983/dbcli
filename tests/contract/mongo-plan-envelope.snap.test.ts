import { describe, test, expect } from 'bun:test'
import { analyzeMongoDmlRisk } from '@/core/mongo/dml-plan'
import type { DmlPlanIntent, NonSqlAnalyzerContext } from '@/core/dml-plan'

const ctx: NonSqlAnalyzerContext = {
  permission: 'admin',
  blacklist: { tables: [], columns: { users: ['profile.tokens.*'] } },
  schema: {
    users: {
      name: 'users',
      columns: [{ name: '_id', type: 'ObjectId', nullable: false }],
    },
  },
}

describe('mongo plan envelope contract', () => {
  test('arithmetic operator produces stable envelope shape', () => {
    const intent: DmlPlanIntent = {
      operation: 'update',
      target: 'users',
      set: { $inc: { credits: 5 } },
      where: { _id: 'abc' },
      rawWhere: '{"_id":"abc"}',
    }
    const r = analyzeMongoDmlRisk(intent, ctx)
    expect({
      decision: r.decision,
      operation: r.operation,
      codes: r.riskFactors.map((f) => f.code).sort(),
      severities: r.riskFactors.map((f) => f.severity).sort(),
    }).toEqual({
      decision: 'WARN',
      operation: 'UPDATE',
      codes: ['mongo_arithmetic_operator'],
      severities: ['warn'],
    })
  })

  test('blacklisted nested path produces stable envelope shape', () => {
    const intent: DmlPlanIntent = {
      operation: 'update',
      target: 'users',
      set: { $set: { 'profile.tokens.access': 'X' } },
      where: { _id: 'abc' },
      rawWhere: '{"_id":"abc"}',
    }
    const r = analyzeMongoDmlRisk(intent, ctx)
    expect({
      decision: r.decision,
      codes: r.riskFactors.map((f) => f.code).sort(),
    }).toEqual({
      decision: 'BLOCK',
      codes: ['blacklisted_column'],
    })
  })

  test('unknown operator produces block envelope', () => {
    const intent: DmlPlanIntent = {
      operation: 'update',
      target: 'users',
      set: { $weird: { x: 1 } },
      where: { _id: 'abc' },
      rawWhere: '{"_id":"abc"}',
    }
    const r = analyzeMongoDmlRisk(intent, ctx)
    expect(r.decision).toBe('BLOCK')
    expect(r.riskFactors.find((f) => f.code === 'mongo_unknown_operator')).toBeDefined()
  })
})
