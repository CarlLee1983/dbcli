/**
 * `dbcli migrate` asks before dropping, against a real PostgreSQL.
 *
 * `tests/unit/core/ddl-executor.test.ts` proves the executor honours a
 * confirmer. It cannot prove the command supplies one — and the executor now
 * refuses a destructive operation when nobody does, so an unwired `migrate`
 * would fail at the moment a user tries to drop a table and never before. This
 * runs the command end to end and then asks the database whether the table is
 * still there.
 *
 * Service from docker-compose.test.yml:
 *   docker compose -f docker-compose.test.yml up -d --wait postgres
 */

import { describe, test, expect, beforeAll, afterAll, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgreSQLAdapter } from '@/adapters/postgresql-adapter'
import { runDDL } from '@/commands/migrate'
import { promptUser } from '@/utils/prompts'
import {
  isDbReachable,
  SKIP_BY_ENV,
  PG_HOST,
  PG_PORT,
  PG_USER,
  PG_PASSWORD,
  PG_DATABASE,
} from './helpers'

const HOST = PG_HOST
const PORT = PG_PORT
const TABLE = 'dbcli_migrate_confirm'

const connection = {
  system: 'postgresql' as const,
  host: HOST,
  port: PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
}

let up = false
let configPath = ''
let workdir = ''
let adapter: PostgreSQLAdapter | null = null
const spies: Array<{ mockRestore: () => void }> = []

beforeAll(async () => {
  if (SKIP_BY_ENV) return
  up = await isDbReachable(HOST, PORT)
  if (!up) {
    console.log('⏭ postgres not reachable — skipping migrate confirmation tests')
    return
  }

  workdir = await mkdtemp(join(tmpdir(), 'dbcli-migrate-confirm-'))
  configPath = join(workdir, '.dbcli')
  await writeFile(
    configPath,
    JSON.stringify({ connection, permission: 'admin', metadata: { version: '1.0' } }, null, 2)
  )

  adapter = new PostgreSQLAdapter(connection)
  await adapter.connect()
})

afterAll(async () => {
  if (adapter) {
    await adapter.execute(`DROP TABLE IF EXISTS "${TABLE}"`)
    await adapter.disconnect()
  }
  if (workdir) await rm(workdir, { recursive: true, force: true })
})

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

/** Answer the prompt, and keep the command's output out of the test log. */
function answering(answer: boolean): { asked: () => number } {
  let count = 0
  spies.push(
    spyOn(console, 'log').mockImplementation(() => {}),
    spyOn(console, 'error').mockImplementation(() => {}),
    spyOn(process.stderr, 'write').mockImplementation((() => true) as never),
    spyOn(process, 'exit').mockImplementation((() => undefined) as never),
    spyOn(promptUser, 'confirm').mockImplementation(async () => {
      count += 1
      return answer
    })
  )
  return { asked: () => count }
}

async function tableExists(): Promise<boolean> {
  const result = await adapter!.execute(
    `SELECT to_regclass('public.${TABLE}') IS NOT NULL AS present`
  )
  return (result.rows[0] as { present: boolean }).present === true
}

describe('migrate asks before dropping', () => {
  test('a declined drop leaves the table standing', async () => {
    if (!up) return
    await adapter!.execute(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id integer)`)

    const prompt = answering(false)
    await runDDL({ kind: 'dropTable', table: TABLE }, { config: configPath, execute: true })

    expect(prompt.asked()).toBe(1)
    expect(await tableExists()).toBe(true)
  })

  test('a confirmed drop removes it', async () => {
    if (!up) return
    await adapter!.execute(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id integer)`)

    answering(true)
    await runDDL({ kind: 'dropTable', table: TABLE }, { config: configPath, execute: true })

    expect(await tableExists()).toBe(false)
  })

  test('--force drops without asking', async () => {
    if (!up) return
    await adapter!.execute(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id integer)`)

    const prompt = answering(false)
    await runDDL(
      { kind: 'dropTable', table: TABLE },
      { config: configPath, execute: true, force: true }
    )

    expect(prompt.asked()).toBe(0)
    expect(await tableExists()).toBe(false)
  })
})
