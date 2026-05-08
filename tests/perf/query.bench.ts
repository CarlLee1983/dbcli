/**
 * Query Execution Performance
 *
 * Requires a running test database (TEST_DATABASE_URL).
 * Skipped when not configured or when the built binary is missing.
 */
import { describe, it, expect, beforeAll } from 'bun:test'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')
const enabled =
  !!process.env.TEST_DATABASE_URL && existsSync(cliPath) && !process.env.SKIP_PERF_TESTS

describe.if(enabled)('Performance: Query Execution', () => {
  beforeAll(() => {
    execSync(`${cliPath} query "SELECT 1" --format json`, {
      stdio: 'pipe',
      env: { ...process.env },
    })
  })

  it('Query "SELECT 1" json format completes within budget', () => {
    const start = performance.now()
    execSync(`${cliPath} query "SELECT 1" --format json`, {
      stdio: 'pipe',
      timeout: 10_000,
      env: { ...process.env },
    })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(5000)
  })

  it('Query "SELECT 1" table format completes within budget', () => {
    const start = performance.now()
    execSync(`${cliPath} query "SELECT 1"`, {
      stdio: 'pipe',
      timeout: 10_000,
      env: { ...process.env },
    })
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(5000)
  })
})
