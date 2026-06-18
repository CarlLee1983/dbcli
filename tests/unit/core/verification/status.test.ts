import { describe, expect, test } from 'bun:test'
import {
  isVerificationStatus,
  recoveryVerifyToVerificationStatus,
  stepResultToBlockedReason,
} from '@/core/verification'
import type { StepResult, VerifyStatus } from '@/core/recovery/apply-types'

const skipped = (status: StepResult['status'], reason?: string): StepResult => ({
  order: 0,
  command: 'dbcli schema <table> --format json',
  status,
  reason,
})

describe('verification status contract', () => {
  test('guards stable status vocabulary', () => {
    expect(isVerificationStatus('verified')).toBe(true)
    expect(isVerificationStatus('not_verified')).toBe(true)
    expect(isVerificationStatus('indeterminate')).toBe(true)
    expect(isVerificationStatus('blocked')).toBe(true)
    expect(isVerificationStatus('passed')).toBe(false)
  })

  test.each([
    ['passed', 'verified'],
    ['failed', 'not_verified'],
    ['indeterminate', 'indeterminate'],
  ] as Array<[VerifyStatus, string]>)('maps recovery %s to %s', (input, expected) => {
    expect(recoveryVerifyToVerificationStatus(input)).toBe(expected)
  })

  test('maps skipped recovery verifier to blocked', () => {
    expect(
      recoveryVerifyToVerificationStatus(
        'indeterminate',
        skipped('skipped:placeholder', 'missing table')
      )
    ).toBe('blocked')
  })

  test('derives blocked reason from skipped step', () => {
    expect(stepResultToBlockedReason(skipped('skipped:unsafe-command', 'not allowlisted'))).toBe(
      'not allowlisted'
    )
  })

  test('falls back to status string when skipped step has no reason', () => {
    expect(stepResultToBlockedReason(skipped('skipped:placeholder'))).toBe('skipped:placeholder')
  })
})
