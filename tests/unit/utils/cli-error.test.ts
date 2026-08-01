import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { ConnectionError } from '@/adapters/types'
import { formatCliError, mapCliError, presentCliError } from '@/utils/cli-error'
import { createLogger, LogLevel, setGlobalLogger } from '@/utils/logger'

afterEach(() => {
  setGlobalLogger(createLogger(LogLevel.NORMAL))
})

describe('CLI error presentation', () => {
  test('maps message, stable code, and actionable hints without a normal-mode stack', () => {
    const error = new ConnectionError('ECONNREFUSED', 'Cannot connect to database', [
      'Check that the service is running',
    ])

    expect(mapCliError(error)).toEqual({
      message: 'Cannot connect to database',
      code: 'ECONNREFUSED',
      hints: ['Check that the service is running'],
    })
  })

  test('bounds non-Error rejections to a readable fallback', () => {
    expect(mapCliError({ detail: 'private diagnostic' })).toEqual({
      message: 'An unexpected error occurred',
      hints: [],
    })
  })

  test('normal mode presents the failure once without stack frames', () => {
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    const error = new Error('Readable failure')

    presentCliError(error)

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const output = String(writeSpy.mock.calls[0]?.[0])
    expect(output).toBe('Readable failure\n')
    expect(output).not.toContain(' at ')
    writeSpy.mockRestore()
  })

  test('verbose mode includes the diagnostic stack', () => {
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
    setGlobalLogger(createLogger(LogLevel.VERBOSE))

    presentCliError(new Error('Verbose failure'))

    const output = String(writeSpy.mock.calls[0]?.[0])
    expect(output).toContain('Verbose failure\nStack:\n')
    expect(output).toContain('cli-error.test.ts')
    writeSpy.mockRestore()
  })

  test('formats each hint on its own bounded line', () => {
    expect(
      formatCliError({ message: 'Failed', code: 'E_TEST', hints: ['First action', 'Second action'] })
    ).toBe('Failed\nCode: E_TEST\nHint: First action\nHint: Second action')
  })
})
