// tests/core/repl/command-dispatcher.test.ts
import { describe, test, expect } from 'bun:test'
import { parseCommandLine, isKnownCommand } from '../../../src/core/repl/command-dispatcher'

describe('parseCommandLine', () => {
  test('parses simple command', () => {
    const result = parseCommandLine('list')
    expect(result.command).toBe('list')
    expect(result.args).toEqual([])
  })

  test('parses command with arguments', () => {
    const result = parseCommandLine('schema users')
    expect(result.command).toBe('schema')
    expect(result.args).toEqual(['users'])
  })

  test('parses command with multiple arguments', () => {
    const result = parseCommandLine('query "SELECT * FROM users" --format json')
    expect(result.command).toBe('query')
    expect(result.args).toEqual(['"SELECT * FROM users"', '--format', 'json'])
  })

  test('parses command with flags', () => {
    const result = parseCommandLine('schema users --format json')
    expect(result.command).toBe('schema')
    expect(result.args).toEqual(['users', '--format', 'json'])
  })

  test('handles subcommand group (blacklist list)', () => {
    const result = parseCommandLine('blacklist list')
    expect(result.command).toBe('blacklist')
    expect(result.args).toEqual(['list'])
  })

  test('trims whitespace', () => {
    const result = parseCommandLine('  list  ')
    expect(result.command).toBe('list')
    expect(result.args).toEqual([])
  })
})

describe('isKnownCommand', () => {
  test('recognizes list', () => {
    expect(isKnownCommand('list')).toBe(true)
  })

  test('recognizes schema', () => {
    expect(isKnownCommand('schema')).toBe(true)
  })

  test('recognizes blacklist', () => {
    expect(isKnownCommand('blacklist')).toBe(true)
  })

  test('rejects unknown command', () => {
    expect(isKnownCommand('foobar')).toBe(false)
  })

  test('rejects SQL keyword', () => {
    expect(isKnownCommand('SELECT')).toBe(false)
  })

  test('does not recognize shell command (prevent recursion)', () => {
    expect(isKnownCommand('shell')).toBe(false)
  })
})
