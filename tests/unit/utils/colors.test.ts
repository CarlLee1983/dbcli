import { describe, test, expect, afterEach } from 'vitest'
import { colors } from '../../../src/utils/colors'

describe('colors', () => {
  const originalNoColor = process.env.NO_COLOR

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR
    } else {
      process.env.NO_COLOR = originalNoColor
    }
  })

  test('success wraps text in green', () => {
    delete process.env.NO_COLOR
    const result = colors.success('ok')
    expect(result).toContain('ok')
    expect(result).not.toBe('ok')
  })

  test('error wraps text in red', () => {
    delete process.env.NO_COLOR
    const result = colors.error('fail')
    expect(result).toContain('fail')
    expect(result).not.toBe('fail')
  })

  test('warn wraps text in yellow', () => {
    delete process.env.NO_COLOR
    const result = colors.warn('caution')
    expect(result).toContain('caution')
    expect(result).not.toBe('caution')
  })

  test('info wraps text in blue', () => {
    delete process.env.NO_COLOR
    const result = colors.info('note')
    expect(result).toContain('note')
    expect(result).not.toBe('note')
  })

  test('dim wraps text in dim', () => {
    delete process.env.NO_COLOR
    const result = colors.dim('faded')
    expect(result).toContain('faded')
    expect(result).not.toBe('faded')
  })

  test('bold wraps text in bold', () => {
    delete process.env.NO_COLOR
    const result = colors.bold('strong')
    expect(result).toContain('strong')
    expect(result).not.toBe('strong')
  })

  test('keyword returns blue bold text', () => {
    delete process.env.NO_COLOR
    const result = colors.keyword('SELECT')
    expect(result).toContain('SELECT')
    expect(result).not.toBe('SELECT')
  })
})
