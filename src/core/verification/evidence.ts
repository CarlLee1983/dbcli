import type { VerificationEvidenceKind } from './types'

/** Runtime list of allowed evidence kinds — mirrors VerificationEvidenceKind in types.ts. */
export const VERIFICATION_EVIDENCE_KINDS = [
  'assert',
  'snapshot',
  'recovery-verify',
  'task-pack-plan',
  'manual',
] as const satisfies readonly VerificationEvidenceKind[]

export function isVerificationEvidenceKind(value: unknown): value is VerificationEvidenceKind {
  return (
    typeof value === 'string' && (VERIFICATION_EVIDENCE_KINDS as readonly string[]).includes(value)
  )
}
