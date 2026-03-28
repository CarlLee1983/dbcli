// tests/core/repl/meta-commands.test.ts
import { describe, test, expect } from 'bun:test'
import { handleMetaCommand } from '../../../src/core/repl/meta-commands'
import type { ReplState } from '../../../src/core/repl/types'

const defaultState: ReplState = { format: 'table', timing: false, connected: true }

describe('handleMetaCommand', () => {
  test('.help returns help text', () => {
    const result = handleMetaCommand('.help', defaultState, [])
    expect(result.action).toBe('continue')
    expect(result.output).toContain('.help')
    expect(result.output).toContain('.quit')
    expect(result.output).toContain('.format')
    expect(result.output).toContain('.timing')
    expect(result.output).toContain('.history')
    expect(result.output).toContain('.clear')
  })

  test('.quit returns quit action', () => {
    const result = handleMetaCommand('.quit', defaultState, [])
    expect(result.action).toBe('quit')
  })

  test('.exit returns quit action', () => {
    const result = handleMetaCommand('.exit', defaultState, [])
    expect(result.action).toBe('quit')
  })

  test('.clear returns clear action', () => {
    const result = handleMetaCommand('.clear', defaultState, [])
    expect(result.action).toBe('clear')
  })

  describe('.format', () => {
    test('sets format to json', () => {
      const result = handleMetaCommand('.format json', defaultState, [])
      expect(result.action).toBe('continue')
      expect(result.stateUpdate).toEqual({ format: 'json' })
      expect(result.output).toContain('json')
    })

    test('sets format to csv', () => {
      const result = handleMetaCommand('.format csv', defaultState, [])
      expect(result.stateUpdate).toEqual({ format: 'csv' })
    })

    test('sets format to table', () => {
      const result = handleMetaCommand('.format table', defaultState, [])
      expect(result.stateUpdate).toEqual({ format: 'table' })
    })

    test('shows current format when no argument', () => {
      const result = handleMetaCommand('.format', defaultState, [])
      expect(result.output).toContain('table')
      expect(result.stateUpdate).toBeUndefined()
    })

    test('shows error for invalid format', () => {
      const result = handleMetaCommand('.format xml', defaultState, [])
      expect(result.output).toContain('table')
      expect(result.output).toContain('json')
      expect(result.output).toContain('csv')
      expect(result.stateUpdate).toBeUndefined()
    })
  })

  describe('.timing', () => {
    test('turns timing on', () => {
      const result = handleMetaCommand('.timing on', defaultState, [])
      expect(result.stateUpdate).toEqual({ timing: true })
    })

    test('turns timing off', () => {
      const state: ReplState = { ...defaultState, timing: true }
      const result = handleMetaCommand('.timing off', state, [])
      expect(result.stateUpdate).toEqual({ timing: false })
    })

    test('shows current timing state when no argument', () => {
      const result = handleMetaCommand('.timing', defaultState, [])
      expect(result.output).toContain('off')
    })
  })

  describe('.history', () => {
    test('shows history entries', () => {
      const history = ['SELECT 1;', 'schema users', '.format json']
      const result = handleMetaCommand('.history', defaultState, history)
      expect(result.output).toContain('SELECT 1;')
      expect(result.output).toContain('schema users')
      expect(result.output).toContain('.format json')
    })

    test('shows message when history is empty', () => {
      const result = handleMetaCommand('.history', defaultState, [])
      expect(result.output).toBeDefined()
    })
  })

  test('unknown meta command returns error message', () => {
    const result = handleMetaCommand('.unknown', defaultState, [])
    expect(result.action).toBe('continue')
    expect(result.output).toContain('.help')
  })
})
