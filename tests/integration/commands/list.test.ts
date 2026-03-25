/**
 * dbcli list 命令集成測試
 */

import { test, expect, describe } from 'bun:test'
import { listCommand } from '@/commands/list'

// 模擬適配器工廠以避免實際資料庫依賴
describe('dbcli list command', () => {
  // 這些是集成測試，依賴於模擬的適配器
  // 真實與測試資料庫的集成在 Wave 2 適配器測試後進行

  test('list command exports listCommand', () => {
    expect(listCommand).toBeDefined()
    expect(listCommand.name()).toBe('list')
  })

  test('list command has description', () => {
    const cmd = listCommand
    expect(cmd.description()).toContain('List all tables')
  })

  test('list command supports --format option', () => {
    const cmd = listCommand
    const options = cmd.options
    const formatOption = options.find((opt: any) => opt.name() === 'format')
    expect(formatOption).toBeDefined()
  })

  test('list command supports --config option', () => {
    const cmd = listCommand
    const options = cmd.options
    const configOption = options.find((opt: any) => opt.name() === 'config')
    expect(configOption).toBeDefined()
  })

  test('list command default format is table', () => {
    const cmd = listCommand
    const options = cmd.options
    const formatOption = options.find((opt: any) => opt.name() === 'format')
    expect(formatOption.defaultValue).toBe('table')
  })

  test('list command --config default is .dbcli', () => {
    const cmd = listCommand
    const options = cmd.options
    const configOption = options.find((opt: any) => opt.name() === 'config')
    expect(configOption.defaultValue).toBe('.dbcli')
  })
})
