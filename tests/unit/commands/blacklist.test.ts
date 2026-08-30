/**
 * blacklist command unit tests
 */

import { describe, it, expect } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  blacklistList,
  blacklistTableAdd,
  blacklistTableRemove,
  blacklistColumnAdd,
  blacklistColumnRemove,
  getOrInitBlacklist,
  parseColumnIdentifier,
  isValidTableName,
} from '@/commands/blacklist'

// Create a temp .dbcli file for testing
async function createTempConfig(blacklist?: any): Promise<string> {
  const dir = tmpdir()
  const configPath = join(dir, `test-dbcli-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const config = {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'user',
      password: 'pass',
      database: 'testdb',
    },
    permission: 'query-only',
    ...(blacklist ? { blacklist } : {}),
  }

  await Bun.file(configPath).write(JSON.stringify(config, null, 2))
  return configPath
}

async function readConfig(configPath: string): Promise<any> {
  const content = await Bun.file(configPath).text()
  return JSON.parse(content)
}

describe('parseColumnIdentifier()', () => {
  it('parses valid table.column format', () => {
    const result = parseColumnIdentifier('users.password')
    expect(result).toEqual({ table: 'users', column: 'password' })
  })

  it('returns null for missing dot separator', () => {
    expect(parseColumnIdentifier('userspassword')).toBeNull()
  })

  it('returns null for empty table part', () => {
    expect(parseColumnIdentifier('.password')).toBeNull()
  })

  it('returns null for empty column part', () => {
    expect(parseColumnIdentifier('users.')).toBeNull()
  })

  it('returns null for multiple dots', () => {
    expect(parseColumnIdentifier('schema.users.password')).toBeNull()
  })
})

describe('isValidTableName()', () => {
  it('accepts alphanumeric names', () => {
    expect(isValidTableName('users')).toBe(true)
    expect(isValidTableName('audit_logs')).toBe(true)
    expect(isValidTableName('table123')).toBe(true)
  })

  it('rejects names with spaces or special chars', () => {
    expect(isValidTableName('user table')).toBe(false)
    expect(isValidTableName('users!')).toBe(false)
    expect(isValidTableName('')).toBe(false)
  })

  /**
   * 第八輪 HIGH：這條規則拒絕了幾乎所有合法的 Elasticsearch index 名，於是
   * `dbcli blacklist table add` 對 ES 使用者不可用，只能手編設定檔——而手編
   * 正是最容易把條目寫成 glob 的路徑，直接餵養同一輪那個 CRITICAL。
   *
   * 含 `-` 與 `.` 的 index 名是 ES 的常態（`logs-2026.08.30`、`.kibana`），
   * 而萬用字元與 `:` 是使用者文件在 Redis 那側明文教的寫法。
   */
  it('accepts the names Elasticsearch and Redis actually use', () => {
    expect(isValidTableName('my-index')).toBe(true)
    expect(isValidTableName('logs-2026.08.30')).toBe(true)
    expect(isValidTableName('.kibana')).toBe(true)
    expect(isValidTableName('secrets*')).toBe(true)
    expect(isValidTableName('secrets:*')).toBe(true)
    expect(isValidTableName('sec?ets')).toBe(true)
  })

  it('still rejects what would silently mean something else', () => {
    // 逗號在條目裡會被展開成多個目標，但透過 CLI 一次加一個才說得清楚。
    expect(isValidTableName('a,b')).toBe(false)
    // 路徑分隔與空白：前者會讓條目看起來像路徑，後者是打字錯誤的常見形狀。
    expect(isValidTableName('a/b')).toBe(false)
    expect(isValidTableName(' secrets')).toBe(false)
  })
})

describe('getOrInitBlacklist()', () => {
  it('returns empty blacklist when config has no blacklist field', () => {
    const result = getOrInitBlacklist({})
    expect(result).toEqual({ tables: [], columns: {} })
  })

  it('returns existing blacklist config', () => {
    const config = { blacklist: { tables: ['users'], columns: { users: ['password'] } } }
    const result = getOrInitBlacklist(config)
    expect(result.tables).toContain('users')
    expect(result.columns.users).toContain('password')
  })
})

describe('blacklistList()', () => {
  it('emits one machine-readable document with warnings in json mode', async () => {
    const configPath = await createTempConfig({
      tables: ['audit_logs'],
      columns: { users: ['password'] },
    })
    const output: string[] = []
    const errorOutput: string[] = []
    const origLog = console.log
    const origError = console.error
    console.log = (...args: any[]) => output.push(args.join(' '))
    console.error = (...args: any[]) => errorOutput.push(args.join(' '))

    try {
      await blacklistList(configPath, 'json')
    } finally {
      console.log = origLog
      console.error = origError
    }

    expect(output).toHaveLength(1)
    expect(JSON.parse(output[0]!)).toEqual({
      tables: ['audit_logs'],
      columns: { users: ['password'] },
      warnings: [],
    })
    expect(errorOutput).toEqual([])
  })

  it('returns rejected Mongo patterns as structured JSON warnings', async () => {
    const configPath = await createTempConfig({
      tables: [],
      columns: { events: ['profile.*.token'] },
    })
    const output: string[] = []
    const errorOutput: string[] = []
    const origLog = console.log
    const origError = console.error
    console.log = (...args: any[]) => output.push(args.join(' '))
    console.error = (...args: any[]) => errorOutput.push(args.join(' '))

    try {
      await blacklistList(configPath, 'json')
    } finally {
      console.log = origLog
      console.error = origError
    }

    expect(JSON.parse(output[0]!).warnings).toEqual([
      {
        collection: 'events',
        raw: 'profile.*.token',
        reason: 'wildcard must be the final segment',
      },
    ])
    expect(errorOutput).toEqual([])
  })

  it('keeps rejected Mongo pattern warnings on stderr in text mode', async () => {
    const configPath = await createTempConfig({
      tables: [],
      columns: { events: ['profile.*.token'] },
    })
    const errorOutput: string[] = []
    const origError = console.error
    console.error = (...args: any[]) => errorOutput.push(args.join(' '))

    try {
      await blacklistList(configPath)
    } finally {
      console.error = origError
    }

    expect(errorOutput).toEqual([
      '⚠  blacklist.columns["events"]: \'profile.*.token\' is ignored on mongo connections (wildcard must be the final segment).',
    ])
  })

  it('shows "none" message when config is empty', async () => {
    const configPath = await createTempConfig()
    const output: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => output.push(args.join(' '))

    try {
      await blacklistList(configPath)
    } finally {
      console.log = origLog
    }

    expect(
      output.some(
        (line) =>
          line.includes('No tables') || line.includes('blacklisted') || line.includes('currently')
      )
    ).toBe(true)
  })

  it('shows tables when blacklist has tables', async () => {
    const configPath = await createTempConfig({ tables: ['audit_logs'], columns: {} })
    const output: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => output.push(args.join(' '))

    try {
      await blacklistList(configPath)
    } finally {
      console.log = origLog
    }

    expect(output.some((line) => line.includes('audit_logs'))).toBe(true)
  })

  it('shows columns when blacklist has columns', async () => {
    const configPath = await createTempConfig({
      tables: [],
      columns: { users: ['password', 'api_key'] },
    })
    const output: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => output.push(args.join(' '))

    try {
      await blacklistList(configPath)
    } finally {
      console.log = origLog
    }

    expect(output.some((line) => line.includes('users') || line.includes('password'))).toBe(true)
  })
})

describe('blacklistTableAdd()', () => {
  it('adds table to config', async () => {
    const configPath = await createTempConfig()
    await blacklistTableAdd('users', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.tables).toContain('users')
  })

  it('rejects duplicate table add', async () => {
    const configPath = await createTempConfig({ tables: ['users'], columns: {} })
    await expect(blacklistTableAdd('users', configPath)).rejects.toThrow()
  })

  it('rejects invalid table name', async () => {
    const configPath = await createTempConfig()
    await expect(blacklistTableAdd('invalid-table!', configPath)).rejects.toThrow()
  })

  it('config changes persisted to .dbcli file', async () => {
    const configPath = await createTempConfig()
    await blacklistTableAdd('users', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.tables).toContain('users')
  })
})

describe('blacklistTableRemove()', () => {
  it('removes table from config', async () => {
    const configPath = await createTempConfig({ tables: ['users', 'audit_logs'], columns: {} })
    await blacklistTableRemove('users', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.tables).not.toContain('users')
    expect(config.blacklist.tables).toContain('audit_logs')
  })

  it('rejects removal of non-existent table', async () => {
    const configPath = await createTempConfig({ tables: [], columns: {} })
    await expect(blacklistTableRemove('nonexistent', configPath)).rejects.toThrow()
  })
})

describe('blacklistColumnAdd()', () => {
  it('adds column to correct table', async () => {
    const configPath = await createTempConfig()
    await blacklistColumnAdd('users.password', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.columns.users).toContain('password')
  })

  it('rejects duplicate column add', async () => {
    const configPath = await createTempConfig({ tables: [], columns: { users: ['password'] } })
    await expect(blacklistColumnAdd('users.password', configPath)).rejects.toThrow()
  })

  it('rejects invalid column format (no dot)', async () => {
    const configPath = await createTempConfig()
    await expect(blacklistColumnAdd('userspassword', configPath)).rejects.toThrow()
  })

  it('config changes persisted after column add', async () => {
    const configPath = await createTempConfig()
    await blacklistColumnAdd('users.api_key', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.columns.users).toContain('api_key')
  })
})

describe('blacklistColumnRemove()', () => {
  it('removes column from config', async () => {
    const configPath = await createTempConfig({
      tables: [],
      columns: { users: ['password', 'api_key'] },
    })
    await blacklistColumnRemove('users.password', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.columns.users).not.toContain('password')
    expect(config.blacklist.columns.users).toContain('api_key')
  })

  it('removes table entry when last column removed', async () => {
    const configPath = await createTempConfig({ tables: [], columns: { users: ['password'] } })
    await blacklistColumnRemove('users.password', configPath)
    const config = await readConfig(configPath)
    expect(config.blacklist.columns.users).toBeUndefined()
  })

  it('rejects removal of non-existent column', async () => {
    const configPath = await createTempConfig({ tables: [], columns: { users: ['password'] } })
    await expect(blacklistColumnRemove('users.nonexistent', configPath)).rejects.toThrow()
  })

  it('rejects invalid format', async () => {
    const configPath = await createTempConfig()
    await expect(blacklistColumnRemove('invalid-format', configPath)).rejects.toThrow()
  })
})
