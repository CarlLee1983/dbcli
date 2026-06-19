import { lstat, unlink } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import type {
  VerificationStatus,
  VerificationSubject,
  VerificationSubjectKind,
} from './types'
import {
  readVerificationArtifacts,
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

/** Bound any single-line error message to a short, log-safe length. */
function boundError(message: string): string {
  const single = message.replace(/\s+/g, ' ').trim()
  return single.length <= 200 ? single : single.slice(0, 199) + '…'
}

/** True when `candidatePath` resolves to a location inside `storageDir`. */
export function isInsideStorageDir(storageDir: string, candidatePath: string): boolean {
  const resolved = resolve(candidatePath)
  return resolved === storageDir || resolved.startsWith(storageDir + sep)
}

/** True when the basename matches the `verification-*.json` artifact pattern. */
export function hasArtifactFilename(candidatePath: string): boolean {
  return /^verification-.*\.json$/.test(basename(candidatePath))
}

/**
 * Delete one candidate behind time-of-use safety guards. Never follows symlinks
 * (uses lstat) and never deletes anything but a regular `verification-*.json`
 * file inside the storage dir. Returns a skip reason instead of throwing.
 */
async function safeDeleteCandidate(
  storageDir: string,
  candidate: PruneCandidate
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resolved = resolve(candidate.path)
  if (!isInsideStorageDir(storageDir, resolved)) return { ok: false, reason: 'outside-storage-dir' }
  if (!hasArtifactFilename(resolved)) return { ok: false, reason: 'filename-mismatch' }

  let stats
  try {
    stats = await lstat(resolved)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'missing' }
    return { ok: false, reason: boundError((e as Error).message) }
  }
  if (!stats.isFile()) return { ok: false, reason: 'not-regular-file' }

  try {
    await unlink(resolved)
    return { ok: true }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'missing' }
    return { ok: false, reason: boundError((e as Error).message) }
  }
}

/**
 * Preview (dry-run) or delete local verification artifacts by retention criteria.
 * Deletion only happens when `options.execute` is true; the CLI is responsible
 * for enforcing the `--execute`/`--force` double guard before setting it.
 */
export async function pruneVerificationArtifacts(
  storageRoot: string,
  criteria: PruneCriteria,
  options: PruneOptions
): Promise<PruneResult> {
  const nowMs = options.nowMs ?? Date.now()
  const cutoffMs = computeCutoffMs(nowMs, criteria.olderThanDays)
  const cutoff = new Date(cutoffMs).toISOString()

  const read = await readVerificationArtifacts(storageRoot)

  const invalidMtimes = new Map<string, number>()
  if (criteria.includeInvalid) {
    for (const r of read.invalid) {
      try {
        const stats = await lstat(r.path)
        invalidMtimes.set(r.path, stats.mtimeMs)
      } catch {
        // Unreadable invalid file: leave it out so it can never be selected.
      }
    }
  }

  const plan = selectPrunePlan(read, criteria, cutoffMs, invalidMtimes)

  const resultCriteria: PruneResult['criteria'] = {
    olderThanDays: criteria.olderThanDays,
    keepLatest: criteria.keepLatest,
    includeInvalid: criteria.includeInvalid,
    ...(criteria.status ? { status: criteria.status } : {}),
    ...(criteria.subject ? { subject: criteria.subject } : {}),
  }

  if (!options.execute) {
    return {
      storageDir: read.storageDir,
      dryRun: true,
      cutoff,
      criteria: resultCriteria,
      protected: plan.protected,
      candidates: plan.candidates,
      deleted: [],
      skipped: [],
    }
  }

  const deleted: PruneDeleted[] = []
  const skipped: PruneSkipped[] = []
  for (const candidate of plan.candidates) {
    const outcome = await safeDeleteCandidate(read.storageDir, candidate)
    if (outcome.ok) {
      deleted.push({ path: candidate.path, filename: candidate.filename, id: candidate.id })
    } else {
      skipped.push({
        path: candidate.path,
        filename: candidate.filename,
        id: candidate.id,
        reason: outcome.reason,
      })
    }
  }

  return {
    storageDir: read.storageDir,
    dryRun: false,
    cutoff,
    criteria: resultCriteria,
    protected: plan.protected,
    candidates: [],
    deleted,
    skipped,
  }
}
