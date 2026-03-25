import { bench, describe, beforeAll } from 'vitest'
import path from 'node:path'
import { execSync } from 'node:child_process'

// NOTE: This benchmark requires a running test database
// Set TEST_DATABASE_URL environment variable

describe('Performance: Query Execution', { skip: !process.env.TEST_DATABASE_URL }, () => {
  const cliPath = path.resolve(process.cwd(), 'dist/cli.mjs')

  beforeAll(() => {
    // Verify test database is accessible
    try {
      execSync(`${cliPath} query "SELECT 1" --format json`, {
        stdio: 'pipe',
        env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL }
      })
    } catch (error) {
      console.warn('Test database not available; skipping query benchmarks')
    }
  })

  bench('Query "SELECT 1" (connection + execution)', () => {
    // Measures: connect, execute simple query, format output
    // Target: < 50ms
    // Includes: connection overhead, parsing, execution, formatting
    try {
      execSync(`${cliPath} query "SELECT 1" --format json`, {
        stdio: 'pipe',
        timeout: 5000,
        env: { ...process.env }
      })
    } catch (error) {
      throw error
    }
  })

  bench('Query "SELECT 1" table format (connection + format)', () => {
    // Measures: connect, execute, format as ASCII table
    // Target: < 50ms
    try {
      execSync(`${cliPath} query "SELECT 1"`, {
        stdio: 'pipe',
        timeout: 5000,
        env: { ...process.env }
      })
    } catch (error) {
      throw error
    }
  })
})
