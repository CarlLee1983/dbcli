/**
 * 對帳函式在受控 fixture 下的三種失敗（DBCLI-040 / AC-002、AC-003、AC-006）
 *
 * fixture 是一份小矩陣，不是真的 `ENGINE_CAPABILITIES`——真的矩陣一格都不改
 * （AC-008）。這裡證明的是：檢查真的會擋，而且擋的時候指得出名字。
 */

import { describe, test, expect } from 'bun:test'
import { ENGINE_CAPABILITIES } from '@/adapters/capabilities'
import type { CommandCapabilityKey } from '@/adapters/capabilities'
import { declaredKeys, formatReconciliation, reconcile } from '../integration/sqlite-cli/reconcile'
import { SQLITE_CLI_SCENARIOS } from '../integration/sqlite-cli/scenarios'

const entry = (status: 'supported' | 'limited' | 'unsupported' | 'not-applicable') => ({
  status,
  tier: 'readonly' as const,
  note: '',
})

const FIXTURE_MATRIX = {
  list: entry('supported'),
  query: entry('supported'),
  queryLimitGuard: entry('limited'),
  migrate: entry('unsupported'),
  proxy: entry('not-applicable'),
}

const BOTH = [
  { id: 'list', proves: ['list'] as CommandCapabilityKey[] },
  { id: 'query', proves: ['query', 'queryLimitGuard'] as CommandCapabilityKey[] },
]

describe('declaredKeys', () => {
  test('supported 與 limited 算宣告；unsupported 與 not-applicable 不算', () => {
    expect(declaredKeys(FIXTURE_MATRIX)).toEqual(['list', 'query', 'queryLimitGuard'])
  })
})

describe('reconcile', () => {
  test('全部對上時 ok', () => {
    const result = reconcile({
      matrix: FIXTURE_MATRIX,
      scenarios: BOTH,
      executed: new Set(['list', 'query']),
    })
    expect(result).toEqual({ missing: [], stale: [], unexecuted: [], ok: true })
  })

  test('AC-002：矩陣多宣告一格而沒有情境 → 失敗並指名那一格', () => {
    const result = reconcile({
      matrix: { ...FIXTURE_MATRIX, shell: entry('supported') },
      scenarios: BOTH,
      executed: new Set(['list', 'query']),
    })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['shell'])
    expect(formatReconciliation(result)).toContain('no executed CLI scenario proves: shell')
  })

  test('AC-002：unsupported 翻成 supported 也是同一種失敗', () => {
    const result = reconcile({
      matrix: { ...FIXTURE_MATRIX, migrate: entry('supported') },
      scenarios: BOTH,
      executed: new Set(['list', 'query']),
    })
    expect(result.missing).toEqual(['migrate'])
  })

  test('AC-003：情境指名矩陣沒有的 key → 失敗並指名情境與 key', () => {
    const result = reconcile({
      matrix: FIXTURE_MATRIX,
      scenarios: [...BOTH, { id: 'ghost', proves: ['teleport' as CommandCapabilityKey] }],
      executed: new Set(['list', 'query', 'ghost']),
    })
    expect(result.ok).toBe(false)
    expect(result.stale).toEqual([{ scenario: 'ghost', key: 'teleport', status: 'unknown' }])
    expect(formatReconciliation(result)).toContain('scenario "ghost" claims "teleport"')
  })

  test('AC-003：情境指名已不再支援的 key → 失敗並說出目前狀態', () => {
    const result = reconcile({
      matrix: FIXTURE_MATRIX,
      scenarios: [...BOTH, { id: 'old-migrate', proves: ['migrate'] }],
      executed: new Set(['list', 'query', 'old-migrate']),
    })
    expect(result.stale).toEqual([
      { scenario: 'old-migrate', key: 'migrate', status: 'unsupported' },
    ])
  })

  test('AC-006：登記了但沒執行 → 回報 unexecuted，它的 key 算沒證明', () => {
    const result = reconcile({
      matrix: FIXTURE_MATRIX,
      scenarios: BOTH,
      executed: new Set(['list']),
    })
    expect(result.unexecuted).toEqual(['query'])
    expect(result.missing).toEqual(['query', 'queryLimitGuard'])
    expect(result.ok).toBe(false)
    expect(formatReconciliation(result)).toContain('registered but not executed')
  })

  test('AC-006：情境失敗（不在 executed）與情境缺席，對矩陣來說是同一件事', () => {
    const withScenario = reconcile({
      matrix: FIXTURE_MATRIX,
      scenarios: BOTH,
      executed: new Set(['list']),
    })
    const withoutScenario = reconcile({
      matrix: FIXTURE_MATRIX,
      scenarios: BOTH.slice(0, 1),
      executed: new Set(['list']),
    })
    expect(withScenario.missing).toEqual(withoutScenario.missing)
  })
})

describe('真的登記表對真的矩陣（不執行任何情境的靜態半邊）', () => {
  test('沒有任何情境指名 SQLite 未宣告的 key', () => {
    const result = reconcile({
      matrix: ENGINE_CAPABILITIES.sqlite,
      scenarios: SQLITE_CLI_SCENARIOS,
      executed: new Set(),
    })
    expect(result.stale).toEqual([])
  })

  test('沒執行任何情境時，每一個宣告都是 missing——證據只能來自執行', () => {
    const result = reconcile({
      matrix: ENGINE_CAPABILITIES.sqlite,
      scenarios: SQLITE_CLI_SCENARIOS,
      executed: new Set(),
    })
    expect([...result.missing].sort()).toEqual(declaredKeys(ENGINE_CAPABILITIES.sqlite).sort())
    expect(result.unexecuted).toEqual(SQLITE_CLI_SCENARIOS.map((s) => s.id))
  })
})
