// tests/integration/proxy.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProxyServer } from '@/proxy/server'
import {
  isDbReachable,
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
} from './helpers'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

type ProxyEngine = 'mysql' | 'mariadb' | 'postgresql'

const MYSQL = {
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
}
const PG = {
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

async function startProxy(engine: ProxyEngine, target: { host: string; port: number }) {
  const dir = mkdtempSync(join(tmpdir(), `proxy-it-${engine}-`))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const eventsPath = join(dir, 'events.jsonl')
  const server = new ProxyServer({
    engine,
    listen: { host: '127.0.0.1', port: 0 },
    target,
    eventsPath,
    slowMs: 1000,
    redact: 'none',
    warn: () => {},
  })
  await server.start()
  cleanups.push(() => server.stop())
  const port = (server as unknown as { port: number }).port
  return { eventsPath, port }
}

function readEventTypes(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).type as string)
}

async function waitForEvent(path: string, type: string, timeoutMs = 3000): Promise<void> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (readEventTypes(path).includes(type)) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for event "${type}" in ${path}`)
}

describe('proxy integration: MySQL/MariaDB smoke', () => {
  it('app driver -> proxy -> MySQL -> SELECT 1, events recorded', async () => {
    if (!(await isDbReachable(MYSQL.host, MYSQL.port))) return // auto-skip
    const { eventsPath, port } = await startProxy('mysql', { host: MYSQL.host, port: MYSQL.port })

    const mysql = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      port,
      user: MYSQL.user,
      password: MYSQL.password,
      database: MYSQL.database,
    })
    const [rows] = await conn.query('SELECT 1 AS one')
    expect(Array.isArray(rows)).toBe(true)
    await conn.end()

    await waitForEvent(eventsPath, 'query_observed')
    const types = readEventTypes(eventsPath)
    expect(types).toContain('proxy_started')
    expect(types).toContain('session_started')
    expect(types).toContain('query_observed')
  })

  it('never captures MySQL auth credentials as a query', async () => {
    if (!(await isDbReachable(MYSQL.host, MYSQL.port))) return
    const { eventsPath, port } = await startProxy('mysql', { host: MYSQL.host, port: MYSQL.port })
    const mysql = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      port,
      user: MYSQL.user,
      password: MYSQL.password,
      database: MYSQL.database,
    })
    await conn.query('SELECT 1 AS one')
    await conn.end()
    await waitForEvent(eventsPath, 'query_observed')
    const raw = readFileSync(eventsPath, 'utf8')
    // The plaintext password must never appear in any persisted event
    expect(raw).not.toContain(MYSQL.password) // 'testpass' must never be persisted
  })

  it('app driver -> proxy -> MariaDB (mysql engine) -> SELECT 1, events recorded', async () => {
    if (!(await isDbReachable(MYSQL.host, MYSQL.port))) return // auto-skip: MariaDB reuses MySQL container
    const { eventsPath, port } = await startProxy('mariadb', { host: MYSQL.host, port: MYSQL.port })

    const mysql = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      port,
      user: MYSQL.user,
      password: MYSQL.password,
      database: MYSQL.database,
    })
    const [rows] = await conn.query('SELECT 1 AS one')
    expect(Array.isArray(rows)).toBe(true)
    await conn.end()

    await waitForEvent(eventsPath, 'query_observed')
    const types = readEventTypes(eventsPath)
    expect(types).toContain('proxy_started')
    expect(types).toContain('session_started')
    expect(types).toContain('query_observed')
  })
})

describe('proxy integration: PostgreSQL smoke', () => {
  it('app driver -> proxy -> PostgreSQL -> SELECT 1, events recorded', async () => {
    if (!(await isDbReachable(PG.host, PG.port))) return // auto-skip
    const { eventsPath, port } = await startProxy('postgresql', { host: PG.host, port: PG.port })

    const { Client } = await import('pg')
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: PG.user,
      password: PG.password,
      database: PG.database,
      ssl: false,
    })
    await client.connect()
    const res = await client.query('SELECT 1 AS one')
    expect(res.rowCount).toBe(1)
    await client.end()

    await waitForEvent(eventsPath, 'query_observed')
    const types = readEventTypes(eventsPath)
    expect(types).toContain('proxy_started')
    expect(types).toContain('session_started')
    expect(types).toContain('query_observed')
  })
})

describe('proxy integration: slow-query warning + completion event', () => {
  it('records a query_completed for a slow query via PostgreSQL', async () => {
    if (!(await isDbReachable(PG.host, PG.port))) return // auto-skip
    const dir = mkdtempSync(join(tmpdir(), 'proxy-slow-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const eventsPath = join(dir, 'events.jsonl')
    const warnings: string[] = []
    const server = new ProxyServer({
      engine: 'postgresql',
      listen: { host: '127.0.0.1', port: 0 },
      target: { host: PG.host, port: PG.port },
      eventsPath,
      slowMs: 1, // force slow classification
      redact: 'none',
      warn: (m) => warnings.push(m),
    })
    await server.start()
    cleanups.push(() => server.stop())
    const port = (server as unknown as { port: number }).port

    const { Client } = await import('pg')
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: PG.user,
      password: PG.password,
      database: PG.database,
      ssl: false,
    })
    await client.connect()
    await client.query('SELECT pg_sleep(0.05)')
    await client.end()

    await waitForEvent(eventsPath, 'query_completed')
    const types = readEventTypes(eventsPath)
    expect(types).toContain('query_completed')
    expect(warnings.some((w) => w.includes('slow'))).toBe(true)
  })
})
