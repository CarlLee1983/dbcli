/**
 * `dbcli init` 的引擎名冊（DBCLI-036 / AC-004）
 *
 * init.ts 原本自己列了一份引擎字面量陣列，是 `DatabaseSystem` union、
 * `DATABASE_SYSTEMS` 與設定 schema 之外的第四份名冊。字面量與 union 之間沒有
 * 任何編譯期關係，所以 DBCLI-034 把 sqlite 加進 union 時，這份名冊安靜地留在
 * 六個引擎——init 選單裡選不到 SQLite，而且什麼都沒壞。
 *
 * 因此這裡有兩條斷言，而不是一條。相等性擋住「有人把它改回字面量並漏掉一個
 * 成員」；原始碼掃描擋住「有人把字面量加回去」——後者才是真正發生過的失效模式，
 * 而相等性測試對它是看不見的。
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INIT_SYSTEM_CHOICES } from '@/commands/init'
import { DATABASE_SYSTEMS } from '@/adapters/types'

const INIT_SOURCE = resolve(import.meta.dir, '../../../src/commands/init.ts')

describe('init 的引擎名冊', () => {
  test('與 DATABASE_SYSTEMS 完全相等，包含順序', () => {
    expect([...INIT_SYSTEM_CHOICES]).toEqual([...DATABASE_SYSTEMS])
  })

  test('任一方多出成員都會失敗', () => {
    expect(new Set(INIT_SYSTEM_CHOICES)).toEqual(new Set(DATABASE_SYSTEMS))
    expect(INIT_SYSTEM_CHOICES.length).toBe(DATABASE_SYSTEMS.length)
  })

  test('sqlite 在選單裡', () => {
    expect(INIT_SYSTEM_CHOICES).toContain('sqlite')
  })

  /**
   * 掃原始碼而非行為：字面量名冊重新出現時，行為測試看不出差別，直到某個引擎
   * 被漏掉為止。這條在漏掉之前就失敗。
   */
  test('init.ts 裡沒有重新出現的引擎字面量陣列', () => {
    const source = readFileSync(INIT_SOURCE, 'utf8')
    const literalRoster = /\[\s*(['"])postgresql\1\s*,/
    expect(literalRoster.test(source)).toBe(false)
  })
})
