/**
 * 連續區段比對的成本。
 *
 * `namesProtectedField`／`redactFields`／`findProtectedFieldReference` 都要回答
 * 同一個問題：這條點分路徑有沒有任何**連續區段**命中黑名單。原本的做法是列舉
 * 全部 O(n²) 個區段，每一個再 `slice().join('.')` 組成字串——實際是 O(n³)。
 *
 * 2026-09-01 在這台機器上量到的起點：`namesProtectedField` 深度 5→40（8 倍）
 * 從 36ms 變成 6316ms，175 倍；`redactFields` 5000 hits x 20 fields 要 409ms。
 * 回應的巢狀深度由叢集決定，不由設定決定，所以這是請求方可以推的成本。
 *
 * 這份只有 `bun run test:perf` 會跑到（`bun test` 只收 `.test` 檔名，
 * `release:check` 也不含這一步），所以它記的是絕對數字，門檻放寬到量到的中位數
 * 三倍左右留給機器負載。真正擋演算法退回去的護欄是深度比值那一則，寫在
 * `tests/unit/core/contiguous-section-matcher.test.ts`，一般測試套件就會跑。
 */
import { describe, it, expect } from 'bun:test'
import { namesProtectedField, redactFields } from '@/commands/es-shell-guards'
import { findProtectedFieldReference } from '@/core/mongo/request-fields'
import { medianElapsed, report } from '../helpers/bench'

const RULES = new Set(['password', 'profile.email', 'pass*', 'secret', 'token'])

function deepPath(depth: number): string {
  return Array.from({ length: depth }, (_, i) => `seg${i}`).join('.')
}

function esResponse(hits: number, fields: number): unknown {
  const source: Record<string, unknown> = {}
  for (let f = 0; f < fields; f++) source[`field_${f}`] = 'v'
  source.profile = { email: 'a', phone: 'b', nested: { deep: { deeper: 'x' } } }
  return {
    hits: {
      hits: Array.from({ length: hits }, (_, i) => ({ _id: String(i), _source: { ...source } })),
    },
  }
}

describe('contiguous-section matching stays linear in path depth', () => {
  it('namesProtectedField does not grow cubically with depth', () => {
    const shallow = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 10_000; i++) if (namesProtectedField(deepPath(5), RULES)) hits++
      return hits + 1
    })
    const deep = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 10_000; i++) if (namesProtectedField(deepPath(40), RULES)) hits++
      return hits + 1
    })
    // 淺的那一則是比值的分母，不是一道門——印出實際預算，別描述一個不存在的門檻。
    report('namesProtectedField depth=5 x10000 (ratio denominator)', shallow, 500)
    report('namesProtectedField depth=40 x10000', deep, 500)
    // 8x the depth cost 182x on main; linear in depth would be about 8x.
    expect(deep / Math.max(shallow, 0.001)).toBeLessThan(20)
    expect(deep).toBeLessThan(500)
  })

  it('redactFields walks a large response without a per-key rescan', () => {
    const response = esResponse(5000, 20)
    const elapsed = medianElapsed(() => redactFields(response, RULES), 5)
    // 中位數量到 119ms（main 是 387ms）。門檻放在 3 倍上，因為這份 bench 常在
    // 別的東西也在跑的機器上執行；擋演算法退步的護欄是比值那一則，在
    // `tests/unit/core/contiguous-section-matcher.test.ts`。
    report('redactFields 5000 hits x 20 fields', elapsed, 350)
    expect(elapsed).toBeLessThan(350)
  })

  it('findProtectedFieldReference answers a deep request without a cubic scan', () => {
    const request = { $project: { out: `$${deepPath(40)}` } }
    const elapsed = medianElapsed(() => {
      let hits = 0
      for (let i = 0; i < 10_000; i++) if (findProtectedFieldReference(request, RULES)) hits++
      return hits + 1
    })
    report('findProtectedFieldReference depth=40 x10000', elapsed, 600)
    expect(elapsed).toBeLessThan(600)
  })
})
