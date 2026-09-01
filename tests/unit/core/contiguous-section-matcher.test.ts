/**
 * 連續區段比對的兩個約束，寫成會失敗的測試而不是註解裡的一句話。
 *
 * 一、**折疊必須保長**。`globMatches` 的 `?` 與每個 `*`-free 區段都是固定寬度
 * 的窗口，而比對的文字是整串折過的；一個字元折成兩個碼元就永遠對不齊。這一則
 * 是複查在這個分支上抓到的 CRITICAL：`foldCase` 曾照 `toLowerCase` 把 `İ` 折成
 * `i` + U+0307，於是規則 `secret?` 擋不住表格 `secretİ`——而 `isTableBlacklisted`
 * 是強制擋下查詢的檢查，不是顯示過濾。
 *
 * 二、**比對的成本要對深度線性**。舊版對每個起點列舉每個終點、每個候選再組成
 * 字串，是 O(depth³)。這裡斷言的是深度 5 與深度 40 的**比值**而不是絕對毫秒，
 * 所以它對機器負載不敏感，可以留在一般測試套件裡跑；絕對數字在
 * `tests/perf/contiguous-section-matcher.bench.ts`，那份只有 `bun run test:perf`
 * 會跑到。
 */
import { describe, test, expect } from 'bun:test'
import { foldCase } from '@/utils/case-fold'
import { foldFieldPath } from '@/core/blacklist-fold'
import { globMatches } from '@/utils/glob'
import { BlacklistManager } from '@/core/blacklist-manager'
import { namesProtectedField } from '@/commands/es-shell-guards'

const CI = { caseInsensitive: true } as const

function managerWithTables(tables: string[]): BlacklistManager {
  return new BlacklistManager({ blacklist: { enabled: true, tables, columns: {} } } as never)
}

