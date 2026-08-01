/**
 * Localized error output must honour the verbose stack switch.
 *
 * Issue #10 asked for the inverse of the old behaviour: no stack by default,
 * stack under `-v` / `-vv`. Commands that print their own localized message
 * (`q`, `insert`, `update`, `delete`) bypassed the shared presenter, so verbose
 * printed nothing extra for them. They keep their wording; they just stop
 * swallowing the stack when the user asked for it.
 */

import { describe, test, expect, afterEach, spyOn } from 'bun:test'
import { printLocalizedCliError } from '@/utils/cli-error'
import { createLogger, setGlobalLogger, LogLevel } from '@/utils/logger'

function errorWithStack(message: string): Error {
  const error = new Error(message)
  error.stack = `Error: ${message}\n    at somewhere (/app/file.ts:1:1)`
  return error
}

afterEach(() => {
  setGlobalLogger(createLogger(LogLevel.NORMAL))
})

describe('printLocalizedCliError', () => {
  test('prints only the localized message at the default level', () => {
    setGlobalLogger(createLogger(LogLevel.NORMAL))
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      printLocalizedCliError('連線失敗: boom', errorWithStack('boom'))
      const output = spy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(output).toContain('連線失敗: boom')
      expect(output).not.toContain('Stack:')
    } finally {
      spy.mockRestore()
    }
  })

  test('adds the stack at VERBOSE', () => {
    setGlobalLogger(createLogger(LogLevel.VERBOSE))
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      printLocalizedCliError('連線失敗: boom', errorWithStack('boom'))
      const output = spy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(output).toContain('連線失敗: boom')
      expect(output).toContain('Stack:')
      expect(output).toContain('at somewhere (/app/file.ts:1:1)')
    } finally {
      spy.mockRestore()
    }
  })

  test('adds the stack at DEBUG too', () => {
    setGlobalLogger(createLogger(LogLevel.DEBUG))
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      printLocalizedCliError('boom', errorWithStack('boom'))
      expect(spy.mock.calls.map((call) => String(call[0])).join('\n')).toContain('Stack:')
    } finally {
      spy.mockRestore()
    }
  })

  test('keeps the message intact when the error carries no stack', () => {
    setGlobalLogger(createLogger(LogLevel.VERBOSE))
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      printLocalizedCliError('plain failure', 'a string rejection')
      const output = spy.mock.calls.map((call) => String(call[0])).join('\n')
      expect(output).toContain('plain failure')
      expect(output).not.toContain('Stack:')
    } finally {
      spy.mockRestore()
    }
  })
})
