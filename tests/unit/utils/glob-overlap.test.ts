import { describe, expect, test } from 'bun:test'
import { globsOverlap } from '@/utils/glob'

describe('globsOverlap', () => {
  test('decides Redis glob-language intersection instead of sampling one expansion', () => {
    expect(globsOverlap('session:*:*', 'session:admin:*')).toBe(true)
    expect(globsOverlap('session:*:public', 'session:[ab]dmin:public')).toBe(true)
    expect(globsOverlap('session:*', 'audit:*')).toBe(false)
    expect(globsOverlap('prefix:a?c', 'prefix:a[b-d]c')).toBe(true)
    expect(globsOverlap('prefix:a[0-2]', 'prefix:a[3-5]')).toBe(false)
  })
})
