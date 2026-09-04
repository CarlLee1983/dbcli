/**
 * `DATABASE_SYSTEMS` is the runtime roster of engines. `satisfies` and the
 * `AssertNever` alias in `src/adapters/types.ts` tie it to the `DatabaseSystem`
 * union at compile time, but nothing tied it to `ENGINE_CAPABILITIES`, whose
 * keys are the roster everything engine-facing actually iterates. A comment
 * claimed this test existed before it did.
 */
import { describe, expect, test } from 'bun:test'
import { DATABASE_SYSTEMS } from '@/adapters/types'
import { ENGINE_CAPABILITIES } from '@/adapters/capabilities'

describe('DATABASE_SYSTEMS roster', () => {
  test('holds exactly the keys of ENGINE_CAPABILITIES', () => {
    // Compared as plain strings so the assertion needs no cast: the point is
    // that the two rosters hold the same names, not that they share a type.
    expect([...DATABASE_SYSTEMS].map(String).sort()).toEqual(
      Object.keys(ENGINE_CAPABILITIES).sort()
    )
  })

  test('has no duplicates', () => {
    expect(new Set(DATABASE_SYSTEMS).size).toBe(DATABASE_SYSTEMS.length)
  })

  test('is frozen, so a caller cannot reorder the published engine order', () => {
    expect(Object.isFrozen(DATABASE_SYSTEMS)).toBe(true)
  })
})
