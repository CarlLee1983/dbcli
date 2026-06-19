import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, isAbsolute, resolve, sep } from 'node:path'
import type {
  VerificationArtifact,
  VerificationEvidenceRef,
  VerificationStatus,
  VerificationSubject,
  VerificationSubjectKind,
} from './types'
import { VERIFICATION_ARTIFACT_SCHEMA_VERSION } from './types'
import { isVerificationStatus } from './status'
import { isVerificationEvidenceKind } from './evidence'
import { isVerificationSubjectKind } from './assert-artifact'
import { VERIFICATION_DIR_RELATIVE } from './artifact-writer'

/** Max length of a bounded single-line invalid-file error message. */
export const INVALID_ERROR_MAX = 200

export interface VerificationArtifactRecord {
  path: string
  filename: string
  artifact: VerificationArtifact
}

export interface InvalidVerificationArtifactRecord {
  path: string
  filename: string
  error: string
}

export interface ReadVerificationArtifactsResult {
  storageDir: string
  artifacts: VerificationArtifactRecord[]
  invalid: InvalidVerificationArtifactRecord[]
}

/** Only files named `verification-<...>.json` are considered. */
function isArtifactFilename(name: string): boolean {
  return /^verification-.*\.json$/.test(name)
}

/** Collapse any error into one short single-line message. */
function boundError(message: string): string {
  const single = message.replace(/\s+/g, ' ').trim()
  return single.length <= INVALID_ERROR_MAX ? single : single.slice(0, INVALID_ERROR_MAX - 1) + '…'
}

/** Validate the `subject` field of a v1 artifact. Throws on the first failure. */
function validateSubject(value: unknown): VerificationSubject {
  if (typeof value !== 'object' || value === null) {
    throw new Error('subject must be an object')
  }
  const s = value as Record<string, unknown>
  if (!isVerificationSubjectKind(s.kind)) {
    throw new Error('subject.kind is not a valid verification subject kind')
  }
  if (s.name !== undefined && typeof s.name !== 'string') {
    throw new Error('subject.name must be a string when present')
  }
  if (s.command !== undefined && typeof s.command !== 'string') {
    throw new Error('subject.command must be a string when present')
  }
  return value as VerificationSubject
}

/** Validate one `evidence` array element of a v1 artifact. Throws on the first failure. */
function validateEvidence(value: unknown, index: number): VerificationEvidenceRef {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`evidence[${index}] must be an object`)
  }
  const e = value as Record<string, unknown>
  if (!isVerificationEvidenceKind(e.kind)) {
    throw new Error(`evidence[${index}].kind is not a valid evidence kind`)
  }
  const stringFields = [
    'command',
    'auditRef',
    'recoveryRef',
    'snapshotPath',
    'taskName',
    'note',
  ] as const
  for (const field of stringFields) {
    if (e[field] !== undefined && typeof e[field] !== 'string') {
      throw new Error(`evidence[${index}].${field} must be a string when present`)
    }
  }
  const numberFields = ['exitCode', 'step'] as const
  for (const field of numberFields) {
    if (e[field] !== undefined && typeof e[field] !== 'number') {
      throw new Error(`evidence[${index}].${field} must be a number when present`)
    }
  }
  return value as VerificationEvidenceRef
}

/**
 * Validate an unknown parsed value as a v1 VerificationArtifact.
 * Throws Error with a short message on the first failure.
 */
