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
import { isTransientAuditFailure, runAuditGate, runAuditWithRetry } from '../../../scripts/audit'

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

/** A gate run against canned exemptions text, recording what `bun audit` was asked and what was printed. */
async function gate(
  exemptionsText: string | null,
  result: { exitCode: number; output: string } = { exitCode: 0, output: 'no vulnerabilities found' }
) {
  const calls: string[][] = []
  const lines: string[] = []
  const exitCode = await runAuditGate({
    exemptionsText,
    today: '2026-10-05',
    run: async (args) => {
      calls.push(args)
      return result
    },
    attempts: 3,
    wait: noWait,
    report: (line) => lines.push(line),
  })
  return { exitCode, calls, lines }
}

const entry = {
  id: 'GHSA-vfj7-8cjw-p6xm',
  package: 'braces',
  reason: 'build-time only',
  expires: '2026-11-30',
}

describe('runAuditGate exemptions', () => {
  test('an unexpired entry becomes an --ignore argument and is disclosed', async () => {
    const { exitCode, calls, lines } = await gate(JSON.stringify([entry]))
    expect(exitCode).toBe(0)
    expect(calls).toEqual([['--ignore=GHSA-vfj7-8cjw-p6xm']])
    const disclosure = lines.join('\n')
    expect(disclosure).toContain('GHSA-vfj7-8cjw-p6xm')
    expect(disclosure).toContain('braces')
    expect(disclosure).toContain('2026-11-30')
  })

  test('an entry is still valid on its expiry date', async () => {
    const { calls } = await gate(JSON.stringify([{ ...entry, expires: '2026-10-05' }]))
    expect(calls).toEqual([['--ignore=GHSA-vfj7-8cjw-p6xm']])
  })

  test('an expired entry fails without running the audit, naming the advisory and date', async () => {
    const { exitCode, calls, lines } = await gate(
      JSON.stringify([{ ...entry, expires: '2026-10-04' }])
    )
    expect(exitCode).not.toBe(0)
    expect(calls).toEqual([])
    const message = lines.join('\n')
    expect(message).toContain('GHSA-vfj7-8cjw-p6xm')
    expect(message).toContain('2026-10-04')
  })

  test('a missing exemptions file runs the audit with no --ignore', async () => {
    const { exitCode, calls } = await gate(null)
    expect(exitCode).toBe(0)
    expect(calls).toEqual([[]])
  })

  test('an empty exemptions file runs the audit with no --ignore', async () => {
    expect((await gate('')).calls).toEqual([[]])
    expect((await gate('  \n')).calls).toEqual([[]])
    expect((await gate('[]')).calls).toEqual([[]])
  })

  test.each(['id', 'package', 'reason', 'expires'])(
    'an entry missing %s fails, naming the problem',
    async (field) => {
      const broken: Record<string, string> = { ...entry }
      delete broken[field]
      const { exitCode, calls, lines } = await gate(JSON.stringify([broken]))
      expect(exitCode).not.toBe(0)
      expect(calls).toEqual([])
      expect(lines.join('\n')).toContain(`0.${field}:`)
    }
  )

  test.each(['2026-11-3', '30/11/2026', '2026-02-30', '2026-13-01', '2026-00-10', 'soon'])(
    'an expires of %s is not a YYYY-MM-DD date and fails',
    async (expires) => {
      const { exitCode, calls, lines } = await gate(JSON.stringify([{ ...entry, expires }]))
      expect(exitCode).not.toBe(0)
      expect(calls).toEqual([])
      expect(lines.join('\n')).toContain('0.expires:')
    }
  )

  test.each(['1234', 'GHSA-aaaa-bbbb-cccc', 'ghsa-vfj7-8cjw-p6xm'])(
    'an id of %s is not a GHSA id and fails',
    async (id) => {
      const { exitCode, calls, lines } = await gate(JSON.stringify([{ ...entry, id }]))
      expect(exitCode).not.toBe(0)
      expect(calls).toEqual([])
      expect(lines.join('\n')).toContain('0.id:')
    }
  )

  test('an unknown field is rejected as a likely typo', async () => {
    const { exitCode, calls } = await gate(JSON.stringify([{ ...entry, expiry: '2027-01-01' }]))
    expect(exitCode).not.toBe(0)
    expect(calls).toEqual([])
  })

  test('the same id listed twice fails, naming it', async () => {
    const { exitCode, calls, lines } = await gate(JSON.stringify([entry, entry]))
    expect(exitCode).not.toBe(0)
    expect(calls).toEqual([])
    expect(lines.join('\n')).toContain('GHSA-vfj7-8cjw-p6xm more than once')
  })

  test('malformed JSON fails rather than auditing without the exemptions', async () => {
    const { exitCode, calls } = await gate('{not json')
    expect(exitCode).not.toBe(0)
    expect(calls).toEqual([])
  })

  test('an advisory that is not exempted still fails the audit', async () => {
    // The run is honest about its args: it only reports clean when the advisory
    // in its output was passed to --ignore, so a different GHSA must not pass.
    const other = 'GHSA-2222-3333-4444'
    const calls: string[][] = []
    const exitCode = await runAuditGate({
      exemptionsText: JSON.stringify([entry]),
      today: '2026-10-05',
      run: async (args) => {
        calls.push(args)
        return args.includes(`--ignore=${other}`)
          ? { exitCode: 0, output: 'no vulnerabilities found' }
          : { exitCode: 1, output: `high: other - https://github.com/advisories/${other}` }
      },
      attempts: 3,
      wait: noWait,
      report: () => {},
    })
    expect(exitCode).toBe(1)
    expect(calls).toEqual([['--ignore=GHSA-vfj7-8cjw-p6xm']])
  })
})
