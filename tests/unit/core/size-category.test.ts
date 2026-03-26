import { describe, it, expect } from 'vitest'
import { getSizeCategory, type SizeCategory } from '@/core/size-category'

describe('getSizeCategory', () => {
  it('returns "small" for < 10_000 rows', () => {
    expect(getSizeCategory(0)).toBe('small')
    expect(getSizeCategory(9_999)).toBe('small')
  })

  it('returns "medium" for 10_000 - 99_999 rows', () => {
    expect(getSizeCategory(10_000)).toBe('medium')
    expect(getSizeCategory(99_999)).toBe('medium')
  })

  it('returns "large" for 100_000 - 999_999 rows', () => {
    expect(getSizeCategory(100_000)).toBe('large')
    expect(getSizeCategory(999_999)).toBe('large')
  })

  it('returns "huge" for >= 1_000_000 rows', () => {
    expect(getSizeCategory(1_000_000)).toBe('huge')
    expect(getSizeCategory(50_000_000)).toBe('huge')
  })

  it('returns "small" for undefined/null', () => {
    expect(getSizeCategory(undefined)).toBe('small')
    expect(getSizeCategory(null as any)).toBe('small')
  })
})
