import { test, expect } from 'bun:test'
import { globToRegex, patternsOverlap } from '@/adapters/redis/blacklist-enforcer'

test('* matches any chars', () => {
  expect(globToRegex('user:*').test('user:42')).toBe(true)
  expect(globToRegex('user:*').test('order:42')).toBe(false)
})

test('? matches one char', () => {
  expect(globToRegex('k?').test('ka')).toBe(true)
  expect(globToRegex('k?').test('kab')).toBe(false)
})

test('[abc] matches one of', () => {
  expect(globToRegex('k[ab]').test('ka')).toBe(true)
  expect(globToRegex('k[ab]').test('kc')).toBe(false)
})

test('[a-z] matches range', () => {
  expect(globToRegex('k[a-z]').test('km')).toBe(true)
  expect(globToRegex('k[a-z]').test('k0')).toBe(false)
})

test('special regex chars are escaped', () => {
  expect(globToRegex('a.b').test('a.b')).toBe(true)
  expect(globToRegex('a.b').test('axb')).toBe(false)
})

test('patternsOverlap: identical', () => {
  expect(patternsOverlap('user:*', 'user:*')).toBe(true)
})

test('patternsOverlap: subset', () => {
  expect(patternsOverlap('user:secrets:*', 'user:*')).toBe(true)
  expect(patternsOverlap('user:*', 'user:secrets:*')).toBe(true)
})

test('patternsOverlap: disjoint', () => {
  expect(patternsOverlap('order:*', 'user:*')).toBe(false)
})

test('patternsOverlap: prefix match', () => {
  expect(patternsOverlap('user:42', 'user:*')).toBe(true)
})
