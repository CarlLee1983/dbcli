/**
 * CLI Startup Performance
 *
 * Budgets are checked against the median after a discarded warm-up so one
 * descheduled process does not turn this into a flaky gate.
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

function medianStartupMs(argument: '--help' | '--version', sampleCount = 5): number {
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

  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

function report(label: string, elapsed: number, budget: number): void {
  console.log(`${label} = ${elapsed.toFixed(2)}ms (budget ${budget}ms)`)
}

describe.if(enabled)('Performance: CLI Startup', () => {
  it('--help renders within budget', () => {
    const elapsed = medianStartupMs('--help')
    report('CLI startup (--help)', elapsed, STARTUP_BUDGETS.help)
    expect(elapsed).toBeLessThan(STARTUP_BUDGETS.help)
  })

  it('--version renders within budget', () => {
    const elapsed = medianStartupMs('--version')
    report('CLI startup (--version)', elapsed, STARTUP_BUDGETS.version)
    expect(elapsed).toBeLessThan(STARTUP_BUDGETS.version)
  })
})
