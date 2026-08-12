import { describe, test, expect } from 'bun:test'
import { mapWithConcurrency } from '@/utils/bounded-parallel'

describe('mapWithConcurrency', () => {
  test('保持輸入順序', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2)
    expect(result).toEqual([2, 4, 6, 8, 10])
  })

  test('同時執行數不超過上限', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        running += 1
        peak = Math.max(peak, running)
        await Bun.sleep(1)
        running -= 1
      }
    )
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  test('空輸入不呼叫 worker', async () => {
    let calls = 0
    const result = await mapWithConcurrency([], 4, async () => {
      calls += 1
    })
    expect(result).toEqual([])
    expect(calls).toBe(0)
  })

  test('任一項失敗時整體 reject', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      })
    ).rejects.toThrow('boom')
  })
})
