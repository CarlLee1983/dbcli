import { bench, describe } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'

describe('Performance: CLI Startup', () => {
  const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')

  bench('CLI --help (startup time)', () => {
    // Measures: parse CLI, register commands, output help text
    // Target: < 200ms on macOS/Linux, < 300ms on Windows
    try {
      execSync(`${cliPath} --help`, {
        stdio: 'pipe',
        timeout: 5000,
      })
    } catch (error) {
      // Timeout or error - will be caught by benchmark framework
      throw error
    }
  })

  bench('CLI --version (minimal startup)', () => {
    // Measures: parse CLI, output version (fastest path)
    // Target: < 100ms
    try {
      execSync(`${cliPath} --version`, {
        stdio: 'pipe',
        timeout: 5000,
      })
    } catch (error) {
      throw error
    }
  })
})
