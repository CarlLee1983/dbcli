export const VERIFICATION_ARTIFACT_SCHEMA_VERSION = 1 as const

export type VerificationStatus = 'verified' | 'not_verified' | 'indeterminate' | 'blocked'

export type VerificationEvidenceKind =
  | 'assert'
  | 'snapshot'
  | 'recovery-verify'
  | 'task-pack-plan'
  | 'manual'

export type VerificationSubjectKind =
  | 'recovery'
  | 'task-pack'
  | 'assertion'
  | 'migration'
  | 'backfill'
  | 'manual'

export interface VerificationEvidenceRef {
  kind: VerificationEvidenceKind
  command?: string
  exitCode?: number
  auditRef?: string
  recoveryRef?: string
  snapshotPath?: string
  taskName?: string
  step?: number
  note?: string
}

export interface VerificationSubject {
  kind: VerificationSubjectKind
  name?: string
  command?: string
}

export interface VerificationArtifact {
  schemaVersion: typeof VERIFICATION_ARTIFACT_SCHEMA_VERSION
  id: string
  createdAt: string
  status: VerificationStatus
  subject: VerificationSubject
  summary: string
  evidence: VerificationEvidenceRef[]
  blockedReason?: string
}
