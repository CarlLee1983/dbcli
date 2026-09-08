/**
 * 一條絕對 wall-clock 斷言就是一枚未爆彈：同一個 commit 在忙碌的機器上會給出跟閒置
 * 時不同的判決，而 `make verify` 把那個判決綁在確切的 revision 上（ADR-0026）。
 * DBCLI-019 把三條換成不受負載影響的量；剩下的沒有被修好，只是被記下來。
 *
 * 這份測試不禁止絕對斷言——常數因子的退步只有絕對時間量得到——它讓數量只能往下走。
 * 新增一條就會紅，而修好一條之後不把數字調降也會紅。
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const BENCH_DIR = path.resolve(import.meta.dir, '../../perf')

/**
 * 每支 bench 檔還剩幾條「單一絕對耗時 < 常數」的斷言。只准調降。
 *
 * 2026-09-08 的起點是 19 條，DBCLI-020 把它收到 0。DBCLI-019 把 `startup.bench.ts` 的 `--help`、
 * `blacklist-performance.bench.ts` 的 flattened docs 與
 * `contiguous-section-matcher.bench.ts` 的 redactFields 換掉之後剩下這些。
 */
const ABSOLUTE_TIME_BUDGETS: Record<string, number> = {
  'blacklist-performance.bench.ts': 0,
  'contiguous-section-matcher.bench.ts': 0,
  'query.bench.ts': 0,
  // 純報告，一條斷言都沒有。列在這裡是為了讓「每支 bench 檔都被算到」成立：
  // 新增一支 bench 而忘記登記，會在那一則失敗。
  'schema-performance.bench.ts': 0,
  'startup.bench.ts': 0,
}

/** 比值、位元組與數量不隨負載變，不算在內。 */
function isAbsoluteTimeAssertion(line: string): boolean {
  const match = /expect\((.+)\)\.toBeLessThan\(/.exec(line)
  if (!match) return false
  const subject = match[1] ?? ''
  return !subject.includes('/') && !/\bratio\b/i.test(subject) && !/bytes/i.test(subject)
}

function countIn(file: string): number {
  return readFileSync(path.join(BENCH_DIR, file), 'utf8')
    .split('\n')
    .filter(isAbsoluteTimeAssertion).length
}

describe('perf benches: absolute wall-clock assertions only shrink', () => {
  const benchFiles = readdirSync(BENCH_DIR).filter((f) => f.endsWith('.bench.ts'))

  it('every bench file is accounted for', () => {
    expect(benchFiles.sort()).toEqual(Object.keys(ABSOLUTE_TIME_BUDGETS).sort())
  })

  for (const file of Object.keys(ABSOLUTE_TIME_BUDGETS)) {
    it(`${file} has no more absolute time assertions than declared`, () => {
      const actual = countIn(file)
      const declared = ABSOLUTE_TIME_BUDGETS[file] ?? 0
      // 少於宣告的數字表示有人修好了一條卻沒有把這裡調降——一樣要紅，否則名單會
      // 慢慢失去意義。
      expect(actual).toBe(declared)
    })
  }

  it('the total is the number DBCLI-019 left behind', () => {
    const total = Object.keys(ABSOLUTE_TIME_BUDGETS).reduce((sum, f) => sum + countIn(f), 0)
    expect(total).toBe(0)
  })
})