describe('the fold is length-preserving, context-free and idempotent', () => {
  // 掃到 U+2FFFF 涵蓋 BMP 加上 SMP 與 SIP 開頭；大小寫映射不出現在更高的平面。
  test('no code point folds to a different number of code units', () => {
    const changed: string[] = []
    for (let cp = 0; cp <= 0x2ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const char = String.fromCodePoint(cp)
      if (foldCase(char).length !== char.length) changed.push(`U+${cp.toString(16)}`)
    }
    expect(changed).toEqual([])
  })

  // `runMatchesAt` 用同一個 `at + i` 同時索引折過與未折疊的 subject，靠的是
  // **字串層級**的保長，而逐碼點的保長不會自動組合成字串層級的保長——折疊是
  // 「先 replaceAll 再 toLowerCase」兩道，而 `toLowerCase` 看上下文。所以這一則
  // 用隨機字串斷言，而不是只掃單一碼點；種子固定，失敗可以重現。
  test('folding an arbitrary string preserves its code-unit length', () => {
    let seed = 0x9e3779b9
    const next = (): number => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return seed >>> 0
    }
    // 含孤立代理對半邊：欄位名是位元組來的，不保證是良構的 UTF-16。
    const interesting = [
      '\u{10400}',
      '\u{1E900}',
      'İ',
      'i\u0307',
      'Σ',
      'ς',
      'σ',
      '\uD801',
      '\uDC00',
    ]
    const changed: string[] = []
    for (let n = 0; n < 40_000; n++) {
      let subject = ''
      const length = 1 + (next() % 6)
      for (let i = 0; i < length; i++) {
        subject +=
          next() % 3 === 0
            ? interesting[next() % interesting.length]!
            : String.fromCodePoint(next() % 0x2ffff)
      }
      if (foldCase(subject).length !== subject.length) changed.push(JSON.stringify(subject))
      if (changed.length > 3) break
    }
    expect(changed).toEqual([])
  })

  test('folding a string equals folding its characters', () => {
    const diverged: string[] = []
    for (let cp = 0; cp <= 0x2ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const char = String.fromCodePoint(cp)
      const contexts: Array<[string, string]> = [
        ['a', 'b'],
        ['a', '_'],
        ['', ''],
      ]
      for (const [before, after] of contexts) {
        if (
          foldCase(before + char + after) !==
          foldCase(before) + foldCase(char) + foldCase(after)
        ) {
          diverged.push(`U+${cp.toString(16)}`)
          break
        }
      }
      if (foldCase(foldCase(char)) !== foldCase(char))
        diverged.push(`idempotency U+${cp.toString(16)}`)
    }
    expect(diverged).toEqual([])
  })

  test('a `?` still consumes a character whose lower case is two code units', () => {
    expect(globMatches('secret?', foldFieldPath('secretİ'), CI)).toBe(true)
    expect(managerWithTables(['secret?']).isTableBlacklisted('secretİ')).toBe(true)
  })

  // 折疊保長還不夠：兩側折的**粒度**也要一樣。pattern 是逐碼元讀的，所以一個
  // astral 字元進到 token 時是半個代理對，而 `foldCase` 對半個代理對是恆等函式
  // ——文字那一側卻整串折過，真的把碼點映成了小寫。第二次對抗式複查在這個分支上
  // 抓到的 CRITICAL：規則 `𐐀` 比不上欄位 `𐐀`，連自己都命不中。Adlam
  // （U+1E900，約四千萬使用者的活語言）與其他有大小寫的 astral 文字同理。
  test('a rule made of astral characters matches the field it names', () => {
    const deseret = '\u{10400}'
    const adlam = '\u{1E900}'
    expect(globMatches(deseret, foldFieldPath(deseret), CI)).toBe(true)
    expect(globMatches(`${deseret}*`, foldFieldPath(`${deseret}pass`), CI)).toBe(true)
    expect(globMatches(`\\${deseret}*`, foldFieldPath(`${deseret}pass`), CI)).toBe(true)
    expect(globMatches(`${adlam}*`, foldFieldPath(`${adlam}pass`), CI)).toBe(true)
    expect(managerWithTables([`${deseret}*`]).isTableBlacklisted(`${deseret}secrets`)).toBe(true)
  })

  // 字元類的大小寫由 regex 的 `i` 旗標回答，pattern 的文字一個字都不改寫
  // （ADR-0020 Decision 2），所以比對的必須是**未折疊**的文字。折過再比對在
  // BMP 上不多做任何事，卻會換掉 astral 字元的低位代理。
  test('a character class compares against the name as written', () => {
    expect(globMatches('[A-z]assword', foldFieldPath('_assword'), CI)).toBe(true)
    expect(globMatches('[A-Z]assword', foldFieldPath('Password'), CI)).toBe(true)
    expect(globMatches('[a-z]assword', foldFieldPath('Password'), CI)).toBe(true)
  })

  test('a rule protects the field it names when the fold disagrees with itself', () => {
    // `Σ` 折成 `ς` 或 `σ` 取決於後面是不是字母——整串折與逐字折因此曾給出兩個答案。
    expect(globMatches('ΑΣ*', foldFieldPath('ΑΣ_num'), CI)).toBe(true)
    expect(globMatches('*ΑΣ', foldFieldPath('user_ΑΣ'), CI)).toBe(true)
    expect(globMatches('İ*', foldFieldPath('İd'), CI)).toBe(true)
  })
})

describe('contiguous-section matching is linear in path depth', () => {
  test('eight times the depth does not cost more than twenty times as much', () => {
    const rules = new Set(['password', 'profile.email', 'pass*', 'secret', 'token'])
    const path = (depth: number): string =>
      Array.from({ length: depth }, (_, i) => `seg${i}`).join('.')
    const cost = (depth: number): number => {
      const target = path(depth)
      const started = performance.now()
      for (let i = 0; i < 2000; i++) namesProtectedField(target, rules)
      return performance.now() - started
    }
    cost(5) // warm the JIT and the parsed-glob memo before either sample counts
    const shallow = Math.min(cost(5), cost(5))
    const deep = Math.min(cost(40), cost(40))
    // O(depth³) 的舊版在這裡是 180 倍上下；線性大約是 8 倍。
    expect(deep / Math.max(shallow, 0.001)).toBeLessThan(20)
  })
})
