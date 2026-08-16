/**
 * `--no-limit` normalization.
 *
 * Commander folds a `--no-limit` flag into the `limit` attribute — `false` when
 * the flag is passed, `true` when it stands alone and is omitted — and never
 * produces `noLimit`. Every command reads `options.noLimit`, so without this
 * translation the documented escape hatch from the auto-limit does nothing, and
 * `export` (which now refuses to truncate) would have no way out at all.
 */

import { describe, test, expect } from 'bun:test'
import { normalizeLimitFlags } from '@/program'

describe('normalizeLimitFlags', () => {
  test('--no-limit (limit: false) becomes noLimit', () => {
    expect(normalizeLimitFlags({ limit: false }) as Record<string, unknown>).toEqual({
      limit: undefined,
      noLimit: true,
    })
  })

  test('an omitted standalone flag (limit: true) is not noLimit', () => {
    expect(normalizeLimitFlags({ limit: true }) as Record<string, unknown>).toEqual({
      limit: undefined,
      noLimit: false,
    })
  })

  test('a real row count survives untouched', () => {
    expect(normalizeLimitFlags({ limit: 500 }) as Record<string, unknown>).toEqual({
      limit: 500,
      noLimit: false,
    })
  })

  test('neither flag given leaves limit undefined', () => {
    expect(normalizeLimitFlags({}) as Record<string, unknown>).toEqual({ noLimit: false })
  })

  test('a boolean limit never reaches the command as a row count', () => {
    for (const value of [true, false]) {
      expect(normalizeLimitFlags({ limit: value }).limit).toBeUndefined()
    }
  })

  test('unrelated options are preserved', () => {
    expect(
      normalizeLimitFlags({ format: 'json', collection: 'users', limit: false }) as Record<
        string,
        unknown
      >
    ).toEqual({
      format: 'json',
      collection: 'users',
      limit: undefined,
      noLimit: true,
    })
  })

  test('does not mutate the input', () => {
    const input = { limit: false as unknown as number }
    normalizeLimitFlags(input)
    expect(input).toEqual({ limit: false as unknown as number })
  })
})
