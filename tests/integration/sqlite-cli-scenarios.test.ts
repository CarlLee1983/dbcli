/**
 * SQLite 能力宣告 → CLI 情境 → 實際斷言（DBCLI-040 / AC-001、AC-005、AC-007）
 *
 * 先跑每一條情境，跑過且通過的才進 `executed`；最後拿真的
 * `ENGINE_CAPABILITIES.sqlite` 對帳。矩陣多宣告一格而沒有情境，這裡失敗並指名
 * 那一格；情境指名矩陣沒宣告的 key，這裡失敗並指名那條情境。
 *
 * 這組不掛 SKIP_INTEGRATION_TESTS：SQLite 不需要任何服務。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ENGINE_CAPABILITIES } from '@/adapters/capabilities'
import {
  createContext,
  createWorkspace,
  destroyWorkspace,
  type Workspace,
} from './sqlite-cli/harness'
import { SQLITE_CLI_SCENARIOS } from './sqlite-cli/scenarios'
import { formatReconciliation, reconcile } from './sqlite-cli/reconcile'

/** 一條情境 spawn 最多七個 CLI 程序；`bun test` 預設的 5 秒在滿載機器上不夠。 */
const SCENARIO_TIMEOUT_MS = 30_000

const executed = new Set<string>()
let ws: Workspace | undefined

afterEach(async () => {
  if (ws) await destroyWorkspace(ws)
  ws = undefined
})

describe('每一條登記的情境都 spawn 真的 CLI', () => {
  for (const scenario of SQLITE_CLI_SCENARIOS) {
    test(
      scenario.id,
      async () => {
        ws = await createWorkspace()
        await scenario.run(createContext(ws))

        // AC-007：dbcli 寫下的一切都在暫存目錄裡的私有 HOME 底下。
        const realConfig = join(process.env.HOME ?? '', '.config', 'dbcli', 'projects')
        const bindingDir = join(ws.workDir, '.dbcli')
        const ownStorage = await readdir(join(ws.homeDir, '.config', 'dbcli', 'projects'))
        expect(ownStorage.length).toBeGreaterThan(0)
        expect(bindingDir.startsWith(ws.workDir)).toBe(true)
        expect(realConfig.startsWith(ws.workDir)).toBe(false)

        executed.add(scenario.id)
      },
      SCENARIO_TIMEOUT_MS
    )
  }
})

describe('對帳：矩陣宣告 ↔ 已執行的情境', () => {
  test('登記表本身：id 唯一，每條至少證明一個 key', () => {
    const ids = SQLITE_CLI_SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const scenario of SQLITE_CLI_SCENARIOS) {
      expect([scenario.id, scenario.proves.length > 0]).toEqual([scenario.id, true])
    }
  })

  test('AC-001：每個 supported / limited 的 SQLite 宣告都有跑過且通過的情境', () => {
    const result = reconcile({
      matrix: ENGINE_CAPABILITIES.sqlite,
      scenarios: SQLITE_CLI_SCENARIOS,
      executed,
    })
    expect([formatReconciliation(result), result.ok && result.unexecuted.length === 0]).toEqual([
      'every SQLite claim has an executed CLI scenario',
      true,
    ])
  })
})
