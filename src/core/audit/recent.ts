/**
 * Phase 25 DOCS-02 / D-56..D-61: load recent audit entries for embed in
 * inspect / guide / recover / recover --apply JSON output.
 *
 * Single source of truth for the trigger condition and brief tailoring.
 * Read-only; never throws (errors → []).
 */
import { getAuditLogger } from './integration-helper'
import { readEntries, tailEntries } from './reader'
import type { AuditEntry, AuditEntryBrief } from './types'
import type { DbcliConfig } from '../../utils/validation'

/** Phase 25 D-58: hard-coded. NO --audit-n flag. */
export const RECENT_AUDIT_DEFAULT_N = 5

/**
 * Phase 25 D-57: only embed when output is agent-facing JSON.
 * --for-agent (= json + brief) OR explicit --format json.
 * Human markdown never gets audit_recent.
 */
export function shouldEmbedRecent(opts: { forAgent?: boolean; format: string }): boolean {
  return opts.forAgent === true || opts.format === 'json'
}

/**
 * 與 `src/commands/audit.ts` 的 `briefify` 是同一個決定的兩個實作點。
 *
 * `recover --format json` 與 `inspect --for-agent` 走這裡。少了 statement，
 * `DELETE /orders` 與 `PUT /orders/_mapping` 在 agent 眼中是同一列；少了 phase，
 * 一次成功的請求呈現為兩列只差 `success` 的紀錄，其中 `success: false` 那列
 * 讀起來就是一次失敗——那正是 attempt 改成 `success: false` 想避免的誤讀，
 * 只是換到另一條輸出路徑。改動 `briefify` 時要一起改這裡。
 */
function briefifyForRecent(entry: AuditEntry): AuditEntryBrief {
  const phase = (entry.metadata as { es_shell_phase?: unknown } | undefined)?.es_shell_phase
  return {
    id: entry.id,
    ts: entry.ts,
    command: entry.command,
    target: entry.target,
    success: entry.success,
    ...(entry.redacted_sql !== undefined && { redacted_sql: entry.redacted_sql }),
    ...(phase !== undefined && { phase }),
  }
}

/**
 * Phase 25 D-60: disabled / empty / unavailable / corrupted ALL return [].
 * Phase 25 H: current connection only, include_rotated: true (consistent with
 * Phase 24 audit show --recovery-ref behavior).
 */
export async function loadRecentAudit(
  config: DbcliConfig,
  configPath: string,
  n: number = RECENT_AUDIT_DEFAULT_N
): Promise<AuditEntryBrief[]> {
  try {
    if (config.audit?.enabled === false) return []
    const logger = await getAuditLogger(config, configPath)
    const auditFile = logger.getHealth().currentFile
    const entries = await readEntries(auditFile, { include_rotated: true })
    return tailEntries(entries, n).map(briefifyForRecent)
  } catch {
    return []
  }
}
