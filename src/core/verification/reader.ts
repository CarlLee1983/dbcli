import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  VerificationArtifact,
  VerificationStatus,
  VerificationSubject,
  VerificationSubjectKind,
} from './types'
import { VERIFICATION_ARTIFACT_SCHEMA_VERSION } from './types'
import { isVerificationStatus } from './status'
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
  const subject = v.subject as Record<string, unknown> | undefined
  if (!subject || !isVerificationSubjectKind(subject.kind)) {
    throw new Error('subject.kind is not a valid verification subject kind')
  }
  if (typeof v.summary !== 'string' || v.summary.length === 0) {
    throw new Error('summary must be a non-empty string')
  }
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) {
    throw new Error('evidence must be a non-empty array')
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

// Re-export type-only names used by later helpers in this file (Task 2).
export type { VerificationStatus, VerificationSubject, VerificationSubjectKind }
