import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { skillCommand } from '@/commands/skill'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'

/** Dummy program (no longer used by skillCommand, but required by signature) */
const dummyProgram = {} as any

describe('skill command', () => {
  let tempDir: string
  let originalHomeDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'dbcli-skill-test-'))
    originalHomeDir = process.env.HOME || ''
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    if (originalHomeDir) {
      process.env.HOME = originalHomeDir
    }
  })

  test('should output static SKILL.md to stdout', async () => {
    let output = ''
    const originalLog = console.log
    console.log = (msg: string) => { output = msg }

    await skillCommand(dummyProgram, {})

    console.log = originalLog

    expect(output).toContain('---')
    expect(output).toContain('name: dbcli')
    expect(output).toContain('description:')
    expect(output).toContain('## Commands')
  })

  test('should contain all documented commands', async () => {
    let output = ''
    const originalLog = console.log
    console.log = (msg: string) => { output = msg }

    await skillCommand(dummyProgram, {})

    console.log = originalLog

    expect(output).toContain('### init')
    expect(output).toContain('### list')
    expect(output).toContain('### schema')
    expect(output).toContain('### query')
    expect(output).toContain('### insert')
    expect(output).toContain('### update')
    expect(output).toContain('### delete')
    expect(output).toContain('### export')
    expect(output).toContain('### blacklist')
  })

  test('should contain permission levels section', async () => {
    let output = ''
    const originalLog = console.log
    console.log = (msg: string) => { output = msg }

    await skillCommand(dummyProgram, {})

    console.log = originalLog

    expect(output).toContain('## Permission Levels')
    expect(output).toContain('query-only')
    expect(output).toContain('read-write')
    expect(output).toContain('admin')
  })

  test('should write to file with --output option', async () => {
    const outputPath = path.join(tempDir, 'test-skill.md')

    let errorOutput = ''
    const originalError = console.error
    console.error = (msg: string) => { errorOutput = msg }

    await skillCommand(dummyProgram, { output: outputPath })

    console.error = originalError

    const fileContent = await Bun.file(outputPath).text()
    expect(fileContent).toContain('---')
    expect(fileContent).toContain('name: dbcli')
    expect(errorOutput).toContain(outputPath)
  })

  test('should install to claude platform directory', async () => {
    process.env.HOME = tempDir

    const originalError = console.error
    console.error = () => {}

    await skillCommand(dummyProgram, { install: 'claude' })

    console.error = originalError

    const claudePath = path.join(tempDir, '.claude', 'skills', 'dbcli', 'SKILL.md')
    const file = Bun.file(claudePath)
    expect(await file.exists()).toBe(true)
    const content = await file.text()
    expect(content).toContain('name: dbcli')
  })

  test('should install to gemini platform directory', async () => {
    process.env.HOME = tempDir

    const originalError = console.error
    console.error = () => {}

    await skillCommand(dummyProgram, { install: 'gemini' })

    console.error = originalError

    const geminiPath = path.join(tempDir, '.gemini', 'skills', 'dbcli', 'SKILL.md')
    const file = Bun.file(geminiPath)
    expect(await file.exists()).toBe(true)
  })

  test('should exit on invalid platform', async () => {
    let exited = false
    const originalExit = process.exit
    process.exit = (() => { exited = true }) as any

    let errorMsg = ''
    const originalError = console.error
    console.error = (msg: string) => { errorMsg = msg }

    await skillCommand(dummyProgram, { install: 'invalid-platform' })

    console.error = originalError
    process.exit = originalExit

    expect(exited).toBe(true)
    expect(errorMsg).toContain('Unknown platform')
  })
})
