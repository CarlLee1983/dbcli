import { describe, test, expect, afterEach } from 'bun:test'
import { runApply, __setExecutorForTests, __resetExecutorForTests } from '@/core/recovery/apply'
import {
  __setVerifyExecutorForTests,
  __resetVerifyExecutorForTests,
} from '@/core/recovery/apply-verify'
import type { ApplyInput } from '@/core/recovery/apply-types'

afterEach(() => {
  __resetExecutorForTests()
  __resetVerifyExecutorForTests()
})

const baseInput = (): ApplyInput => ({
  cwd: '/tmp',
  source: { kind: 'auto', path: '.dbcli/last-recovery.json' },
  envelope: {
    schemaVersion: 1,
    generatedAt: 'x',
    ok: false,
    error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: '' },
    recovery: [
      {
        order: 1,
        command: 'dbcli inspect --for-agent',
        rationale: '',
        risk: 'readonly',
        expects: '',
      },
    ],
    verify: {
      order: 0,
      command: 'dbcli inspect --for-agent',
      rationale: '',
      risk: 'readonly',
      expects: '',
    },
  },
})

describe('runApply verify hook', () => {
  test('runs verify after success and attaches verifyResult + verifyStatus', async () => {
    __setExecutorForTests(async () => ({
      exitCode: 0,
      stdout: '{}',
      stderr: '',
      durationMs: 1,
      truncated: false,
      timedOut: false,
    }))
    let verifyCalled = false
    __setVerifyExecutorForTests(async () => {
      verifyCalled = true
      return {
        exitCode: 0,
        stdout: '{}',
        stderr: '',
        durationMs: 1,
        truncated: false,
        timedOut: false,
      }
    })
    const r = await runApply(baseInput(), { allowWrite: 'none' })
    expect(verifyCalled).toBe(true)
    expect(r.finalStatus).toBe('ok')
    expect(r.verifyStatus).toBe('passed')
    expect(r.verifyResult?.command).toBe('dbcli inspect --for-agent')
  })

  test('skips verify when noVerify: true', async () => {
    __setExecutorForTests(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      truncated: false,
      timedOut: false,
    }))
    let verifyCalled = false
    __setVerifyExecutorForTests(async () => {
      verifyCalled = true
      throw new Error('verify executor must not be invoked')
    })
    const r = await runApply(baseInput(), { allowWrite: 'none', noVerify: true })
    expect(verifyCalled).toBe(false)
    expect(r.verifyStatus).toBeUndefined()
    expect(r.verifyResult).toBeUndefined()
  })

  test('skips verify when finalStatus = failed', async () => {
    __setExecutorForTests(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      durationMs: 1,
      truncated: false,
      timedOut: false,
    }))
    let verifyCalled = false
    __setVerifyExecutorForTests(async () => {
      verifyCalled = true
      throw new Error('should not run')
    })
    const r = await runApply(baseInput(), { allowWrite: 'none' })
    expect(r.finalStatus).toBe('failed')
    expect(verifyCalled).toBe(false)
    expect(r.verifyStatus).toBeUndefined()
  })

  test('skips verify when finalStatus = skipped-only', async () => {
    const input = baseInput()
    input.envelope.recovery = [
      {
        order: 1,
        command: 'dbcli blacklist remove orders',
        rationale: '',
        risk: 'write',
        expects: '',
      },
    ]
    let verifyCalled = false
    __setVerifyExecutorForTests(async () => {
      verifyCalled = true
      throw new Error('should not run')
    })
    const r = await runApply(input, { allowWrite: 'none' })
    expect(r.finalStatus).toBe('skipped-only')
    expect(verifyCalled).toBe(false)
    expect(r.verifyStatus).toBeUndefined()
  })

  test('skips verify silently when envelope.verify is absent', async () => {
    const input = baseInput()
    delete input.envelope.verify
    __setExecutorForTests(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      truncated: false,
      timedOut: false,
    }))
    const r = await runApply(input, { allowWrite: 'none' })
    expect(r.finalStatus).toBe('ok')
    expect(r.verifyStatus).toBeUndefined()
    expect(r.verifyResult).toBeUndefined()
  })
})
