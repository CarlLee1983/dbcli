import { describe, test, expect } from 'bun:test'
import { renderNextJson } from '@/core/recovery/next-render-json'
import { renderNextMarkdown } from '@/core/recovery/next-render-markdown'
import type { NextResult } from '@/core/recovery/next-types'

const stepResult: NextResult = {
  schemaVersion: 1,
  kind: 'step',
  source: { kind: 'auto', path: '.dbcli/last-recovery.json' },
  errorCode: 'BLACKLIST_TABLE',
  cursor: 2,
  totalSteps: 3,
  step: {
    order: 2,
    command: 'dbcli inspect --for-agent',
    rationale: 'Confirm permission/blacklist context.',
    risk: 'readonly',
    expects: 'Brief JSON snapshot.',
  },
}

const doneResult: NextResult = {
  schemaVersion: 1,
  kind: 'done',
  source: { kind: 'from', path: '/tmp/env.json' },
  errorCode: 'BLACKLIST_TABLE',
  cursor: 3,
  totalSteps: 3,
}

describe('renderNextJson', () => {
  test('renders kind:step with step body', () => {
    const out = renderNextJson(stepResult)
    const parsed = JSON.parse(out)
    expect(parsed.kind).toBe('step')
    expect(parsed.cursor).toBe(2)
    expect(parsed.totalSteps).toBe(3)
    expect(parsed.step.command).toBe('dbcli inspect --for-agent')
  })

  test('renders kind:done without step body', () => {
    const out = renderNextJson(doneResult)
    const parsed = JSON.parse(out)
    expect(parsed.kind).toBe('done')
    expect(parsed.step).toBeUndefined()
  })
})

describe('renderNextMarkdown', () => {
  test('renders Next step heading + command + cursor', () => {
    const md = renderNextMarkdown(stepResult)
    expect(md).toContain('# dbcli recover --next')
    expect(md).toContain('## Next step (2 of 3)')
    expect(md).toContain('`dbcli inspect --for-agent`')
    expect(md).toContain('errorCode: `BLACKLIST_TABLE`')
  })

  test('renders Done block when kind === done', () => {
    const md = renderNextMarkdown(doneResult)
    expect(md).toContain('## Done')
    expect(md).toContain('All 3 steps consumed')
    expect(md).not.toContain('## Next step')
  })
})
