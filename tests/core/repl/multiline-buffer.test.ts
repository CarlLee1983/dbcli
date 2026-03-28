// tests/core/repl/multiline-buffer.test.ts
import { describe, test, expect } from 'bun:test'
import { MultilineBuffer } from '../../../src/core/repl/multiline-buffer'

describe('MultilineBuffer', () => {
  test('single-line SQL with semicolon returns complete', () => {
    const buf = new MultilineBuffer()
    const result = buf.append('SELECT * FROM users;')
    expect(result.complete).toBe(true)
    expect(result.sql).toBe('SELECT * FROM users;')
  })

  test('single-line without semicolon returns incomplete', () => {
    const buf = new MultilineBuffer()
    const result = buf.append('SELECT *')
    expect(result.complete).toBe(false)
    expect(result.sql).toBeUndefined()
  })

  test('multi-line accumulates until semicolon', () => {
    const buf = new MultilineBuffer()

    const r1 = buf.append('SELECT *')
    expect(r1.complete).toBe(false)

    const r2 = buf.append('FROM users')
    expect(r2.complete).toBe(false)

    const r3 = buf.append('WHERE id = 1;')
    expect(r3.complete).toBe(true)
    expect(r3.sql).toBe('SELECT *\nFROM users\nWHERE id = 1;')
  })

  test('reset clears the buffer', () => {
    const buf = new MultilineBuffer()
    buf.append('SELECT *')
    buf.reset()
    expect(buf.isActive()).toBe(false)

    const result = buf.append('SELECT 1;')
    expect(result.complete).toBe(true)
    expect(result.sql).toBe('SELECT 1;')
  })

  test('isActive returns true when buffer has content', () => {
    const buf = new MultilineBuffer()
    expect(buf.isActive()).toBe(false)

    buf.append('SELECT *')
    expect(buf.isActive()).toBe(true)
  })

  test('handles semicolon inside single-quoted string (not a terminator)', () => {
    const buf = new MultilineBuffer()
    const result = buf.append("SELECT * FROM users WHERE name = 'a;b'")
    expect(result.complete).toBe(false)
  })

  test('handles semicolon inside double-quoted identifier (not a terminator)', () => {
    const buf = new MultilineBuffer()
    const result = buf.append('SELECT * FROM "table;name"')
    expect(result.complete).toBe(false)
  })

  test('terminates after string containing semicolon when real semicolon follows', () => {
    const buf = new MultilineBuffer()
    const result = buf.append("SELECT * FROM users WHERE name = 'a;b';")
    expect(result.complete).toBe(true)
  })

  test('getPartial returns current buffer content', () => {
    const buf = new MultilineBuffer()
    buf.append('SELECT *')
    buf.append('FROM users')
    expect(buf.getPartial()).toBe('SELECT *\nFROM users')
  })

  test('auto-resets after returning complete result', () => {
    const buf = new MultilineBuffer()
    buf.append('SELECT 1;')
    expect(buf.isActive()).toBe(false)
  })
})
