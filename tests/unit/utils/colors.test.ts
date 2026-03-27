import { describe, test, expect } from 'bun:test'
import pc from 'picocolors'

// picocolors 在非 TTY 下（bun test / CI）不輸出色碼是正確行為
// 測試應驗證 colors 模組正確委派給 picocolors，而非假設一定有 ANSI 碼
describe('colors', () => {
  test('success delegates to pc.green', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.success('ok')
    expect(result).toBe(pc.green('ok'))
  })

  test('error delegates to pc.red', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.error('fail')
    expect(result).toBe(pc.red('fail'))
  })

  test('warn delegates to pc.yellow', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.warn('caution')
    expect(result).toBe(pc.yellow('caution'))
  })

  test('info delegates to pc.blue', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.info('note')
    expect(result).toBe(pc.blue('note'))
  })

  test('dim delegates to pc.dim', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.dim('faded')
    expect(result).toBe(pc.dim('faded'))
  })

  test('bold delegates to pc.bold', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.bold('strong')
    expect(result).toBe(pc.bold('strong'))
  })

  test('keyword delegates to pc.blue(pc.bold())', async () => {
    const { colors } = await import('../../../src/utils/colors')
    const result = colors.keyword('SELECT')
    expect(result).toBe(pc.blue(pc.bold('SELECT')))
  })
})
