import { describe, test, expect } from 'bun:test'
import { collectConnection } from '@/core/inspect/collect-connection'
import type { DbcliConfig } from '@/types'

describe('collectConnection', () => {
  test('returns null fields when config is null', () => {
    const out = collectConnection(null)
    expect(out.system).toBeNull()
    expect(out.section).toEqual({ name: null, database: null, version: null })
  })

  test('strips host/port/user/password and keeps database for postgres', () => {
    const cfg: DbcliConfig = {
      connection: {
        system: 'postgresql',
        host: 'db.example',
        port: 5432,
        user: 'u',
        password: 'p',
        database: 'app',
      },
      permission: 'query-only',
    } as DbcliConfig
    const out = collectConnection(cfg)
    expect(out.system).toBe('postgresql')
    expect(out.section.database).toBe('app')
    const json = JSON.stringify(out)
    expect(json).not.toContain('db.example')
    expect(json).not.toContain('5432')
    expect(json).not.toContain('"u"')
    expect(json).not.toContain('"p"')
  })

  test('uses passed connectionName for V2', () => {
    const cfg: DbcliConfig = {
      connection: {
        system: 'mysql',
        host: 'h',
        port: 3306,
        user: 'u',
        password: 'p',
        database: 'shop',
      },
      permission: 'read-write',
    } as DbcliConfig
    const out = collectConnection(cfg, 'analytics')
    expect(out.section.name).toBe('analytics')
  })

  test('falls back to default for V1', () => {
    const cfg: DbcliConfig = {
      connection: {
        system: 'mysql',
        host: 'h',
        port: 3306,
        user: 'u',
        password: 'p',
        database: 'shop',
      },
      permission: 'read-write',
    } as DbcliConfig
    expect(collectConnection(cfg).section.name).toBe('default')
  })
})
