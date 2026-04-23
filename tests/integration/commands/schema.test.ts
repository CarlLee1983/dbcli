/**
 * dbcli schema 命令集成測試
 */

import { test, expect, describe, beforeEach, afterEach, spyOn } from 'bun:test'
import { schemaCommand } from '@/commands/schema'
import { SchemaDiffEngine } from '@/core/schema-diff'
import { AdapterFactory } from '@/adapters'
import { $ } from 'bun'
import path from 'path'

const TEST_CONFIG_DIR = '/tmp/test-dbcli-schema-refresh.dbcli'
const TEST_CONFIG_PATH = path.join(TEST_CONFIG_DIR, 'config.json')

// 模擬適配器工廠以避免實際資料庫依賴
describe('dbcli schema command', () => {
  beforeEach(async () => {
    await $`rm -rf ${TEST_CONFIG_DIR}`
    await $`mkdir -p ${TEST_CONFIG_DIR}`
  })

  afterEach(async () => {
    await $`rm -rf ${TEST_CONFIG_DIR}`
  })

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
    expect((refreshOption as any).description).toContain('Refresh')
  })

  test('schema --refresh updates refresh metadata even when no changes are detected', async () => {
    await Bun.write(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          connection: {
            system: 'postgresql',
            host: 'localhost',
            port: 5432,
            user: 'user',
            password: 'pass',
            database: 'db',
          },
          permission: 'query-only',
          schema: {
            users: {
              name: 'users',
              columns: [],
              primaryKey: [],
              foreignKeys: [],
              indexes: [],
              estimatedRowCount: 0,
              tableType: 'table',
            },
          },
          metadata: { version: '1.0' },
        },
        null,
        2
      )
    )

    const diffSpy = spyOn(SchemaDiffEngine.prototype, 'diff').mockResolvedValue({
      tablesAdded: [],
      tablesRemoved: [],
      tablesModified: {},
      summary: '0 added, 0 removed, 0 modified',
    } as any)

    const adapter = {
      connect: async () => {},
      disconnect: async () => {},
    }
    const adapterSpy = spyOn(AdapterFactory, 'createAdapter').mockReturnValue(adapter as any)

    await schemaCommand.parseAsync(['node', 'schema', '--config', TEST_CONFIG_DIR, '--refresh'])

    const written = JSON.parse(await Bun.file(TEST_CONFIG_PATH).text())

    expect(adapterSpy).toHaveBeenCalled()
    expect(diffSpy).toHaveBeenCalled()
    expect(written.metadata.schemaLastUpdated).toBeDefined()
    expect(written.metadata.schemaTableCount).toBe(1)

    diffSpy.mockRestore()
    adapterSpy.mockRestore()
  })
})
