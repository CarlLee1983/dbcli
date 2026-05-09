import { describe, test, expect } from 'bun:test'
import { parseArgv, ShellParseError } from '@/core/recovery/apply-shell'

describe('parseArgv', () => {
  test('parses simple commands', () => {
    expect(parseArgv('dbcli inspect --for-agent')).toEqual(['dbcli', 'inspect', '--for-agent'])
  })

  test('parses single-quoted args (preserves spaces)', () => {
    expect(parseArgv("dbcli blacklist remove 'my table'")).toEqual([
      'dbcli',
      'blacklist',
      'remove',
      'my table',
    ])
  })

  test('parses double-quoted args', () => {
    expect(parseArgv('dbcli q "@my snippet" --dry-run')).toEqual([
      'dbcli',
      'q',
      '@my snippet',
      '--dry-run',
    ])
  })

  test('handles standard escaped-quote pattern inside single quotes', () => {
    // The recovery-steps shellQuote helper produces: 'O'\''Brien'
    expect(parseArgv("dbcli blacklist remove 'O'\\''Brien'")).toEqual([
      'dbcli',
      'blacklist',
      'remove',
      "O'Brien",
    ])
  })

  for (const bad of [
    'dbcli inspect; ls',
    'dbcli inspect && rm -rf /',
    'dbcli inspect | head',
    'dbcli inspect > /tmp/x',
    'dbcli inspect < /etc/passwd',
    'dbcli inspect $(whoami)',
    'dbcli inspect `whoami`',
    'dbcli inspect $HOME',
    'dbcli q @foo*',
    'dbcli q @foo?',
    'dbcli inspect (subshell)',
  ]) {
    test(`rejects metacharacter / operator: ${bad}`, () => {
      expect(() => parseArgv(bad)).toThrow(ShellParseError)
    })
  }

  test('rejects empty string', () => {
    expect(() => parseArgv('')).toThrow(ShellParseError)
  })

  test('rejects unterminated quote', () => {
    expect(() => parseArgv("dbcli q 'unterminated")).toThrow(ShellParseError)
  })
})
