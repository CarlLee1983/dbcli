/**
 * `MaskingCost` 存在的理由是「門不要讀時鐘」（ADR-0028），而它唯一會失效的方式是
 * 說謊：對一個其實走遍每一列的輸入回報零成本，benchmark 就會認證一段它沒有看過的
 * 走訪。這支測試盯的就是這件事，不是效能。
 */
import { describe, it, expect } from 'bun:test'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'

const baseConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'u',
    password: 'p',
    database: 'db',
  },
  permission: 'admin',
}

function validatorFor(columns: Record<string, string[]>): BlacklistValidator {
  const config = { ...baseConfig, blacklist: { tables: [], columns } }
  return new BlacklistValidator(new BlacklistManager(config as never))
}

function rowsOf(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `n${i}` }))
}

describe('MaskingCost', () => {
  it('reports the rows a rule that omitted nothing still had to walk', () => {
    // 落空的規則是最貴的形狀，不是最便宜的：它沒有東西可以移除，卻要先看過每一列
    // 才知道。這裡的返回路徑是「omittedColumns 為空」那一條。
    const result = validatorFor({ users: ['nothing_matches'] }).filterColumns('users', rowsOf(25), [
      'id',
      'name',
    ])

    expect(result.omittedColumns).toEqual([])
    expect(result.cost.rowsScanned).toBe(25)
    expect(result.cost.keysScanned).toBe(50)
    expect(result.cost.ruleEvaluations).toBe(1)
  })

  it('reports zero only when the masking pass genuinely did nothing', () => {
    // 沒有任何規則適用這張表時是真的一列都沒有走。零在這裡是事實，不是遺漏。
    const result = validatorFor({ other_table: ['password'] }).filterColumns('users', rowsOf(25), [
      'id',
      'name',
    ])

    expect(result.cost.rowsScanned).toBe(0)
    expect(result.cost.keysScanned).toBe(0)
    expect(result.cost.ruleEvaluations).toBe(0)
  })

  it('counts every row and key, on the path that does omit something', () => {
    const result = validatorFor({ users: ['name'] }).filterColumns('users', rowsOf(10), [
      'id',
      'name',
    ])

    expect(result.omittedColumns).toEqual(['name'])
    expect(result.cost.rowsScanned).toBe(10)
    expect(result.cost.keysScanned).toBe(20)
  })

  it('counts the rows a dotted rule descends into, and none when its head is absent', () => {
    const present = validatorFor({ users: ['profile.ssn'] }).filterColumns(
      'users',
      Array.from({ length: 8 }, (_, i) => ({ id: i, profile: { ssn: `s${i}` } })),
      ['id', 'profile']
    )
    // 命中就停，所以是 1 而不是 8。
    expect(present.cost.nestedProbeRows).toBe(1)
    expect(present.cost.pathSplits).toBe(1)

    const absent = validatorFor({ users: ['profile.ssn'] }).filterColumns('users', rowsOf(8), [
      'id',
      'name',
    ])
    // 規則的頭在任何一列都不是物件，所以一列都不必往下走——這正是 DBCLI-019 那個
    // 退步反過來的樣子。
    expect(absent.cost.nestedProbeRows).toBe(0)
    expect(absent.cost.pathSplits).toBe(0)
  })

  it('is frozen, so a caller cannot edit the record of what happened', () => {
    const cost = validatorFor({ users: ['name'] }).filterColumns('users', rowsOf(3), [
      'id',
      'name',
    ]).cost

    expect(Object.isFrozen(cost)).toBe(true)
  })
})
