/**
 * CLI Startup Performance
 *
 * What `--help` costs is the bytes it has to parse and execute, and that is what
 * this file gates. `dist/cli.mjs` answers `--version` by itself and dynamically
 * imports `./cli-runtime` for everything else, so every other invocation loads
 * exactly those two files; the database drivers stay behind their own dynamic
 * imports and are not part of startup. Their combined size is a property of the
 * build, identical on every machine and under any load.
 *
 * The wall-clock number is still measured and printed — it is what a user feels,
 * and a tightening margin should be visible — but it is not asserted. It was,
 * against 200ms, and on one unchanged commit it read 171–187ms idle and
 * 248–337ms with eight CPU-bound processes running, failing five runs out of
 * five. The file's own header used to record the same thing on `main`: 84ms to
 * 283ms against that budget, "failing CI on commits that touched nothing
 * related". Load inflates process startup one-sidedly and no denominator
 * cancels it: a bare interpreter measured 6.5–7.6ms whether the machine was
 * idle or loaded, so every ratio built on it drifts further than the absolute
 * number did. See DBCLI-019, GATE-003 and GATE-004.
 *
 * Set SKIP_PERF_TESTS=1 to skip (e.g. on noisy CI runners).
 *
 * Skipped when the built binary is missing so this can run locally pre-build.
 */
import { describe, it, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')
const enabled = existsSync(cliPath) && !process.env.SKIP_PERF_TESTS
const STARTUP_BUDGETS =
  process.platform === 'win32' ? { help: 5000, version: 5000 } : { help: 200, version: 100 }

// The two files `--help` loads. Measured 2,156,743 bytes at the time this gate was
// written (4,928 + 2,151,815), so the budget is 2.6MB: ~20% of head-room for
// ordinary growth, while anything that pulls a driver or a UI bundle onto the
// startup path — the shapes that put hundreds of KB in at once — turns it red.
const STARTUP_BYTES_BUDGET = 2_600_000
const VERSION_BYTES_BUDGET = 8_000
const runtimePath = path.resolve(process.cwd(), 'dist/cli-runtime.mjs')

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
  it('--help loads no more than the startup budget of bytes', () => {
    const bytes = statSync(cliPath).size + statSync(runtimePath).size
    console.log(
      `CLI startup bytes = ${bytes} (budget ${STARTUP_BYTES_BUDGET}), ` +
        `cli.mjs ${statSync(cliPath).size} + cli-runtime.mjs ${statSync(runtimePath).size}`
    )
    expect(bytes).toBeLessThan(STARTUP_BYTES_BUDGET)
  })

  it('--help reports what it cost', () => {
    const elapsed = fastestStartupMs('--help')
    // Printed, not asserted. See the file header.
    report('CLI startup (--help)', elapsed, STARTUP_BUDGETS.help)
    expect(elapsed).toBeGreaterThan(0)
  })

  it('--version loads nothing but the entry file', () => {
    // `dist/cli.mjs` answers `--version` without importing `./cli-runtime`, which is
    // the whole reason it is 16ms where `--help` is 170ms. The gate is that the
    // short circuit is still there: the entry alone, 5,017 bytes when this was
    // written, against 8,000. Pulling the runtime onto this path adds 2.1MB and
    // fails long before the budget is a matter of taste.
    const bytes = statSync(cliPath).size
    console.log(`CLI --version bytes = ${bytes} (budget ${VERSION_BYTES_BUDGET})`)
    expect(bytes).toBeLessThan(VERSION_BYTES_BUDGET)
  })

  it('--version reports what it cost', () => {
    const elapsed = fastestStartupMs('--version')
    // Printed, not asserted — the same reason as `--help`. Measured 15–25ms under
    // eight CPU-bound processes against a 100ms budget, so this one had head-room
    // rather than a different property; DBCLI-020 closed it for the same reason
    // rather than waiting for it to start flipping too.
    report('CLI startup (--version)', elapsed, STARTUP_BUDGETS.version)
    expect(elapsed).toBeGreaterThan(0)
  })
})
