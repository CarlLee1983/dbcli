import { describe, test, expect } from 'bun:test'
import { requireSchemaCacheOrThrow } from '@/core/inspect/require-schema-cache'
import { SchemaCacheMissingError } from '@/core/recovery'
import type { SchemaCacheSection, SnapshotSystem } from '@/core/inspect/types'

describe('requireSchemaCacheOrThrow', () => {
  test('returns void when SQL system has an available cache', () => {
    const section: SchemaCacheSection = { available: true, stale: false }
    expect(() => requireSchemaCacheOrThrow(section, 'postgresql')).not.toThrow()
  })

  test('throws SchemaCacheMissingError when SQL system + cache unavailable', () => {
    const section: SchemaCacheSection = { available: false }
    expect(() => requireSchemaCacheOrThrow(section, 'postgresql')).toThrow(SchemaCacheMissingError)
  })

  test('does not throw on non-SQL systems even when cache is unavailable', () => {
    const section: SchemaCacheSection = { available: false }
    for (const sys of ['redis', 'mongodb', 'elasticsearch'] as SnapshotSystem[]) {
      expect(() => requireSchemaCacheOrThrow(section, sys)).not.toThrow()
    }
  })

  test('does not throw when system is null (disconnected)', () => {
    const section: SchemaCacheSection = { available: false }
    expect(() => requireSchemaCacheOrThrow(section, null)).not.toThrow()
  })

  test('throws when section is unavailable (unreadable index)', () => {
    const section: SchemaCacheSection = {
      available: false,
      unavailable: true,
      reason: 'index.json unreadable',
    }
    expect(() => requireSchemaCacheOrThrow(section, 'mysql')).toThrow(SchemaCacheMissingError)
  })

  test('throw carries the system name in the error message', () => {
    const section: SchemaCacheSection = { available: false }
    try {
      requireSchemaCacheOrThrow(section, 'postgresql')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaCacheMissingError)
      expect((err as Error).message).toContain('postgresql')
    }
  })
})
