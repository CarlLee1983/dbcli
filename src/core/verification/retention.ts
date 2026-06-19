import type {
  VerificationStatus,
  VerificationSubject,
  VerificationSubjectKind,
} from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface PruneCriteria {
  olderThanDays: number
  keepLatest: number
  status?: VerificationStatus
  subject?: { kind: VerificationSubjectKind; name?: string }
  includeInvalid: boolean
}

export interface PruneProtected {
  path: string
  filename: string
  id: string
  reason: 'keep-latest'
}

export interface PruneCandidate {
  path: string
  filename: string
  id: string | null
  createdAt: string | null
  status: VerificationStatus | null
  subject: VerificationSubject | null
  invalid: boolean
}

export interface PruneDeleted {
  path: string
  filename: string
  id: string | null
}

export interface PruneSkipped {
  path: string
  filename: string
  id: string | null
  reason: string
}

export interface PrunePlan {
  protected: PruneProtected[]
  candidates: PruneCandidate[]
}

export interface PruneResult {
  storageDir: string
  dryRun: boolean
  cutoff: string
  criteria: {
    olderThanDays: number
    keepLatest: number
    status?: VerificationStatus
    subject?: { kind: VerificationSubjectKind; name?: string }
    includeInvalid: boolean
  }
  protected: PruneProtected[]
  candidates: PruneCandidate[]
  deleted: PruneDeleted[]
  skipped: PruneSkipped[]
}

export interface PruneOptions {
  execute: boolean
  nowMs?: number
}

/**
 * Parse an MVP retention duration: a positive whole number of days, e.g. `30d`.
 * Throws on anything else (`0d`, `1h`, `1.5d`, `30`, `forever`).
 */
export function parseOlderThanDays(raw: string): number {
  const match = /^(\d+)d$/.exec(raw)
  if (!match) {
    throw new Error(
      `Invalid --older-than '${raw}'. Use a positive whole-day duration like 7d, 30d, or 365d.`
    )
  }
  const days = parseInt(match[1]!, 10)
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(
      `Invalid --older-than '${raw}'. Days must be a positive integer (e.g. 7d, 30d, 365d).`
    )
  }
  return days
}

/** Cutoff epoch-ms = now - olderThanDays. Artifacts strictly older than this are eligible. */
export function computeCutoffMs(nowMs: number, olderThanDays: number): number {
  return nowMs - olderThanDays * MS_PER_DAY
}
