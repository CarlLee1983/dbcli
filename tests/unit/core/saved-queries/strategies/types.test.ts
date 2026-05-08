import { describe, test, expect } from 'bun:test'
import type {
  EngineFamily,
  EngineStrategy,
  PreparedExecution,
} from '@/core/saved-queries/strategies/types'
import { engineFamily } from '@/core/saved-queries/strategies'

describe('strategies/types', () => {
  test('EngineFamily union covers sql/es/redis', () => {
    const families: EngineFamily[] = ['sql', 'es', 'redis']
    expect(families).toHaveLength(3)
  })

  test('PreparedExecution shape compiles', () => {
    const sample: PreparedExecution = {
      driver: { sql: 'SELECT 1', values: [] },
      rewrittenBody: 'SELECT 1',
      warnings: [],
    }
    expect(sample.driver.sql).toBe('SELECT 1')
  })

  test('EngineStrategy interface compiles', () => {
    const stub: EngineStrategy = {
      family: 'sql',
      validateBody: () => {},
      prepare: () => ({ driver: { sql: '', values: [] }, rewrittenBody: '', warnings: [] }),
    }
    expect(stub.family).toBe('sql')
  })
})

describe('engineFamily', () => {
  test('maps postgres/mysql to sql', () => {
    expect(engineFamily('postgres')).toBe('sql')
    expect(engineFamily('mysql')).toBe('sql')
  })

  test('maps elasticsearch to es', () => {
    expect(engineFamily('elasticsearch')).toBe('es')
  })

  test('maps redis to redis', () => {
    expect(engineFamily('redis')).toBe('redis')
  })
})
