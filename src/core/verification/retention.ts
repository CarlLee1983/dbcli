import type {
  VerificationStatus,
  VerificationSubject,
  VerificationSubjectKind,
} from './types'
import {
  filterVerificationArtifacts,
  type ReadVerificationArtifactsResult,
} from './reader'

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

/**
 * Compute the prune plan from already-read artifacts. Pure: no filesystem access.
 * `read.artifacts` must be latest-first (the reader guarantees this).
 * `invalidMtimes` maps an invalid record's path to its file mtime in epoch-ms;
 * it is only consulted when `criteria.includeInvalid` is set.
 */
export function selectPrunePlan(
  read: ReadVerificationArtifactsResult,
  criteria: PruneCriteria,
  cutoffMs: number,
  invalidMtimes: ReadonlyMap<string, number>
): PrunePlan {
  const keep = Math.max(0, criteria.keepLatest)

  const protectedRecords: PruneProtected[] = read.artifacts.slice(0, keep).map((r) => ({
    path: r.path,
    filename: r.filename,
    id: r.artifact.id,
    reason: 'keep-latest',
  }))

  const eligible = read.artifacts.slice(keep)
  const matched = filterVerificationArtifacts(eligible, {
    status: criteria.status,
    subject: criteria.subject,
  })
  const validCandidates: PruneCandidate[] = matched
    .filter((r) => Date.parse(r.artifact.createdAt) < cutoffMs)
    .map((r) => ({
      path: r.path,
      filename: r.filename,
      id: r.artifact.id,
      createdAt: r.artifact.createdAt,
      status: r.artifact.status,
      subject: r.artifact.subject,
      invalid: false,
    }))

  const invalidCandidates: PruneCandidate[] = criteria.includeInvalid
    ? read.invalid
        .filter((r) => {
          const m = invalidMtimes.get(r.path)
          return m !== undefined && m < cutoffMs
        })
        .map((r) => ({
          path: r.path,
          filename: r.filename,
          id: null,
          createdAt: null,
          status: null,
          subject: null,
          invalid: true,
        }))
    : []

  return { protected: protectedRecords, candidates: [...validCandidates, ...invalidCandidates] }
}
