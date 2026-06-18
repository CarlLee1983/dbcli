import type { StepResult, VerifyStatus } from '@/core/recovery/apply-types'
import type { VerificationStatus } from './types'

export const VERIFICATION_STATUSES = [
  'verified',
  'not_verified',
  'indeterminate',
  'blocked',
] as const satisfies readonly VerificationStatus[]

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return typeof value === 'string' && VERIFICATION_STATUSES.includes(value as VerificationStatus)
}

export function isSkippedStep(status: StepResult['status']): boolean {
  return status.startsWith('skipped:')
}

export function stepResultToBlockedReason(result: StepResult | undefined): string | undefined {
  if (!result || !isSkippedStep(result.status)) return undefined
  return result.reason ?? result.status
}

export function recoveryVerifyToVerificationStatus(
  status: VerifyStatus,
  result?: StepResult
): VerificationStatus {
  if (status === 'passed') return 'verified'
  if (status === 'failed') return 'not_verified'
  if (result && isSkippedStep(result.status)) return 'blocked'
  return 'indeterminate'
}
