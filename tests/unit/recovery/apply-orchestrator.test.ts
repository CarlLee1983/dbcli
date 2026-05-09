import { describe, test, expect } from 'bun:test'
import { runApply, __setExecutorForTests } from '@/core/recovery/apply'
import type { RecoveryEnvelope } from '@/core/recovery'
import type { ExecOutcome } from '@/core/recovery/apply-exec'

function envelope(steps: Partial<RecoveryEnvelope['recovery'][number]>[]): RecoveryEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-05-10T00:00:00.000Z',
    ok: false,
    error: { code: 'BLACKLIST_TABLE', category: 'blacklist', message: 'x' },
    recovery: steps.map((s, i) => ({
      order: i + 1,
      command: 'dbcli inspect --for-agent',
      rationale: 'r',
      risk: 'readonly',
      expects: 'e',
      ...s,
    })),
  }
}

function fakeOk(durationMs = 10): ExecOutcome {
  return {
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    durationMs,
    truncated: false,
    timedOut: false,
  }
}

describe('runApply', () => {
  test('runs all readonly steps, finalStatus=ok', async () => {
    __setExecutorForTests(async () => fakeOk())
    const env = envelope([
      { command: 'dbcli inspect --for-agent', risk: 'readonly' },
      { command: 'dbcli blacklist list --format json', risk: 'readonly' },
    ])
    const result = await runApply(
      { envelope: env, cwd: process.cwd(), source: { kind: 'auto', path: 'x' } },
      { allowWrite: 'none' }
    )
    expect(result.finalStatus).toBe('ok')
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(result.stoppedAt).toBeNull()
  })

  test('skips write step when allowWrite=none', async () => {
    __setExecutorForTests(async () => fakeOk())
    const env = envelope([
      { command: 'dbcli inspect --for-agent', risk: 'readonly' },
      { command: 'dbcli blacklist remove orders', risk: 'write' },
    ])
    const result = await runApply(
      { envelope: env, cwd: process.cwd(), source: { kind: 'auto', path: 'x' } },
      { allowWrite: 'none' }
    )
    expect(result.results[0]!.status).toBe('ok')
    expect(result.results[1]!.status).toBe('skipped:risk')
    expect(result.finalStatus).toBe('ok')
  })

  test('skipped-only when every step is gated out', async () => {
    __setExecutorForTests(async () => fakeOk())
    const env = envelope([
      { command: 'dbcli init --force', risk: 'write', interactive: true },
      { command: 'dbcli blacklist remove <table>', risk: 'write', placeholders: ['<table>'] },
    ])
    const result = await runApply(
      { envelope: env, cwd: process.cwd(), source: { kind: 'auto', path: 'x' } },
      { allowWrite: 'write-cmd' }
    )
    expect(result.finalStatus).toBe('skipped-only')
  })

  test('fail-fast on first failed step', async () => {
    let call = 0
    __setExecutorForTests(async () => {
      call++
      return call === 1
        ? fakeOk()
        : {
            exitCode: 1,
            stdout: '',
            stderr: 'boom',
            durationMs: 5,
            truncated: false,
            timedOut: false,
          }
    })
    const env = envelope([
      { command: 'dbcli inspect --for-agent', risk: 'readonly' },
      { command: 'dbcli blacklist list --format json', risk: 'readonly' },
      { command: 'dbcli inspect --for-agent', risk: 'readonly' },
    ])
    const result = await runApply(
      { envelope: env, cwd: process.cwd(), source: { kind: 'auto', path: 'x' } },
      { allowWrite: 'none' }
    )
    expect(result.finalStatus).toBe('failed')
    expect(result.stoppedAt).toBe(2)
    expect(result.results.length).toBe(2)
  })

  test('skipped step does not advance stoppedAt', async () => {
    __setExecutorForTests(async () => fakeOk())
    const env = envelope([
      { command: 'dbcli init --force', risk: 'write', interactive: true },
      { command: 'dbcli inspect --for-agent', risk: 'readonly' },
    ])
    const result = await runApply(
      { envelope: env, cwd: process.cwd(), source: { kind: 'auto', path: 'x' } },
      { allowWrite: 'none' }
    )
    expect(result.results[0]!.status).toBe('skipped:interactive')
    expect(result.results[1]!.status).toBe('ok')
    expect(result.finalStatus).toBe('ok')
  })
})
