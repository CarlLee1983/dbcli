/**
 * 「哪些規則適用於這張表／這個 collection」也是一次名稱比對，也要走同一個折疊。
 *
 * ADR-0020 的 falsification 第一條管的是**所有**黑名單比對，不只欄位名。
 * `e92a6e55` 把 `foldFieldPath` 從 `path.toLowerCase()` 換成 `foldCase` 之後，
 * 這幾處挑選規則的比對仍是裸的 `toLowerCase`：`BlacklistManager` 用新的折疊建
 * 索引，呼叫端用舊的折疊去查，查不到，而查不到的結果是「沒有規則」。
 *
 * 兩處都是 enforcing。`dbcli check` 會去抽樣一張它自己認為被擋下的表；MongoDB
 * 的讀取遮罩與請求檢查會對一個 `isColumnBlacklisted` 說受保護的 collection
 * 回傳明文，並放行 `$project` 把它搬出來。
 */
import { describe, test, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { maskMongoRows } from '@/core/mongo/field-masker'
import { findProtectedFieldReference, protectedFieldsForRequest } from '@/core/mongo/request-fields'

// 折疊分歧的碼點只有三個：U+0130、U+03A3、U+03C2。`ΑΣ` 與 `ασ` 是可觸及的最短形狀
// ——`toLowerCase('ΑΣ')` 是 `ας`（尾字 sigma），`foldCase('ΑΣ')` 是 `ασ`。
const AS_RULE = 'ΑΣ'
const AS_NAME = 'ασ'

describe('a command consults the table set the way the manager built it', () => {
  const manager = new BlacklistManager({
    blacklist: { enabled: true, tables: [AS_RULE, 'secrets*'], columns: {} },
  } as never)

  test('a blacklisted table is refused under either spelling', () => {
    expect(manager.isTableBlacklisted(AS_NAME)).toBe(true)
    expect(manager.isTableBlacklisted(AS_RULE)).toBe(true)
  })

  // 一併蓋住的既有缺口：`dbcli check` 讀的是 `state.tables`，那裡只有字面條目，
  // 所以萬用字元規則對它完全不存在。ADR-0019 Decision 4 讓 `tables` 對所有引擎
  // 都是 glob，這條路徑沒跟上。
  test('a wildcard table rule is refused too', () => {
    expect(manager.isTableBlacklisted('secrets_2026')).toBe(true)
    expect(manager.isTableBlacklisted('SECRETS_2026')).toBe(true)
  })

  test('an unrelated table is still allowed', () => {
    expect(manager.isTableBlacklisted('orders')).toBe(false)
  })
})

describe('the rules that apply to a collection are selected by the one fold rule', () => {
  const columns: Record<string, string[]> = { [AS_NAME]: ['password'] }

  test('the read mask finds the rules filed under another spelling', () => {
    const masked = maskMongoRows([{ _id: 1, password: 'p1' }], AS_RULE, {
      enabled: true,
      tables: [],
      columns,
    } as never)
    expect(JSON.stringify(masked)).not.toContain('p1')
  })

  test('the request check finds them too', () => {
    const fields = protectedFieldsForRequest({}, AS_RULE, columns)
    expect(fields.has('password')).toBe(true)
    expect(findProtectedFieldReference({ $project: { leak: '$password' } }, fields)).toBeDefined()
  })

  test('an unrelated collection still gets no rules', () => {
    expect(protectedFieldsForRequest({}, 'orders', columns).size).toBe(0)
  })
})
