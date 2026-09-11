/**
 * SQLite 能力宣告與 CLI 情境的對帳（DBCLI-040）
 *
 * 純函式：矩陣進來、情境登記表進來、「真的跑過而且通過」的情境集合進來，
 * 三種偏差出去。沒有 I/O，所以受控 fixture 可以直接餵它，不必改動真的矩陣。
 *
 * 宣告集合的述詞與 ADR-0022 的 catalog `engines` 相同：狀態是 `supported` 或
 * `limited`。這裡不維護第二份「SQLite 支援什麼」的清單——矩陣是唯一來源，
 * 情境只指名它的 key。
 *
 * 「登記了但沒跑」不算證據（R2）。這正是原始缺陷的形狀：測試存在、測試通過、
 * 測試問的不是那個問題。所以 `executed` 是由跑過的測試回填的集合，不是登記表。
 */

import type {
  CommandCapabilityKey,
  EngineCapabilities,
  CapabilityStatus,
} from '@/adapters/capabilities'

export interface ScenarioClaim {
  readonly id: string
  readonly proves: readonly CommandCapabilityKey[]
}

export interface StaleClaim {
  readonly scenario: string
  readonly key: string
  readonly status: CapabilityStatus | 'unknown'
}

export interface Reconciliation {
  /** 矩陣宣告了，卻沒有任何已執行且通過的情境證明。 */
  readonly missing: readonly CommandCapabilityKey[]
  /** 情境宣稱證明，但矩陣沒有宣告（不存在，或狀態不是 supported/limited）。 */
  readonly stale: readonly StaleClaim[]
  /** 登記了但沒有執行，因此不貢獻任何證據。 */
  readonly unexecuted: readonly string[]
  readonly ok: boolean
}

const CLAIMABLE: ReadonlySet<CapabilityStatus> = new Set(['supported', 'limited'])

/** 矩陣裡 SQLite 欄（或任何一欄）目前宣告支援的 key。 */
export function declaredKeys(
  matrix: Readonly<Record<string, Readonly<{ status: CapabilityStatus }>>>
): CommandCapabilityKey[] {
  return Object.entries(matrix)
    .filter(([, entry]) => CLAIMABLE.has(entry.status))
    .map(([key]) => key as CommandCapabilityKey)
}

export interface ReconcileInput {
  readonly matrix:
    | EngineCapabilities
    | Readonly<Record<string, Readonly<{ status: CapabilityStatus }>>>
  readonly scenarios: readonly ScenarioClaim[]
  readonly executed: ReadonlySet<string>
}

export function reconcile({ matrix, scenarios, executed }: ReconcileInput): Reconciliation {
  const declared = new Set(declaredKeys(matrix))
  const proven = new Set<string>()
  const stale: StaleClaim[] = []
  const unexecuted: string[] = []

  for (const scenario of scenarios) {
    for (const key of scenario.proves) {
      if (!declared.has(key)) {
        const entry = (matrix as Record<string, { status: CapabilityStatus } | undefined>)[key]
        stale.push({ scenario: scenario.id, key, status: entry?.status ?? 'unknown' })
      }
    }
    if (!executed.has(scenario.id)) {
      unexecuted.push(scenario.id)
      continue
    }
    for (const key of scenario.proves) proven.add(key)
  }

  const missing = [...declared].filter((key) => !proven.has(key))
  return {
    missing,
    stale,
    unexecuted,
    ok: missing.length === 0 && stale.length === 0,
  }
}

/** 失敗訊息要指名項目，讀的人才知道該補哪一格、該刪哪一條。 */
export function formatReconciliation(result: Reconciliation): string {
  if (result.ok && result.unexecuted.length === 0)
    return 'every SQLite claim has an executed CLI scenario'
  const lines: string[] = []
  if (result.missing.length > 0) {
    lines.push(
      `declared for sqlite but no executed CLI scenario proves: ${result.missing.join(', ')}`
    )
  }
  for (const claim of result.stale) {
    lines.push(
      `scenario "${claim.scenario}" claims "${claim.key}", which the matrix does not declare for sqlite (status: ${claim.status})`
    )
  }
  if (result.unexecuted.length > 0) {
    lines.push(
      `registered but not executed, so contributing no evidence: ${result.unexecuted.join(', ')}`
    )
  }
  return lines.join('\n')
}
