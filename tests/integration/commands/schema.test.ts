/**
 * dbcli schema 命令集成測試
 */

import { test, expect, describe } from 'bun:test'
import type { TableSchema } from '../../src/adapters/types'

// 模擬適配器工廠以避免實際資料庫依賴
describe('dbcli schema command', () => {
  // 這些是集成測試，驗證命令結構和選項
  // 真實資料庫集成在適配器增強後進行

  test('schema command exports schemaCommand', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    expect(schemaModule.schemaCommand).toBeDefined()
    expect(schemaModule.schemaCommand.name()).toBe('schema')
  })

  test('schema command has description', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    expect(cmd.description()).toContain('schema')
  })

  test('schema command has optional table argument', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    // 檢查命令是否有所需的參數（表格在 [ ] 中為可選）
    const helpText = cmd.helpInformation()
    expect(helpText).toContain('[table]')
  })

  test('schema command supports --format option', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    const options = cmd.options
    const formatOption = options.find((opt: any) => opt.name() === 'format')
    expect(formatOption).toBeDefined()
  })

  test('schema command supports --config option', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    const options = cmd.options
    const configOption = options.find((opt: any) => opt.name() === 'config')
    expect(configOption).toBeDefined()
  })

  test('schema command supports --force option', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    const options = cmd.options
    const forceOption = options.find((opt: any) => opt.name() === 'force')
    expect(forceOption).toBeDefined()
  })

  test('schema command default format is table', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    const options = cmd.options
    const formatOption = options.find((opt: any) => opt.name() === 'format')
    expect(formatOption.defaultValue).toBe('table')
  })

  test('schema command --force default is false', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    const options = cmd.options
    const forceOption = options.find((opt: any) => opt.name() === 'force')
    expect(forceOption.defaultValue).toBe(false)
  })

  test('schema command --config default is .dbcli', () => {
    const schemaModule = require('../../src/commands/schema.ts')
    const cmd = schemaModule.schemaCommand
    const options = cmd.options
    const configOption = options.find((opt: any) => opt.name() === 'config')
    expect(configOption.defaultValue).toBe('.dbcli')
  })
})
