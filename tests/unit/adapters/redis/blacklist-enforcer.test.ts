import { test, expect } from 'bun:test'
import { globToRegex, patternsOverlap, checkKeyArgs } from '@/adapters/redis/blacklist-enforcer'

const RULES = ['user:*:password', 'secrets:*']

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

test('GET on non-matching key allowed', () => {
  const r = checkKeyArgs('GET', ['user:42:profile'], RULES)
  expect(r.ok).toBe(true)
})

test('GET on matching key rejected', () => {
  const r = checkKeyArgs('GET', ['user:42:password'], RULES)
  expect(r.ok).toBe(false)
  expect(r.matchedKey).toBe('user:42:password')
  expect(r.matchedPattern).toBe('user:*:password')
})

test('MGET with any matching key rejected entirely', () => {
  const r = checkKeyArgs('MGET', ['user:1:profile', 'secrets:foo', 'user:2:profile'], RULES)
  expect(r.ok).toBe(false)
  expect(r.matchedKey).toBe('secrets:foo')
})

test('DEL multi-variable with all-safe keys passes', () => {
  const r = checkKeyArgs('DEL', ['a', 'b', 'c'], RULES)
  expect(r.ok).toBe(true)
})

test('RENAME multi-fixed checks both args', () => {
  const r = checkKeyArgs('RENAME', ['safe', 'secrets:foo'], RULES)
  expect(r.ok).toBe(false)
})

test('KEYS pattern overlapping blacklist is rejected', () => {
  const r = checkKeyArgs('KEYS', ['user:*:password'], RULES)
  expect(r.ok).toBe(false)
  expect(r.matchedPattern).toBe('user:*:password')
})

test('KEYS pattern non-overlapping is allowed', () => {
  const r = checkKeyArgs('KEYS', ['order:*'], RULES)
  expect(r.ok).toBe(true)
})

test('no-key commands always pass', () => {
  expect(checkKeyArgs('PING', [], RULES).ok).toBe(true)
})

test('unknown command is refused, not treated as no-arity', () => {
  // This asserted `.ok === true` — the fail-open that made every gap between
  // the permission map and the metadata table a blacklist bypass. dbcli cannot
  // say where an unknown command's keys are, so with a blacklist configured it
  // does not forward it.
  expect(checkKeyArgs('NONSENSE', [], RULES).ok).toBe(false)
})

test('an unknown command with no blacklist configured is not refused', () => {
  // Fail-closed applies to a user who has asked for protection. One who has
  // not configured a blacklist keeps every command dbcli's permission tier
  // allows, whether or not this table has a spec for it.
  expect(checkKeyArgs('NONSENSE', [], []).ok).toBe(true)
})
