import type { InspectSnapshot } from '@/core/inspect/types'

/** Stable contract version for ReportSnapshot JSON. Bump on breaking shape change. */
export const REPORT_SCHEMA_VERSION = 1 as const

export const ALLOWED_SECTIONS = ['health', 'capacity', 'perf'] as const
export type ReportSectionId = (typeof ALLOWED_SECTIONS)[number]

export type EvidenceStatus = 'ok' | 'no-data' | 'skipped' | 'error' | 'timeout'

export type Severity = 'info' | 'warn' | 'error'

export interface ReportFinding {
  /** Snippet key, e.g. `@diag/db-size`. */
  snippet: string
  /** Snippet `intent` taxonomy slot, e.g. `capacity.size`. */
  intent: string
  /** Snippet description from frontmatter (no secrets). */
  description: string
  /** True row count returned by adapter (before truncation). */
  rowCount: number
  /** Sample rows up to `maxRowsPerEvidence`. Empty when `status !== 'ok'`. */
  rows: Array<Record<string, unknown>>
  status: EvidenceStatus
  /** Human-readable explanation when status is not 'ok'. */
  reason?: string
  durationMs: number
}

export interface ReportSection {
  id: ReportSectionId
  evidence: ReportFinding[]
}

export interface ReportWarning {
  severity: Severity
  message: string
  /** Optional source: 'config' | 'connect' | 'snippets' | 'inspect' | `snippet:<key>`. */
  source?: string
}

export interface ReportSnapshot {
  schemaVersion: typeof REPORT_SCHEMA_VERSION
  /** ISO-8601 UTC timestamp at snapshot start (e.g. "2026-05-09T10:00:00.000Z"). */
  generatedAt: string
  /** Reused inspect snapshot for environment context. */
  context: InspectSnapshot
  sections: ReportSection[]
  warnings: ReportWarning[]
  /** Deterministic next-step commands. */
  suggestedCommands: string[]
}

export interface ReportOptions {
  workspace: string
  configPath: string
  /** Subset of allowed sections; defaults to all three. */
  sections?: readonly ReportSectionId[]
  /** Skip diagnostics + inspect probe; emit context-only snapshot. */
  noConnect?: boolean
  brief?: boolean
  /** Hard timeout for each diagnostic snippet (default 3000). */
  perSnippetTimeoutMs?: number
  /** Max rows kept per evidence (default 50). */
  maxRowsPerEvidence?: number
  /** Inspect's own probe timeout; passed through (default 1500). */
  probeTimeoutMs?: number
}
