/**
 * 效能 bench 共用的取樣與回報。
 *
 * 抽出來而不是各自複製一份：`test:perf` 是 CI 的阻斷步驟，而「怎麼取樣」與
 * 「印不印出量到的數字」決定了那道門是門還是擲硬幣。兩件事各只該有一個答案。
 */

/**
 * Median of `sampleCount` runs, after one discarded warm-up run.
 *
 * A single `performance.now()` around one call is not a threshold a CI job can be
 * held to: one GC pause or a descheduled slice and it reads several times high. On
 * this machine the same masking call medians at ~1.3ms, yet three consecutive
 * single-shot runs of the old benchmark produced one reading past the 5ms budget
 * (n=3 — enough to show the gate was unreliable, not enough to put a rate on it).
 * The median is what makes this assertion a gate rather than a coin flip.
 */
export function medianElapsed(run: () => unknown, sampleCount = 9): number {
  const samples: number[] = []
  let sink = 0
  for (let i = 0; i <= sampleCount; i++) {
    const start = performance.now()
    const result = run()
    const elapsed = performance.now() - start
    // Consume the result so the JIT cannot elide the call it is timing.
    sink += Array.isArray(result) ? result.length : 1
    if (i > 0) samples.push(elapsed)
  }
  if (samples.length === 0 || sink === 0) {
    // Failing open here would let `expect(0).toBeLessThan(5)` certify a gate that
    // measured nothing at all.
    throw new Error('medianElapsed measured no samples')
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

/**
 * Print every measurement, passing or failing.
 *
 * `test:perf` is a blocking CI step, so the number a budget was met by is the only
 * way to tell "comfortable" from "one bad runner away" without waiting for a red
 * build. The budgets themselves were chosen from real runner measurements, not
 * from a dev machine — see the CHANGELOG entry.
 */
export function report(label: string, elapsed: number, budget: number): void {
  console.log(`${label} = ${elapsed.toFixed(2)}ms (budget ${budget}ms)`)
}
