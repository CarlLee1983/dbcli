/**
 * CLI Startup Performance
 *
 * Budgets are checked against the FASTEST of several runs, not the median.
 * Startup noise is one-sided — a descheduled process is slower, never faster —
 * so the minimum estimates the real cost and the median mostly reports how
 * busy the runner was. Measured on `main`, the same workload has reported
 * anywhere from 84ms to 283ms against a 200ms budget, failing CI on commits
 * that touched nothing related.
 * Set SKIP_PERF_TESTS=1 to skip (e.g. on noisy CI runners).
 *
 *   --help    < 200ms on macOS/Linux
 *   --version < 100ms on macOS/Linux
 *
 * Skipped when the built binary is missing so this can run locally pre-build.
 */
import { describe, it, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')
const enabled = existsSync(cliPath) && !process.env.SKIP_PERF_TESTS
const STARTUP_BUDGETS =
  process.platform === 'win32' ? { help: 5000, version: 5000 } : { help: 200, version: 100 }

const SAMPLE_COUNT = 9

function fastestStartupMs(argument: '--help' | '--version', sampleCount = SAMPLE_COUNT): number {
  const run = () =>
    spawnSync(process.execPath, [cliPath, argument], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
    })

  const warmup = run()
  expect(warmup.status).toBe(0)

  const samples: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const start = performance.now()
    const result = run()
    samples.push(performance.now() - start)
    expect(result.status).toBe(0)
  }

  return Math.min(...samples)
}

function report(label: string, elapsed: number, budget: number): void {
  console.log(`${label} = ${elapsed.toFixed(2)}ms (fastest of ${SAMPLE_COUNT}, budget ${budget}ms)`)
}

describe.if(enabled)('Performance: CLI Startup', () => {
  it('--help renders within budget', () => {
    const elapsed = fastestStartupMs('--help')
    report('CLI startup (--help)', elapsed, STARTUP_BUDGETS.help)
    expect(elapsed).toBeLessThan(STARTUP_BUDGETS.help)
  })

  it('--version renders within budget', () => {
    const elapsed = fastestStartupMs('--version')
    report('CLI startup (--version)', elapsed, STARTUP_BUDGETS.version)
    expect(elapsed).toBeLessThan(STARTUP_BUDGETS.version)
  })
})
