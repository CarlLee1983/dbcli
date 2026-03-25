/**
 * Unit tests for Levenshtein distance utility
 */

import { test, expect, describe } from 'vitest'
import { levenshteinDistance } from '../../../src/utils/levenshtein-distance'

describe('levenshteinDistance', () => {
  test('returns 0 for identical strings', () => {
    expect(levenshteinDistance('users', 'users')).toBe(0)
    expect(levenshteinDistance('', '')).toBe(0)
    expect(levenshteinDistance('hello', 'hello')).toBe(0)
  })

  test('returns string length when comparing with empty string', () => {
    expect(levenshteinDistance('users', '')).toBe(5)
    expect(levenshteinDistance('', 'hello')).toBe(5)
    expect(levenshteinDistance('a', '')).toBe(1)
  })

  test('handles single character deletion', () => {
    // 'users' -> 'usrs' requires 1 deletion
    expect(levenshteinDistance('users', 'usrs')).toBe(1)
  })

  test('handles single character substitution', () => {
    // 'cat' -> 'bat' requires 1 substitution
    expect(levenshteinDistance('cat', 'bat')).toBe(1)
    // 'users' -> 'uders' requires 1 substitution
    expect(levenshteinDistance('users', 'uders')).toBe(1)
  })

  test('handles single character insertion', () => {
    // 'cat' -> 'cart' requires 1 insertion
    expect(levenshteinDistance('cat', 'cart')).toBe(1)
  })

  test('handles classic example: kitten to sitting', () => {
    // kitten -> sitten (substitution) -> sittin (substitution) -> sitting (insertion)
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
  })

  test('handles multiple operations required', () => {
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3)
  })

  test('is case-sensitive', () => {
    // 'Users' and 'users' differ in case
    expect(levenshteinDistance('Users', 'users')).toBe(1)
  })

  test('handles completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3)
  })

  test('is symmetric (order does not matter)', () => {
    expect(levenshteinDistance('abc', 'bac')).toBe(levenshteinDistance('bac', 'abc'))
    expect(levenshteinDistance('users', 'usrs')).toBe(levenshteinDistance('usrs', 'users'))
  })

  test('handles longer strings', () => {
    const dist = levenshteinDistance(
      'The quick brown fox',
      'The quick brown dog'
    )
    expect(dist).toBe(2) // fox -> dog requires 2 substitutions
  })

  test('handles strings with special characters', () => {
    expect(levenshteinDistance('user-id', 'user_id')).toBe(1)
    expect(levenshteinDistance('users@old', 'users@new')).toBe(3)
  })

  test('handles numbers as strings', () => {
    expect(levenshteinDistance('123', '124')).toBe(1)
    expect(levenshteinDistance('100', '1000')).toBe(1)
  })

  test('returns correct distance for common typos', () => {
    // Common database table name typos
    expect(levenshteinDistance('customers', 'customres')).toBe(2) // Swapped letters
    expect(levenshteinDistance('orders', 'order')).toBe(1) // Missing 's'
    expect(levenshteinDistance('products', 'products_old')).toBe(4) // Suffix added
  })

  test('is consistent across multiple calls', () => {
    const dist1 = levenshteinDistance('hello', 'hallo')
    const dist2 = levenshteinDistance('hello', 'hallo')
    expect(dist1).toBe(dist2)
  })

  test('handles very long strings', () => {
    const str1 = 'a'.repeat(100)
    const str2 = 'a'.repeat(101)
    expect(levenshteinDistance(str1, str2)).toBe(1)
  })

  test('handles strings with repeated characters', () => {
    expect(levenshteinDistance('aaa', 'aaa')).toBe(0)
    expect(levenshteinDistance('aaa', 'aa')).toBe(1)
    expect(levenshteinDistance('aaa', 'aaaa')).toBe(1)
  })
})
