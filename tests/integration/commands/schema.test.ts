/**
 * dbcli schema 命令集成測試
 */

import { test, expect, describe } from 'bun:test'
import { schemaCommand } from '@/commands/schema'

// 模擬適配器工廠以避免實際資料庫依賴
describe('dbcli schema command', () => {
  // 這些是集成測試，驗證命令結構和選項
  // 真實資料庫集成在適配器增強後進行

  test('schema command exports schemaCommand', () => {
    expect(schemaCommand).toBeDefined()
    expect(schemaCommand.name()).toBe('schema')
  })

  test('schema command has description', () => {
    const cmd = schemaCommand
    expect(cmd.description()).toContain('schema')
  })

  test('schema command has optional table argument', () => {
    const cmd = schemaCommand
    // 檢查命令是否有所需的參數（表格在 [ ] 中為可選）
    const helpText = cmd.helpInformation()
    expect(helpText).toContain('[table]')
  })

  test('schema command supports --format option', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const formatOption = options.find((opt: any) => opt.name() === 'format')
    expect(formatOption).toBeDefined()
  })

  test('schema command supports --config option', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const configOption = options.find((opt: any) => opt.name() === 'config')
    expect(configOption).toBeDefined()
  })

  test('schema command supports --force option', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const forceOption = options.find((opt: any) => opt.name() === 'force')
    expect(forceOption).toBeDefined()
  })

  test('schema command default format is table', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const formatOption = options.find((opt: any) => opt.name() === 'format')
    expect(formatOption.defaultValue).toBe('table')
  })

  test('schema command --force default is false', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const forceOption = options.find((opt: any) => opt.name() === 'force')
    expect(forceOption.defaultValue).toBe(false)
  })

  test('schema command --config default is .dbcli', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const configOption = options.find((opt: any) => opt.name() === 'config')
    expect(configOption.defaultValue).toBe('.dbcli')
  })

  test('schema command supports --refresh option', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const refreshOption = options.find((opt: any) => opt.name() === 'refresh')
    expect(refreshOption).toBeDefined()
  })

  test('schema command --refresh default is false', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const refreshOption = options.find((opt: any) => opt.name() === 'refresh')
    expect(refreshOption.defaultValue).toBe(false)
  })

  test('schema command description mentions refresh', () => {
    const cmd = schemaCommand
    const description = cmd.description()
    expect(description).toContain('refresh')
  })

  test('schema command refresh option has description', () => {
    const cmd = schemaCommand
    const options = cmd.options
    const refreshOption = options.find((opt: any) => opt.name() === 'refresh')
    expect(refreshOption.description()).toContain('Refresh')
  })
})
