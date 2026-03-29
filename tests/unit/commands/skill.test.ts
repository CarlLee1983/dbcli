/**
 * Skill command unit tests
 * Tests the skill command logic directly
 */

import { test, expect, describe, spyOn, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'
import { skillCommand } from '../../../src/commands/skill'

describe('skillCommand logic', () => {
  let logOutput = ''
  let errorOutput = ''
  let exitCode: number | undefined = undefined
  
  const logSpy = spyOn(console, 'log').mockImplementation((msg) => {
    logOutput += msg + '\n'
  })
  
  const errorSpy = spyOn(console, 'error').mockImplementation((msg) => {
    errorOutput += msg + '\n'
  })

  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  beforeEach(() => {
    logOutput = ''
    errorOutput = ''
    exitCode = undefined
    logSpy.mockClear()
    errorSpy.mockClear()
    exitSpy.mockClear()
  })

  test('prints SKILL.md to stdout by default', async () => {
    await skillCommand({} as any, {})
    expect(logOutput).toContain('# dbcli')
    expect(logOutput).toContain('Database CLI for AI agents')
  })

  test('writes to custom output file', async () => {
    const testFile = join(process.cwd(), 'test-skill.md')
    if (existsSync(testFile)) unlinkSync(testFile)
    
    try {
      await skillCommand({} as any, { output: testFile })
      expect(existsSync(testFile)).toBe(true)
      const content = await Bun.file(testFile).text()
      expect(content).toContain('# dbcli')
      expect(errorOutput).toContain('Skill written to')
    } finally {
      if (existsSync(testFile)) unlinkSync(testFile)
    }
  })

  test('fails for unknown platform', async () => {
    // Note: because we mock process.exit, the throw might still happen or exitCode set
    try {
      await skillCommand({} as any, { install: 'nonexistent' })
    } catch (e) {
      // either it throws or it exits
    }
    expect(exitCode).toBe(1)
    expect(errorOutput).toContain('Unknown platform')
  })
})
