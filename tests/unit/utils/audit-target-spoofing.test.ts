/**
 * audit 的 `target` 不能由使用者指定。
 *
 * 第九輪 CRITICAL：`getOperationTarget` 走一條單一 regex，不剝註解、不剝字串
 * 字面值，只取第一個 `FROM|INTO|UPDATE` 之後的識別字。於是攻擊者完全控制那個
 * 名字——而 `target` 正是稽核者事後篩選用的主要欄位（`audit show`、`recover`
 * 與 `inspect` 的 brief 都以它為主）。以 `target` 篩選會完全漏掉這些操作。
 *
 * `redacted_sql` 仍保留原文，所以紀錄不是全面偽造；被偽造的是**篩選欄位**，
 * 而那正是讓一筆紀錄「被找得到」的東西。找不到的紀錄與不存在的紀錄，對事後
 * 追查是同一件事。
 */

import { describe, test, expect } from 'bun:test'
import { getOperationTarget, sideEffectTierForStatement } from '@/utils/engine-hints'

const target = (sql: string): string => getOperationTarget('postgresql' as never, 'query', {}, sql)

describe('註解與字串字面值不能指定 target', () => {
  test('區塊註解裡的 FROM 不算', () => {
    expect(target('/* FROM audit_decoy */ DELETE FROM users WHERE id = 12345')).toBe('users')
  })

  test('行註解裡的 FROM 不算', () => {
    expect(target('-- FROM decoy\nDELETE FROM salaries WHERE id = 1')).toBe('salaries')
  })

  test('字串字面值裡的 INTO 不算', () => {
    expect(target("SELECT 'INTO decoy' AS note FROM salaries")).toBe('salaries')
  })

  test('巢狀區塊註解也剝得掉', () => {
    expect(target('/* a /* b */ FROM decoy */ UPDATE users SET x = 1')).toBe('users')
  })

  test('雙引號識別字裡的關鍵字不算', () => {
    expect(target('DELETE FROM "from decoy" WHERE id = 1')).toBe('from decoy')
  })
})

describe('合法 SQL 不被切壞', () => {
  test('schema 限定的表名保留完整', () => {
    expect(target('DELETE FROM public.users')).toBe('public.users')
  })

  test('帶連字號的引號表名保留完整', () => {
    expect(target('DELETE FROM "user-accounts" WHERE id = 1')).toBe('user-accounts')
  })

  test('EXTRACT(... FROM col) 不會把欄位名當成表名', () => {
    expect(target('SELECT EXTRACT(MONTH FROM created_at) FROM salaries')).toBe('salaries')
  })

  test('一般語句照常', () => {
    expect(target('SELECT * FROM users')).toBe('users')
    expect(target('INSERT INTO orders (id) VALUES (1)')).toBe('orders')
    expect(target('UPDATE users SET name = 1')).toBe('users')
  })
})

/**
 * 第九輪 CRITICAL：經 `query` 執行的 DML 一律記成 `side_effect_tier: readonly`。
 *
 * `writeAuditEntry` 在沒拿到 `sideEffectTier` 時取命令的能力等級，而 `query`
 * 的能力是 `readonly`（多數查詢是讀）。於是 `DELETE`、`UPDATE`、`INSERT`、
 * `CREATE TABLE AS` 全部以 `readonly` 入帳。
 *
 * 對照組更清楚：被寫入閘門**拒絕**的 `DROP` / `TRUNCATE` 由
 * `recordGateDecision` 自己帶 `db-write`。所以「被拒絕的寫入」是 db-write、
 * 「真正執行的寫入」是 readonly——剛好顛倒。以 tier 篩選稽核找破壞性操作
 * （最直覺的第一個篩選）會找到被擋下來的那些，漏掉真正發生的那些。
 *
 * 這與 ES 那側第一輪修過的缺陷同型（ADR-0014 記為「同一個破壞性操作因為經由
 * 不同命令而被記成三種 tier」），只是 SQL 這條路徑當時沒有一起修。
 */
describe('query 的 audit tier 反映語句本身的效果', () => {
  test.each([
    ['DELETE FROM users WHERE id = 1'],
    ['UPDATE users SET name = 1 WHERE id = 1'],
    ['INSERT INTO users (id) VALUES (1)'],
    ['CREATE TABLE dump AS SELECT * FROM salaries'],
  ])('%s 是 db-write', (sql) => {
    expect(sideEffectTierForStatement(sql)).toBe('db-write')
  })

  test.each([['SELECT * FROM users'], ['EXPLAIN SELECT * FROM users']])('%s 不覆寫 tier', (sql) => {
    expect(sideEffectTierForStatement(sql)).toBeUndefined()
  })
})
