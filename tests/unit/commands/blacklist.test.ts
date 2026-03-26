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
  isValidTableName
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
      database: 'testdb'
    },
    permission: 'query-only',
    ...(blacklist ? { blacklist } : {})
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

    expect(output.some(line => line.includes('No tables') || line.includes('blacklisted') || line.includes('currently'))).toBe(true)
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

    expect(output.some(line => line.includes('audit_logs'))).toBe(true)
  })

  it('shows columns when blacklist has columns', async () => {
    const configPath = await createTempConfig({ tables: [], columns: { users: ['password', 'api_key'] } })
    const output: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => output.push(args.join(' '))

    try {
      await blacklistList(configPath)
    } finally {
      console.log = origLog
    }

    expect(output.some(line => line.includes('users') || line.includes('password'))).toBe(true)
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
    const configPath = await createTempConfig({ tables: [], columns: { users: ['password', 'api_key'] } })
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
