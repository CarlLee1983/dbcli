import { describe, test, expect } from 'bun:test'
import { renderMarkdown, renderCodeList } from '@/core/recovery/render-markdown'
import type { RecoveryEnvelope } from '@/core/recovery/types'

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
