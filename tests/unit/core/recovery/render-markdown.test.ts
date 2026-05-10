import { describe, test, expect } from 'bun:test'
import { renderMarkdown, renderCodeList } from '@/core/recovery/render-markdown'
import { renderApplyMarkdown } from '@/core/recovery/apply-render-markdown'
import type { RecoveryEnvelope } from '@/core/recovery/types'
import type { ApplyResult } from '@/core/recovery/apply-types'

const ENV: RecoveryEnvelope = {
  schemaVersion: 1,
  generatedAt: '2026-05-09T10:00:00.000Z',
  ok: false,
  error: {
    code: 'CONN_REFUSED',
    category: 'connection',
    message: 'Database refused the connection (server down or wrong host/port).',
    details: { connectionCode: 'ECONNREFUSED' },
  },
  recovery: [
    {
      order: 1,
      command: 'dbcli doctor --format json',
      rationale: 'Run the doctor health check.',
      risk: 'readonly',
      expects: 'JSON report.',
    },
    {
      order: 2,
      command: 'dbcli init --force',
      rationale: 'Re-run init wizard.',
      risk: 'write',
      expects: 'Init wizard accepts new values.',
    },
  ],
}

describe('renderMarkdown (recovery)', () => {
  test('contains all required sections', () => {
    const md = renderMarkdown(ENV)
    expect(md).toContain('# dbcli recovery: CONN_REFUSED')
    expect(md).toContain('## Error')
    expect(md).toContain('## Recovery')
    expect(md).toContain('1. `dbcli doctor --format json`')
    expect(md).toContain('2. `dbcli init --force`')
    expect(md).toContain('risk: `readonly`')
    expect(md).toContain('risk: `write`')
  })

  test('details block lists known fields', () => {
    const md = renderMarkdown(ENV)
    expect(md).toContain('connectionCode: `ECONNREFUSED`')
  })

  test('brief omits rationale and expects', () => {
    const md = renderMarkdown(ENV, { brief: true })
    expect(md).not.toContain('Run the doctor health check')
    expect(md).not.toContain('Re-run init wizard')
    expect(md).toContain('1. `dbcli doctor --format json`')
  })
})

describe('renderCodeList', () => {
  test('renders all recovery codes with category + description', () => {
    const md = renderCodeList()
    expect(md).toContain('# dbcli recovery codes')
    expect(md).toContain('`CONFIG_MISSING`')
    expect(md).toContain('`CONN_REFUSED`')
    expect(md).toContain('`PERMISSION_DENIED`')
    expect(md).toContain('`BLACKLIST_TABLE`')
    expect(md).toContain('`SNIPPET_NOT_FOUND`')
    expect(md).toContain('`SCHEMA_CACHE_MISSING`')
    expect(md).toContain('`UNKNOWN`')
  })
})

const envelopeWithVerify: RecoveryEnvelope = {
  schemaVersion: 1,
  generatedAt: '2026-05-10T11:30:00.000Z',
  ok: false,
  error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
  recovery: [
    {
      order: 1,
      command: 'dbcli inspect --for-agent',
      rationale: 'r',
      risk: 'readonly',
      expects: 'e',
    },
  ],
  verify: {
    order: 0,
    command: 'dbcli inspect --for-agent',
    rationale: 'verify',
    risk: 'readonly',
    expects: 'snapshot',
  },
}

describe('renderMarkdown — verify section', () => {
  test('renders ## Verification when env.verify is set', () => {
    const md = renderMarkdown(envelopeWithVerify)
    expect(md).toContain('## Verification')
    expect(md).toContain('`dbcli inspect --for-agent`')
  })

  test('omits Verification heading when env.verify is undefined', () => {
    const env: RecoveryEnvelope = { ...envelopeWithVerify }
    delete (env as Partial<RecoveryEnvelope>).verify
    const md = renderMarkdown(env)
    expect(md).not.toContain('## Verification')
  })
})

describe('renderApplyMarkdown — verification block', () => {
  const applyResult: ApplyResult = {
    schemaVersion: 1,
    startedAt: 'a',
    finishedAt: 'b',
    source: { kind: 'auto', path: '.dbcli/last-recovery.json' },
    envelope: envelopeWithVerify,
    results: [
      {
        order: 1,
        command: 'dbcli inspect --for-agent',
        status: 'ok',
        exitCode: 0,
        durationMs: 5,
        stdout: '',
        stderr: '',
        truncated: false,
      },
    ],
    finalStatus: 'ok',
    stoppedAt: null,
    verifyResult: {
      order: 0,
      command: 'dbcli inspect --for-agent',
      status: 'ok',
      exitCode: 0,
      durationMs: 4,
      stdout: '{}',
      stderr: '',
      truncated: false,
    },
    verifyStatus: 'passed',
  }

  test('renders Verification heading + verifyStatus + command', () => {
    const md = renderApplyMarkdown(applyResult)
    expect(md).toContain('## Verification')
    expect(md).toContain('verifyStatus: `passed`')
    expect(md).toContain('`dbcli inspect --for-agent`')
  })

  test('omits Verification block when verifyResult is absent', () => {
    const r: ApplyResult = { ...applyResult }
    delete r.verifyResult
    delete r.verifyStatus
    const md = renderApplyMarkdown(r)
    expect(md).not.toContain('## Verification')
  })
})
