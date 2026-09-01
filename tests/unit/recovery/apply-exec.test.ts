import { describe, test, expect } from 'bun:test'
import { executeStep } from '@/core/recovery/apply-exec'

const ENV = { ...process.env }

describe('executeStep', () => {
  test('returns ok on exit-0 child', async () => {
    const r = await executeStep(['true'], { cwd: process.cwd(), env: ENV, timeoutMs: 5_000 })
    expect(r.exitCode).toBe(0)
    expect(r.timedOut).toBe(false)
    expect(r.truncated).toBe(false)
  })

  test('returns non-zero exit code', async () => {
    const r = await executeStep(['false'], { cwd: process.cwd(), env: ENV, timeoutMs: 5_000 })
    expect(r.exitCode).not.toBe(0)
  })

  test('captures stdout up to cap', async () => {
    const r = await executeStep(['printf', 'hello world'], {
      cwd: process.cwd(),
      env: ENV,
      timeoutMs: 5_000,
    })
    expect(r.stdout).toBe('hello world')
  })

  test('truncates stdout that exceeds the cap', async () => {
    const r = await executeStep(['sh', '-c', 'yes x | head -c 200000'], {
      cwd: process.cwd(),
      env: ENV,
      stdoutCap: 1024,
      timeoutMs: 5_000,
    })
    expect(r.truncated).toBe(true)
    expect(r.stdout.length).toBeLessThanOrEqual(1024)
  })

  test('enforces wall-clock timeout', async () => {
    const r = await executeStep(['sleep', '5'], {
      cwd: process.cwd(),
      env: ENV,
      timeoutMs: 200,
    })
    expect(r.timedOut).toBe(true)
    expect(r.exitCode).not.toBe(0)
    // 要驗的是「被逾時砍掉」，不是「剛好等滿 200 ms」。`setTimeout` 可能比
    // `performance.now()` 的時鐘早一點點觸發——Windows 的計時器粒度約 15.6 ms，
    // CI 上量到 199 就是這個假象。沒逾時的話這裡會是 5000。
    expect(r.durationMs).toBeGreaterThanOrEqual(150)
    expect(r.durationMs).toBeLessThan(5_000)
  })

  test('child stdin is closed (does not hang on stdin-reading commands)', async () => {
    const r = await executeStep(['cat'], { cwd: process.cwd(), env: ENV, timeoutMs: 2_000 })
    expect(r.timedOut).toBe(false)
    expect(r.exitCode).toBe(0)
  })
})
