/**
 * 負向驗證：入口拒絕 SQLite 時，情境真的會失敗（DBCLI-040 / AC-004）
 *
 * `mutant-sql-gate.preload.ts` 透過 `bun run --preload` 只在被 spawn 的 CLI
 * 裡，把 `require-sql-connection.ts` 換回 DBCLI-036 之前的三引擎字面量。
 * 測試程序自己不載入它，所以同一個測試裡直接開 adapter 讀得到資料——這正是
 * PR #194 記錄的情形：adapter 層通過，CLI 入口拒絕。
 *
 * 兩邊都要看：經過閘門的情境必須失敗，不經過閘門的情境必須照常通過。只有前者
 * 的話，一個把所有東西弄壞的 preload 也能通過這支測試。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { SQLiteAdapter } from '@/adapters/sqlite-adapter'
import type { ConnectionOptions } from '@/adapters/types'
import type { CommandCapabilityKey } from '@/adapters/capabilities'
import {
  createContext,
  createWorkspace,
  destroyWorkspace,
  initSqlite,
  runCli,
  type Workspace,
} from './sqlite-cli/harness'
import { SQLITE_CLI_SCENARIOS } from './sqlite-cli/scenarios'

const MUTANT = resolve(import.meta.dir, 'sqlite-cli/mutant-sql-gate.preload.ts')

/**
 * 每個真的把 SQLite 連線送進 `requireSqlConnection` 的命令所擁有的矩陣 key。
 * `doctor.ts` 也 import 它，但 sqlite 分支在到達閘門之前就轉去
 * `collectSQLiteDoctorResults`，所以 doctor 不在這裡。
 */
const GUARDED_KEYS: readonly CommandCapabilityKey[] = [
  'list',
  'query',
  'queryOutput',
  'queryLimitGuard',
  'insert',
  'update',
  'delete',
  'export',
]

const SCENARIO_TIMEOUT_MS = 30_000

let ws: Workspace | undefined

afterEach(async () => {
  if (ws) await destroyWorkspace(ws)
  ws = undefined
})

describe('閘門換回舊字面量時', () => {
  test('preload 真的生效：query 在 CLI 被拒，adapter 在測試程序裡照讀', async () => {
    ws = await createWorkspace()
    await initSqlite(ws)
    const refused = await runCli(ws, ['query', 'SELECT id FROM users', '--format', 'json'], {
      preload: MUTANT,
    })
    expect(refused.code).not.toBe(0)
    expect(`${refused.stdout}${refused.stderr}`).toContain(
      'This command requires a SQL connection, got: sqlite'
    )

    const adapter = new SQLiteAdapter({
      system: 'sqlite',
      file: ws.dbPath,
      host: '',
      port: 0,
      user: '',
      password: '',
      database: '',
    } as ConnectionOptions)
    await adapter.connect()
    try {
      const rows = await adapter.execute('SELECT id FROM users')
      expect(rows.rowCount).toBe(1)
    } finally {
      await adapter.disconnect()
    }
  })

  for (const scenario of SQLITE_CLI_SCENARIOS.filter((s) => s.guarded)) {
    test(
      `經過閘門的情境失敗：${scenario.id}`,
      async () => {
        ws = await createWorkspace()
        await expect(scenario.run(createContext(ws, { preload: MUTANT }))).rejects.toThrow()
      },
      SCENARIO_TIMEOUT_MS
    )
  }

  for (const scenario of SQLITE_CLI_SCENARIOS.filter((s) => !s.guarded)) {
    test(
      `不經過閘門的情境照常通過：${scenario.id}`,
      async () => {
        ws = await createWorkspace()
        await scenario.run(createContext(ws, { preload: MUTANT }))
      },
      SCENARIO_TIMEOUT_MS
    )
  }

  test('每個閘門守著的 key 都至少有一條經過閘門的情境', () => {
    const guardedProves = new Set(
      SQLITE_CLI_SCENARIOS.filter((s) => s.guarded).flatMap((s) => s.proves)
    )
    for (const key of GUARDED_KEYS) {
      expect([key, guardedProves.has(key)]).toEqual([key, true])
    }
  })
})
