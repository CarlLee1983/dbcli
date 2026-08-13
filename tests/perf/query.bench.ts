/**
 * 查詢執行效能
 *
 * 預算以中位數檢查（先丟棄一次暖機），避免單次被排程延遲就變成 flaky gate。
 *
 * 預算 800ms 的依據：2026-08-12 在 macOS/M4 實測，一次完整的 CLI 查詢往返
 * （process 啟動 + 設定載入 + 連線 + 查詢 + 格式化）對 localhost 資料庫約
 * 123–126ms。原本的 5000ms 是實測值的 40 倍，等於任何迴歸都抓不到；800ms
 * 留了約 6 倍餘裕給 CI 噪音，同時能攔下數量級的迴歸。
 *
 * 兩組情境：
 *   - SQL：需要 TEST_DATABASE_URL 指向可用的測試資料庫。
 *   - Redis：本機 127.0.0.1:6379 可連線時自動啟用，讓這支 bench 在沒有
 *     SQL server 的開發機上仍可重現執行。
 *
 * 設 SKIP_PERF_TESTS=1 可整支跳過。dist 尚未建置時同樣跳過。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')
const perfEnabled = existsSync(cliPath) && !process.env.SKIP_PERF_TESTS

/** 一次完整 CLI 查詢往返的預算（毫秒），中位數比較 */
const QUERY_BUDGET_MS = 800

const REDIS_HOST = process.env.DBCLI_BENCH_REDIS_HOST ?? '127.0.0.1'
const REDIS_PORT = Number(process.env.DBCLI_BENCH_REDIS_PORT ?? 6379)

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1', DBCLI_NO_UPDATE_CHECK: '1' },
  })
}

/** 丟棄一次暖機後取 sampleCount 次的中位數 */
function medianQueryMs(args: string[], sampleCount = 5): number {
  const warmup = runCli(args)
  expect(warmup.status).toBe(0)

  const samples: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const start = performance.now()
    const result = runCli(args)
    samples.push(performance.now() - start)
    expect(result.status).toBe(0)
  }

  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

function report(label: string, elapsed: number): void {
  console.log(`${label} = ${elapsed.toFixed(2)}ms (budget ${QUERY_BUDGET_MS}ms)`)
}

// ─── SQL：需要 TEST_DATABASE_URL ───────────────────────────────────────────

const sqlEnabled = perfEnabled && !!process.env.TEST_DATABASE_URL

describe.if(sqlEnabled)('Performance: Query Execution (SQL)', () => {
  it('query "SELECT 1" --format json 在預算內完成', () => {
    const elapsed = medianQueryMs(['query', 'SELECT 1', '--format', 'json'])
    report('query SELECT 1 (json)', elapsed)
    expect(elapsed).toBeLessThan(QUERY_BUDGET_MS)
  })

  it('query "SELECT 1" table 格式在預算內完成', () => {
    const elapsed = medianQueryMs(['query', 'SELECT 1'])
    report('query SELECT 1 (table)', elapsed)
    expect(elapsed).toBeLessThan(QUERY_BUDGET_MS)
  })
})

// ─── Redis：本機可連線時啟用 ───────────────────────────────────────────────

async function isRedisReachable(): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: REDIS_HOST,
      port: REDIS_PORT,
      socket: {
        data() {},
        open(s) {
          s.end()
        },
        error() {},
        connectError() {},
      },
    })
    socket.end()
    return true
  } catch {
    return false
  }
}

const redisEnabled = perfEnabled && (await isRedisReachable())

describe.if(redisEnabled)('Performance: Query Execution (Redis)', () => {
  let configPath = ''
  let configRoot = ''

  beforeAll(() => {
    configRoot = mkdtempSync(path.join(tmpdir(), 'dbcli-query-bench-'))
    mkdirSync(path.join(configRoot, '.dbcli'), { recursive: true })
    configPath = path.join(configRoot, '.dbcli', 'config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        connection: {
          system: 'redis',
          host: REDIS_HOST,
          port: REDIS_PORT,
          database: '0',
        },
        permission: 'query-only',
      })
    )
  })

  afterAll(() => {
    if (configRoot) rmSync(configRoot, { recursive: true, force: true })
  })

  it('query "PING" --format json 在預算內完成', () => {
    const elapsed = medianQueryMs(['--config', configPath, 'query', 'PING', '--format', 'json'])
    report('query PING (json)', elapsed)
    expect(elapsed).toBeLessThan(QUERY_BUDGET_MS)
  })

  it('query "PING" table 格式在預算內完成', () => {
    const elapsed = medianQueryMs(['--config', configPath, 'query', 'PING'])
    report('query PING (table)', elapsed)
    expect(elapsed).toBeLessThan(QUERY_BUDGET_MS)
  })
})
