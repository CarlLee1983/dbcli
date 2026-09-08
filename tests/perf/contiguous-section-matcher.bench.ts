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

function nested(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { deeper: 'x' }
  for (let i = 0; i < depth; i++) value = { [`seg${i}`]: value }
  return value
}

function esResponse(hits: number, fields: number, depth = 2): unknown {
  const source: Record<string, unknown> = {}
  for (let f = 0; f < fields; f++) source[`field_${f}`] = 'v'
  source.profile = { email: 'a', phone: 'b', nested: nested(depth) }
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
    // 絕對那一則（deep < 500ms）拿掉了：它跟上面這條比值擋的是同一個退步，卻會被
    // 負載翻掉——加壓十輪量到 512.81ms 而程式碼沒有變過（DBCLI-019）。
    expect(deep / Math.max(shallow, 0.001)).toBeLessThan(20)
  })

  it('redactFields walks a large response without a per-key rescan', () => {
    // 深度是請求方推得動的成本，也是這支檔案存在的理由：列舉全部連續區段的做法
    // 對深度是三次方的。比值量的就是那件事——深 24 對深 3，同一台機器上的同一種
    // 工作，負載同時放大分子與分母所以會抵消：閒置量到 3.81–4.14，八個 CPU 迴圈
    // 壓著量到 4.01–4.78，門檻放在 15。退回三次方的版本在這個形狀上是上百倍。
    const shallow = medianElapsed(() => redactFields(esResponse(500, 20, 3), RULES), 5)
    const deep = medianElapsed(() => redactFields(esResponse(500, 20, 24), RULES), 5)

    // 原本這裡是 5000 hits x 20 fields 對 350ms 的絕對比較。它在同一個 commit 上
    // 五跑五敗（量到 408ms）而程式碼沒有變過——DBCLI-019，EV-018 到 EV-020——而且
    // 光量它加壓時就要 3.4 秒，會把整個 case 推過 bun 的 5000ms test timeout，那
    // 同樣是被負載翻掉的判決。這條路徑真正的護欄本來就在
    // `tests/unit/core/contiguous-section-matcher.test.ts` 的深度比值上，所以絕對
    // 那一則是重複的上限，量到的成本由下面兩行印出來。
    report('redactFields depth=3 x500 (ratio denominator)', shallow, 350)
    report('redactFields depth=24 x500', deep, 350)
    expect(deep / Math.max(shallow, 0.001)).toBeLessThan(15)
  })

  it('findProtectedFieldReference answers a deep request without a cubic scan', () => {
    const cost = (depth: number) => {
      const request = { $project: { out: `$${deepPath(depth)}` } }
      return medianElapsed(() => {
        let hits = 0
        for (let i = 0; i < 10_000; i++) if (findProtectedFieldReference(request, RULES)) hits++
        return hits + 1
      })
    }
    const shallow = cost(5)
    const deep = cost(40)

    // 跟上面兩則同一個形狀：8 倍深度線性大約是 8 倍，三次方是上百倍。比值閒置量到
    // 6.00–6.22，八個 CPU 迴圈壓著量到 5.44–7.68，門檻放在 20。原本的 600ms 絕對
    // 門檻加壓時量到 700.18ms 而程式碼沒有變過（DBCLI-019）。
    report('findProtectedFieldReference depth=5 x10000 (ratio denominator)', shallow, 600)
    report('findProtectedFieldReference depth=40 x10000', deep, 600)
    expect(deep / Math.max(shallow, 0.001)).toBeLessThan(20)
  })
})
