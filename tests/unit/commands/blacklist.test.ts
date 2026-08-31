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
  isValidTableNameForSystem,
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
      // `profile..token` — an empty segment. `profile.*.token` was rejected
      // before ADR-0019 Decision 1 and compiles as a segment glob now.
      columns: { events: ['profile..token'] },
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
        raw: 'profile..token',
        reason: 'empty path segment',
      },
    ])
    expect(errorOutput).toEqual([])
  })

  it('keeps rejected Mongo pattern warnings on stderr in text mode', async () => {
    const configPath = await createTempConfig({
      tables: [],
      // `profile..token` — an empty segment. `profile.*.token` was rejected
      // before ADR-0019 Decision 1 and compiles as a segment glob now.
      columns: { events: ['profile..token'] },
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
      '⚠  blacklist.columns["events"]: \'profile..token\' is ignored on mongo connections (empty path segment).',
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

/**
 * 第九輪：第八輪放寬 `VALID_TABLE_NAME` 是為了 Elasticsearch 與 Redis 的名稱
 * （`my-index`、`secrets:*`），但驗證不看連線類型。於是 SQL 與 MongoDB 的
 * 使用者也能加入一個 glob 條目——而那兩個引擎的比對是字面相等，條目永遠不會
 * 命中，CLI 卻回報成功。
 *
 * 這是我在第八輪造成的迴歸，而它的形狀正是第八輪自己在修的那一種：**使用者
 * 以為設了，實際完全無效**。放寬本身是對的，少的是「這個寫法對這個引擎有沒有
 * 意義」那一問。
 */
describe('isValidTableNameForSystem()', () => {
  it('ES 與 Redis 接受 glob', () => {
    expect(isValidTableNameForSystem('secrets*', 'elasticsearch')).toBe(true)
    expect(isValidTableNameForSystem('secrets:*', 'redis')).toBe(true)
    expect(isValidTableNameForSystem('logs-2026.08.30', 'elasticsearch')).toBe(true)
  })

  // 這一則原本斷言 SQL 與 MongoDB 拒絕 glob，理由是那裡的比對是字面相等。
  // ADR-0019 Decision 4 讓 `isTableBlacklisted` 對所有引擎都走 glob，所以那個
  // 理由消失了，拒絕只會把人逼回手編設定檔。
  it('SQL 與 MongoDB 也接受 glob——比對已對所有引擎統一', () => {
    expect(isValidTableNameForSystem('secret*', 'postgresql')).toBe(true)
    expect(isValidTableNameForSystem('secret?', 'mysql')).toBe(true)
    expect(isValidTableNameForSystem('sec[a-z]', 'mongodb')).toBe(true)
    // 逃逸回字面名稱也要進得來（ADR-0019 Decision 4 的那句承諾）。
    expect(isValidTableNameForSystem('report\\*', 'postgresql')).toBe(true)
  })

  it('欄位項接受 glob，仍拒絕會靜靜變成別的意思的形狀', () => {
    expect(parseColumnIdentifier('users.pass*')).toEqual({ table: 'users', column: 'pass*' })
    expect(parseColumnIdentifier('users.sec?et')).toEqual({ table: 'users', column: 'sec?et' })
    expect(parseColumnIdentifier('users.pass word')).toBeNull()
    expect(parseColumnIdentifier('users.a,b')).toBeNull()
  })

  it('SQL 與 MongoDB 的一般名稱照常接受', () => {
    expect(isValidTableNameForSystem('users', 'postgresql')).toBe(true)
    expect(isValidTableNameForSystem('audit_logs', 'mongodb')).toBe(true)
    expect(isValidTableNameForSystem('logs.2026', 'mongodb')).toBe(true)
  })

  it('未知或未指定的引擎沿用寬鬆規則', () => {
    expect(isValidTableNameForSystem('secrets*', undefined)).toBe(true)
  })
})
