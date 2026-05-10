import { describe, test, expect, afterEach } from 'bun:test'
import {
  runVerifyStep,
  __setVerifyExecutorForTests,
  __resetVerifyExecutorForTests,
} from '@/core/recovery/apply-verify'
import type { GuideStep } from '@/core/guide/types'

const validVerifyStep: GuideStep = {
  order: 0,
  command: 'dbcli inspect --for-agent',
  rationale: '',
  risk: 'readonly',
  expects: '',
}

afterEach(() => {
  __resetVerifyExecutorForTests()
})

describe('runVerifyStep — gate skips → indeterminate', () => {
  test('placeholder in command → status: indeterminate, result: skipped:placeholder', async () => {
    const step: GuideStep = { ...validVerifyStep, command: 'dbcli schema <table> --format json' }
    const r = await runVerifyStep(step, {
      code: 'SCHEMA_CACHE_MISSING',
      cwd: '/tmp',
      env: process.env,
    })
    expect(r.status).toBe('indeterminate')
    expect(r.result.status).toBe('skipped:placeholder')
  })

  test('non-allowlisted command → status: indeterminate, result: skipped:unsafe-command', async () => {
    const step: GuideStep = { ...validVerifyStep, command: 'dbcli delete users --where id=1' }
    const r = await runVerifyStep(step, {
      code: 'BLACKLIST_TABLE',
      cwd: '/tmp',
      env: process.env,
    })
    expect(r.status).toBe('indeterminate')
    expect(r.result.status).toBe('skipped:unsafe-command')
  })
})

describe('runVerifyStep — exec dispatch', () => {
  test('exit 0 → passed (default heuristic for BLACKLIST_TABLE)', async () => {
    __setVerifyExecutorForTests(async () => ({
      exitCode: 0,
      stdout: '{}',
      stderr: '',
      durationMs: 5,
      truncated: false,
      timedOut: false,
    }))
    const r = await runVerifyStep(validVerifyStep, {
      code: 'BLACKLIST_TABLE',
      cwd: '/tmp',
      env: process.env,
    })
    expect(r.status).toBe('passed')
    expect(r.result.status).toBe('ok')
    expect(r.result.exitCode).toBe(0)
  })

  test('exit 1 → failed', async () => {
    __setVerifyExecutorForTests(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      durationMs: 5,
      truncated: false,
      timedOut: false,
    }))
    const r = await runVerifyStep(validVerifyStep, {
      code: 'BLACKLIST_TABLE',
      cwd: '/tmp',
      env: process.env,
    })
    expect(r.status).toBe('failed')
    expect(r.result.status).toBe('failed')
  })

  test('SCHEMA_CACHE_MISSING with available:true → passed', async () => {
    __setVerifyExecutorForTests(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ schemaCache: { available: true } }),
      stderr: '',
      durationMs: 3,
      truncated: false,
      timedOut: false,
    }))
    const step: GuideStep = { ...validVerifyStep, command: 'dbcli inspect --format json' }
    const r = await runVerifyStep(step, {
      code: 'SCHEMA_CACHE_MISSING',
      cwd: '/tmp',
      env: process.env,
    })
    expect(r.status).toBe('passed')
  })

  test('SCHEMA_CACHE_MISSING with available:false → indeterminate', async () => {
    __setVerifyExecutorForTests(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ schemaCache: { available: false } }),
      stderr: '',
      durationMs: 3,
      truncated: false,
      timedOut: false,
    }))
    const step: GuideStep = { ...validVerifyStep, command: 'dbcli inspect --format json' }
    const r = await runVerifyStep(step, {
      code: 'SCHEMA_CACHE_MISSING',
      cwd: '/tmp',
      env: process.env,
    })
    expect(r.status).toBe('indeterminate')
  })
})
