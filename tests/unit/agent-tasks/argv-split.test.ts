import { describe, test, expect } from 'bun:test'
import { splitArgv } from '@/core/agent-tasks/argv-split'

describe('splitArgv', () => {
  test('splits simple whitespace-separated args', () => {
    expect(splitArgv('blacklist list')).toEqual(['blacklist', 'list'])
  })

  test('keeps double-quoted strings together', () => {
    expect(splitArgv('plan "SELECT * FROM users"')).toEqual([
      'plan',
      'SELECT * FROM users',
    ])
  })

  test('keeps single-quoted strings together', () => {
    expect(splitArgv("update t --set '{\"name\":\"Bob\"}'")).toEqual([
      'update',
      't',
      '--set',
      '{"name":"Bob"}',
    ])
  })

  test('handles backslash escapes outside quotes', () => {
    expect(splitArgv('echo a\\ b c')).toEqual(['echo', 'a b', 'c'])
  })

  test('collapses repeated whitespace', () => {
    expect(splitArgv('  q   @dau   --format   json  ')).toEqual([
      'q',
      '@dau',
      '--format',
      'json',
    ])
  })

  test('throws on unterminated double quote', () => {
    expect(() => splitArgv('plan "unterminated')).toThrow(/unterminated/i)
  })

  test('returns empty array for empty input', () => {
    expect(splitArgv('')).toEqual([])
    expect(splitArgv('   ')).toEqual([])
  })
})
