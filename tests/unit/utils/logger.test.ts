import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { createLogger, LogLevel } from '../../../src/utils/logger'

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  test('error() always outputs regardless of level', () => {
    const logger = createLogger(LogLevel.QUIET)
    logger.error('boom')
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls[0]?.[0]
    expect(String(output)).toContain('boom')
  })

  test('warn() outputs at NORMAL level', () => {
    const logger = createLogger(LogLevel.NORMAL)
    logger.warn('caution')
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls[0]?.[0]
    expect(String(output)).toContain('caution')
  })

  test('warn() suppressed at QUIET level', () => {
    const logger = createLogger(LogLevel.QUIET)
    logger.warn('caution')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  test('info() outputs at NORMAL level', () => {
    const logger = createLogger(LogLevel.NORMAL)
    logger.info('hello')
    expect(stderrSpy).toHaveBeenCalled()
  })

  test('info() suppressed at QUIET level', () => {
    const logger = createLogger(LogLevel.QUIET)
    logger.info('hello')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  test('verbose() outputs at VERBOSE level', () => {
    const logger = createLogger(LogLevel.VERBOSE)
    logger.verbose('detail')
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls[0]?.[0]
    expect(String(output)).toContain('detail')
  })

  test('verbose() suppressed at NORMAL level', () => {
    const logger = createLogger(LogLevel.NORMAL)
    logger.verbose('detail')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  test('debug() outputs at DEBUG level', () => {
    const logger = createLogger(LogLevel.DEBUG)
    logger.debug('trace')
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls[0]?.[0]
    expect(String(output)).toContain('trace')
  })

  test('debug() suppressed at VERBOSE level', () => {
    const logger = createLogger(LogLevel.VERBOSE)
    logger.debug('trace')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  test('supports multiple arguments', () => {
    const logger = createLogger(LogLevel.VERBOSE)
    logger.verbose('SQL:', 'SELECT 1')
    expect(stderrSpy).toHaveBeenCalled()
    const output = String(stderrSpy.mock.calls[0]?.[0])
    expect(output).toContain('SQL:')
    expect(output).toContain('SELECT 1')
  })
})
