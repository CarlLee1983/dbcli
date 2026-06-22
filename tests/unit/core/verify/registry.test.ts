import { describe, test, expect } from 'bun:test'
import { BUILTIN_VERIFY_SCENARIOS } from '@/commands/verify'
import type { VerifyScenarioSubjectKind } from '@/core/verify'

const SUBJECT_KINDS: VerifyScenarioSubjectKind[] = ['table', 'migration', 'rollback']
const REQUIRED_HOOKS = [
  'configureOptions',
  'normalize',
  'createRunners',
  'runPreflight',
  'runAfterWrite',
  'renderPreflight',
  'artifactOf',
  'afterWriteJson',
  'renderAfterWriteTable',
  'isPreflightReady',
  'isAfterWriteVerified',
] as const

describe('BUILTIN_VERIFY_SCENARIOS registry', () => {
  test('contains exactly the expected built-in scenario names', () => {
    const names = BUILTIN_VERIFY_SCENARIOS.map((s) => s.name).sort()
    expect(names).toEqual(['migration', 'rollback', 'safe-backfill'])
  })

  test('scenario names are unique', () => {
    const names = BUILTIN_VERIFY_SCENARIOS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('scenario names are CLI-safe (lowercase, no spaces)', () => {
    for (const s of BUILTIN_VERIFY_SCENARIOS) {
      expect(s.name).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(s.name).not.toContain(' ')
    }
  })

  test('every scenario declares a supported subjectKind', () => {
    for (const s of BUILTIN_VERIFY_SCENARIOS) {
      expect(SUBJECT_KINDS).toContain(s.subjectKind)
    }
  })

  test('every scenario exposes the required lifecycle hooks', () => {
    for (const s of BUILTIN_VERIFY_SCENARIOS) {
      expect(typeof s.name).toBe('string')
      expect(s.name.length).toBeGreaterThan(0)
      expect(typeof s.description).toBe('string')
      expect(s.description.length).toBeGreaterThan(0)
      for (const hook of REQUIRED_HOOKS) {
        expect(typeof (s as unknown as Record<string, unknown>)[hook]).toBe('function')
      }
    }
  })
})
