import { describe, test, expect } from 'bun:test'
import { engineFamily } from '@/core/saved-queries/strategies'

describe('q command engine dispatch contract', () => {
  test('engine families exhaustive', () => {
    expect(engineFamily('postgres')).toBe('sql')
    expect(engineFamily('mysql')).toBe('sql')
    expect(engineFamily('elasticsearch')).toBe('es')
    expect(engineFamily('redis')).toBe('redis')
  })
})