export function validateVerificationArtifact(value: unknown): VerificationArtifact {
  if (typeof value !== 'object' || value === null) {
    throw new Error('artifact is not a JSON object')
  }
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== VERIFICATION_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${VERIFICATION_ARTIFACT_SCHEMA_VERSION}`)
  }
  if (typeof v.id !== 'string' || v.id.length === 0) {
    throw new Error('id must be a non-empty string')
  }
  if (typeof v.createdAt !== 'string' || Number.isNaN(Date.parse(v.createdAt))) {
    throw new Error('createdAt must be an ISO date string')
  }
  if (!isVerificationStatus(v.status)) {
    throw new Error(`status '${String(v.status)}' is not a valid verification status`)
  }
  validateSubject(v.subject)
  if (typeof v.summary !== 'string' || v.summary.length === 0) {
    throw new Error('summary must be a non-empty string')
  }
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) {
    throw new Error('evidence must be a non-empty array')
  }
  v.evidence.forEach((item, index) => validateEvidence(item, index))
  if (v.blockedReason !== undefined && typeof v.blockedReason !== 'string') {
    throw new Error('blockedReason must be a string when present')
  }
  return value as VerificationArtifact
}

/**
 * Read and validate every `verification-*.json` under `<storageRoot>/.dbcli/verification/`.
 * Missing directory yields an empty result (never throws). Malformed files are
 * collected as bounded invalid records; valid artifacts are sorted createdAt
 * descending, then filename ascending for deterministic ties.
 */
export async function readVerificationArtifacts(
  storageRoot: string
): Promise<ReadVerificationArtifactsResult> {
  const storageDir = join(storageRoot, VERIFICATION_DIR_RELATIVE)

  let names: string[]
  try {
    names = await readdir(storageDir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { storageDir, artifacts: [], invalid: [] }
    }
    throw e
  }

  const artifacts: VerificationArtifactRecord[] = []
  const invalid: InvalidVerificationArtifactRecord[] = []

  for (const filename of names.filter(isArtifactFilename)) {
    const path = join(storageDir, filename)
    try {
      const stats = await lstat(path)
      if (!stats.isFile()) {
        throw new Error('artifact path is not a regular file')
      }
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const artifact = validateVerificationArtifact(parsed)
      artifacts.push({ path, filename, artifact })
    } catch (e) {
      invalid.push({ path, filename, error: boundError((e as Error).message) })
    }
  }

  artifacts.sort((a, b) => {
    if (a.artifact.createdAt !== b.artifact.createdAt) {
      return a.artifact.createdAt < b.artifact.createdAt ? 1 : -1
    }
    return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0
  })

  return { storageDir, artifacts, invalid }
}

export interface VerificationArtifactFilters {
  status?: VerificationStatus
  subject?: { kind: VerificationSubjectKind; name?: string }
}

export interface VerificationArtifactSummary {
  storageDir: string
  latest: {
    path: string
    id: string
    createdAt: string
    status: VerificationStatus
    subject: VerificationSubject
    summary: string
  } | null
  counts: {
    total: number
    verified: number
    not_verified: number
    indeterminate: number
    blocked: number
    invalid: number
  }
  subjects: Array<{
    subject: VerificationSubject
    total: number
    latestStatus: VerificationStatus
    latestCreatedAt: string
  }>
}

/** Thrown when a `show` selector matches zero, many, or an out-of-bounds artifact. */
export class VerificationArtifactSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationArtifactSelectionError'
    Object.setPrototypeOf(this, VerificationArtifactSelectionError.prototype)
  }
}

export function filterVerificationArtifacts(
  artifacts: VerificationArtifactRecord[],
  filters: VerificationArtifactFilters
): VerificationArtifactRecord[] {
  return artifacts.filter((r) => {
    if (filters.status && r.artifact.status !== filters.status) return false
    if (filters.subject) {
      if (r.artifact.subject.kind !== filters.subject.kind) return false
      if (filters.subject.name !== undefined && r.artifact.subject.name !== filters.subject.name) {
        return false
      }
    }
    return true
  })
}

export function summarizeVerificationArtifacts(
  input: ReadVerificationArtifactsResult,
  filters?: VerificationArtifactFilters
): VerificationArtifactSummary {
  const matched = filters ? filterVerificationArtifacts(input.artifacts, filters) : input.artifacts

  const counts = {
    total: matched.length,
    verified: 0,
    not_verified: 0,
    indeterminate: 0,
    blocked: 0,
    invalid: input.invalid.length,
  }
  for (const r of matched) counts[r.artifact.status] += 1

  // matched preserves the reader's latest-first order, so index 0 is the latest.
  const head = matched[0]
  const latest = head
    ? {
        path: head.path,
        id: head.artifact.id,
        createdAt: head.artifact.createdAt,
        status: head.artifact.status,
        subject: head.artifact.subject,
        summary: head.artifact.summary,
      }
    : null

  const bySubject = new Map<string, VerificationArtifactSummary['subjects'][number]>()
  for (const r of matched) {
    const { subject } = r.artifact
    const key = `${subject.kind}::${subject.name ?? ''}`
    const existing = bySubject.get(key)
    if (!existing) {
      // First seen is the latest for this subject (matched is latest-first).
      bySubject.set(key, {
        subject,
        total: 1,
        latestStatus: r.artifact.status,
        latestCreatedAt: r.artifact.createdAt,
      })
    } else {
      existing.total += 1
    }
  }
  const subjects = Array.from(bySubject.values()).sort((a, b) =>
    a.latestCreatedAt < b.latestCreatedAt ? 1 : a.latestCreatedAt > b.latestCreatedAt ? -1 : 0
  )

  return { storageDir: input.storageDir, latest, counts, subjects }
}

/** A selector is treated as a filesystem path when it contains a path separator. */
function looksLikePath(selector: string): boolean {
  return selector.includes('/') || selector.includes('\\') || isAbsolute(selector)
}

export function findVerificationArtifact(
  input: ReadVerificationArtifactsResult,
  selector: string
): VerificationArtifactRecord {
  if (looksLikePath(selector)) {
    const resolved = resolve(selector)
    const root = input.storageDir
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new VerificationArtifactSelectionError(
        `Path is outside the verification directory: ${resolved}`
      )
    }
    const hit = input.artifacts.find((r) => r.path === resolved)
    if (hit) return hit
    const bad = input.invalid.find((r) => r.path === resolved)
    if (bad) {
      throw new VerificationArtifactSelectionError(
        `Artifact at ${bad.filename} is invalid: ${bad.error}`
      )
    }
    throw new VerificationArtifactSelectionError(`No artifact found at path: ${resolved}`)
  }

  const exact = input.artifacts.filter((r) => r.artifact.id === selector)
  if (exact.length === 1) return exact[0]!

  const prefix = input.artifacts.filter((r) => r.artifact.id.startsWith(selector))
  if (prefix.length === 1) return prefix[0]!
  if (prefix.length > 1) {
    const candidates = prefix
      .slice(0, 10)
      .map((r) => r.artifact.id)
      .join(', ')
    throw new VerificationArtifactSelectionError(
      `Selector '${selector}' is ambiguous. Candidates: ${candidates}`
    )
  }

  const byName = input.artifacts.filter((r) => r.filename === selector)
  if (byName.length === 1) return byName[0]!

  throw new VerificationArtifactSelectionError(`No artifact matches selector '${selector}'`)
}
