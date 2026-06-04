// tests/unit/commands/proxy-resolve.test.ts
import { describe, it, expect } from 'bun:test'
import { parseHostPort, resolveProxyConfig } from '@/commands/proxy'

describe('parseHostPort', () => {
  it('parses host:port', () => {
    expect(parseHostPort('127.0.0.1:3307')).toEqual({ host: '127.0.0.1', port: 3307 })
  })
  it('throws on missing port', () => {
    expect(() => parseHostPort('127.0.0.1')).toThrow(/host:port/)
  })
  it('throws on non-numeric port', () => {
    expect(() => parseHostPort('h:abc')).toThrow(/port/)
  })
})

describe('resolveProxyConfig', () => {
  const conn = { system: 'mysql' as const, host: 'db.local', port: 3306 }

  it('uses explicit subcommand engine + explicit target', () => {
    const r = resolveProxyConfig({
      subcommandEngine: 'postgresql',
      listen: '127.0.0.1:5433',
      target: '127.0.0.1:5432',
      connection: null,
    })
    expect(r.engine).toBe('postgresql')
    expect(r.target).toEqual({ host: '127.0.0.1', port: 5432 })
    expect(r.listen).toEqual({ host: '127.0.0.1', port: 5433 })
  })

  it('infers engine and target from connection when not explicit', () => {
    const r = resolveProxyConfig({
      subcommandEngine: null,
      listen: '127.0.0.1:3307',
      target: undefined,
      connection: conn,
    })
    expect(r.engine).toBe('mysql')
    expect(r.target).toEqual({ host: 'db.local', port: 3306 })
  })

  it('explicit target overrides connection host/port', () => {
    const r = resolveProxyConfig({
      subcommandEngine: null,
      listen: '127.0.0.1:3307',
      target: '10.0.0.5:3306',
      connection: conn,
    })
    expect(r.target).toEqual({ host: '10.0.0.5', port: 3306 })
  })

  it('throws when listen is missing', () => {
    expect(() =>
      resolveProxyConfig({
        subcommandEngine: 'mysql',
        listen: undefined,
        target: '127.0.0.1:3306',
        connection: null,
      })
    ).toThrow(/--listen/)
  })

  it('throws when no target can be determined', () => {
    expect(() =>
      resolveProxyConfig({
        subcommandEngine: 'mysql',
        listen: '127.0.0.1:3307',
        target: undefined,
        connection: null,
      })
    ).toThrow(/--target/)
  })

  it('throws on unsupported engine from config', () => {
    expect(() =>
      resolveProxyConfig({
        subcommandEngine: null,
        listen: '127.0.0.1:3307',
        target: undefined,
        connection: { system: 'mongodb' as never, host: 'h', port: 1 },
      })
    ).toThrow(/mysql, mariadb, postgresql/)
  })
})
