/**
 * CLI Startup Performance
 *
 * Loose budgets — these guard against gross regressions, not micro-tuning.
 * Set SKIP_PERF_TESTS=1 to skip (e.g. on noisy CI runners).
 *
 *   --help    < 5000ms
 *   --version < 5000ms
 *
 * Skipped when the built binary is missing so this can run locally pre-build.
 */
import { describe, it, expect } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')
const enabled = existsSync(cliPath) && !process.env.SKIP_PERF_TESTS

describe.if(enabled)('Performance: CLI Startup', () => {
  it('--help renders within budget', () => {
    const start = performance.now()
    execSync(`${cliPath} --help`, { stdio: 'pipe', timeout: 10_000 })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(5000)
  })

  it('--version renders within budget', () => {
    const start = performance.now()
    execSync(`${cliPath} --version`, { stdio: 'pipe', timeout: 10_000 })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(5000)
  })
})
