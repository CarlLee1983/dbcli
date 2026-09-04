/**
 * The audit gate must separate two failures that `bun audit` reports the same
 * way — exit code 1.
 *
 * A published advisory is the signal the job exists for and must stay red on
 * the first attempt. A 503 from the npm advisory endpoint is the registry
 * being unavailable, says nothing about this repository's dependencies, and
 * turned `main` red on 2026-09-04 while nothing had changed. Only the second
 * is retried, and exhausting the retries still fails: an audit that could not
 * run is not an audit that passed.
 */

import { describe, test, expect } from 'bun:test'
import { isTransientAuditFailure, runAuditWithRetry } from '../../../scripts/audit'

describe('isTransientAuditFailure', () => {
  test('a 5xx from the advisory endpoint is transient', () => {
    const output = 'error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - 503'
    expect(isTransientAuditFailure(output)).toBe(true)
  })

  test('a rate-limited request is transient', () => {
    expect(isTransientAuditFailure('error: POST https://registry.npmjs.org/-/npm/v1/x - 429')).toBe(
      true
    )
  })

  test('a connection-level error is transient', () => {
    expect(isTransientAuditFailure('error: ConnectionRefused: Unable to connect')).toBe(true)
    expect(isTransientAuditFailure('error: fetch failed')).toBe(true)
  })

  test('a real advisory is not transient', () => {
    // The failure the job exists for. Retrying it would only delay the report.
    const output = [
      'bun audit v1.4.0',
      '',
      'lodash  <4.17.21',
      'Prototype Pollution - https://github.com/advisories/GHSA-1234',
      '',
      '1 vulnerability (1 high)',
    ].join('\n')
    expect(isTransientAuditFailure(output)).toBe(false)
  })

  test('a 4xx that is not rate limiting is not transient', () => {
    expect(isTransientAuditFailure('error: POST https://registry.npmjs.org/-/npm/v1/x - 404')).toBe(
      false
    )
  })
})

/** A scripted `bun audit` that hands back one canned result per attempt. */
function scripted(results: Array<{ exitCode: number; output: string }>) {
  const attempts: number[] = []
  return {
    attempts,
    run: async () => {
      attempts.push(attempts.length + 1)
      return results[attempts.length - 1] ?? results[results.length - 1]!
    },
  }
}

const noWait = async () => {}

describe('runAuditWithRetry', () => {
  test('a clean audit runs once', async () => {
    const audit = scripted([{ exitCode: 0, output: 'no vulnerabilities found' }])
    expect(await runAuditWithRetry({ run: audit.run, attempts: 3, wait: noWait })).toBe(0)
    expect(audit.attempts.length).toBe(1)
  })

  test('an advisory fails on the first attempt without retrying', async () => {
    const audit = scripted([{ exitCode: 1, output: '1 vulnerability (1 high)' }])
    expect(await runAuditWithRetry({ run: audit.run, attempts: 3, wait: noWait })).toBe(1)
    expect(audit.attempts.length).toBe(1)
  })

  test('a registry outage is retried and the later success is the result', async () => {
    const audit = scripted([
      { exitCode: 1, output: 'error: POST https://registry.npmjs.org/x - 503' },
      { exitCode: 0, output: 'no vulnerabilities found' },
    ])
    expect(await runAuditWithRetry({ run: audit.run, attempts: 3, wait: noWait })).toBe(0)
    expect(audit.attempts.length).toBe(2)
  })

  test('an outage that outlasts the retries still fails', async () => {
    // Fail closed. Reporting green for an audit that never reached the registry
    // would make the job say something it does not know.
    const audit = scripted([
      { exitCode: 1, output: 'error: POST https://registry.npmjs.org/x - 503' },
    ])
    expect(await runAuditWithRetry({ run: audit.run, attempts: 3, wait: noWait })).toBe(1)
    expect(audit.attempts.length).toBe(3)
  })

  test('an advisory found after a retry is reported, not swallowed', async () => {
    const audit = scripted([
      { exitCode: 1, output: 'error: POST https://registry.npmjs.org/x - 503' },
      { exitCode: 1, output: '2 vulnerabilities (1 high, 1 low)' },
    ])
    expect(await runAuditWithRetry({ run: audit.run, attempts: 3, wait: noWait })).toBe(1)
    expect(audit.attempts.length).toBe(2)
  })
})
