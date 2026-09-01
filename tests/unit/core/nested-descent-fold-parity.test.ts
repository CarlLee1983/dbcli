/**
 * 一套折疊規則要走到巢狀下潛與 index 慣例名，而不是停在最外層。
 *
 * ADR-0020 的 falsification 條件第一條說：黑名單的比對不得用 `foldFieldPath`
 * 或 `globMatches` 的 `caseInsensitive` 以外的方式折疊名稱。`e92a6e55`（PR #136）
 * 把 `foldFieldPath` 從 `path.toLowerCase()` 換成 `foldCase`（`ς`→`σ`、`İ`→`i`），
 * 而 `field-projection.ts` 的五處與 `es-index-target.ts` 的 `reachesByConvention`
 * 仍是裸的 `toLowerCase`。在那之前兩邊天生一致，換掉之後就是兩套折疊——正是
 * ADR-0018 記下、ADR-0020 要移除的那個失敗形狀，而且解在 fail-open 的方向。
 *
 * 最尖銳的一列是規則 `profile.ΑΣ`：它**回傳自己指名的那個鍵**，卻遮掉它沒有指名
 * 的 `ασ`。操作者確認規則有效的方式通常是看某個東西被遮下來，而被遮的是錯的那個。
 */
import { describe, test, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { indexExpressionReaches } from '@/utils/es-index-target'

/** SQL／ES 讀取路徑對一個 jsonb 形狀的欄位下潛的結果。 */
function nestedRead(rule: string, nestedKey: string): { leaked: boolean; omitted: string[] } {
  const blacklist = { enabled: true, tables: [], columns: { probe: [rule] } }
  const validator = new BlacklistValidator(new BlacklistManager({ blacklist } as never))
  const result = validator.filterColumnsForTables(
    ['probe'],
    [{ id: 1, profile: { [nestedKey]: 'PLAIN' } }],
    ['id', 'profile']
  )
  return {
    leaked: JSON.stringify(result.filteredRows).includes('PLAIN'),
    omitted: result.omittedColumns,
  }
}

describe('the nested descent folds by the one fold rule', () => {
  // 分歧的碼點正好是 `foldCase` 與 `toLowerCase` 不同的那三個：U+0130、U+03A3、
  // U+03C2。掃過 BMP 沒有第四個，所以這三列就是可觸及的全部形狀。
  const cases: Array<[string, string]> = [
    ['profile.ΑΣ', 'ΑΣ'],
    ['profile.ΑΣ', 'ασ'],
    ['profile.İd', 'İd'],
    ['profile.id', 'İd'],
    ['profile.ssn', 'SSN'],
  ]

  test.each(cases)('rule %p masks the nested key %p', (rule, key) => {
    expect(nestedRead(rule, key).leaked).toBe(false)
  })

  test('a rule that masks reports itself in omittedColumns', () => {
    expect(nestedRead('profile.ΑΣ', 'ΑΣ').omitted).toEqual(['profile.ΑΣ'])
  })
})

describe('an index reached by naming convention folds the same way', () => {
  // `.ds-<name>-<generation>` 是 data stream 的 backing index：黑名單條目指名資料流
  // 時，擋不住它的 backing index 就是擋不住讀取。同一個函式的精確比對那一半已經
  // 用 `foldFieldPath`，慣例那一半是裸的 `toLowerCase`——一個函式兩套折疊。
  const rules = ['ΑΣ']

  test('the exact name and its backing index answer the same', () => {
    expect(indexExpressionReaches('ασ', rules)).toBe(true)
    expect(indexExpressionReaches('.ds-ασ-2026', rules)).toBe(true)
  })

  test('an unrelated index is still not reached', () => {
    expect(indexExpressionReaches('orders', rules)).toBe(false)
    expect(indexExpressionReaches('.ds-orders-2026', rules)).toBe(false)
  })
})
