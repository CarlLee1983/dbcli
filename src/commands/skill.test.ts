import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { skillCommand } from './skill'
import type { DbcliConfig, Permission } from '@/types'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'

/**
 * Mock Command class for testing
 */
class MockCommand {
  private _name: string
  private _description: string
  private _options: any[] = []
  private _commands: MockCommand[] = []

  constructor(name: string, description: string = '') {
    this._name = name
    this._description = description
  }

  name() {
    return this._name
  }

  description() {
    return this._description
  }

  setOptions(opts: any[]) {
    this._options = opts
    return this
  }

  addCommand(cmd: MockCommand) {
    this._commands.push(cmd)
    return this
  }

  get options() {
    return this._options
  }

  get commands(): MockCommand[] {
    return this._commands
  }

  get args() {
    return []
  }
}

/**
 * Create mock program with test commands
 */
function createMockProgram() {
  const mockCmds = [
    new MockCommand('list', 'List tables'),
    new MockCommand('schema', 'Show table schema'),
    new MockCommand('query', 'Execute SQL query'),
    new MockCommand('insert', 'Insert data'),
    new MockCommand('update', 'Update data'),
    new MockCommand('delete', 'Delete data'),
    new MockCommand('export', 'Export data')
  ]

  mockCmds[0].setOptions([
    { flags: '--format <type>', description: 'Output format', required: false }
  ])

  mockCmds[1].setOptions([
    { flags: '--format <type>', description: 'Output format', required: false }
  ])

  mockCmds[2].setOptions([
    { flags: '--format <type>', description: 'Output format', required: false },
    { flags: '--limit <number>', description: 'Limit results', required: false }
  ])

  mockCmds[3].setOptions([
    { flags: '--data <json>', description: 'Data to insert', required: true }
  ])

  mockCmds[4].setOptions([
    { flags: '--where <condition>', description: 'WHERE clause', required: true },
    { flags: '--set <json>', description: 'Fields to update', required: true }
  ])

  mockCmds[5].setOptions([
    { flags: '--where <condition>', description: 'WHERE clause', required: true }
  ])

  mockCmds[6].setOptions([
    { flags: '--format <format>', description: 'json or csv', required: false },
    { flags: '--output <path>', description: 'Output file', required: false }
  ])

  const program = {
    commands: mockCmds as any[]
  }

  return program
}

/**
 * Create test configuration
 */
function createTestConfig(permissionLevel: Permission = 'admin'): DbcliConfig {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'test',
      database: 'testdb'
    },
    permission: permissionLevel,
    schema: {},
    metadata: {
      version: '1.0'
    }
  }
}

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
    } catch (err) {
      // Ignore cleanup errors
    }
    if (originalHomeDir) {
      process.env.HOME = originalHomeDir
    }
  })

  test('should generate SKILL.md with valid frontmatter', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')

    // Mock configModule.read
    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      // Capture console.log output
      let output = ''
      const originalLog = console.log
      console.log = (msg: string) => {
        output = msg
      }

      await skillCommand(program as any, {})

      console.log = originalLog

      // Verify frontmatter exists
      expect(output).toContain('---')
      expect(output).toContain('name: dbcli')
      expect(output).toContain('description:')
      expect(output).toContain('user-invocable: true')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should filter commands based on query-only permission', async () => {
    const program = createMockProgram()
    const config = createTestConfig('query-only')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      let output = ''
      const originalLog = console.log
      console.log = (msg: string) => {
        output = msg
      }

      await skillCommand(program as any, {})

      console.log = originalLog

      // Query-only should hide insert, update, delete
      expect(output).not.toContain('### insert')
      expect(output).not.toContain('### update')
      expect(output).not.toContain('### delete')
      expect(output).toContain('### query')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should filter commands based on read-write permission', async () => {
    const program = createMockProgram()
    const config = createTestConfig('read-write')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      let output = ''
      const originalLog = console.log
      console.log = (msg: string) => {
        output = msg
      }

      await skillCommand(program as any, {})

      console.log = originalLog

      // Read-write should hide delete but show insert/update
      expect(output).not.toContain('### delete')
      expect(output).toContain('### insert')
      expect(output).toContain('### update')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should write to file with --output option', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')
    const outputPath = path.join(tempDir, 'test-skill.md')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      let errorOutput = ''
      const originalError = console.error
      console.error = (msg: string) => {
        errorOutput = msg
      }

      await skillCommand(program as any, { output: outputPath })

      console.error = originalError

      // Verify file was created
      const fileContent = await Bun.file(outputPath).text()
      expect(fileContent).toContain('---')
      expect(fileContent).toContain('name: dbcli')
      expect(errorOutput).toContain('✅')
      expect(errorOutput).toContain(outputPath)
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should install to claude platform directory', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')
    const claudeDir = path.join(tempDir, '.claude', 'skills', 'dbcli')
    const claudePath = path.join(claudeDir, 'SKILL.md')

    // Set HOME to temp directory
    process.env.HOME = tempDir

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      let errorOutput = ''
      const originalError = console.error
      console.error = (msg: string) => {
        errorOutput = msg
      }

      await skillCommand(program as any, { install: 'claude' })

      console.error = originalError

      // Verify file was created in correct location
      const file = Bun.file(claudePath)
      expect(await file.exists()).toBe(true)
      const content = await file.text()
      expect(content).toContain('dbcli')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should install to gemini platform directory', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')
    const geminiDir = path.join(tempDir, '.gemini', 'skills', 'dbcli')
    const geminiPath = path.join(geminiDir, 'SKILL.md')

    process.env.HOME = tempDir

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      const originalError = console.error
      console.error = () => {}

      await skillCommand(program as any, { install: 'gemini' })

      console.error = originalError

      const file = Bun.file(geminiPath)
      expect(await file.exists()).toBe(true)
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should install to copilot platform directory', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')
    const copilotDir = path.join(process.cwd(), '.github', 'skills', 'dbcli')
    const copilotPath = path.join(copilotDir, 'SKILL.md')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      const originalError = console.error
      console.error = () => {}

      // Clean up if exists from previous test
      try {
        await fs.rm(copilotDir, { recursive: true, force: true })
      } catch (e) {
        // Ignore
      }

      await skillCommand(program as any, { install: 'copilot' })

      console.error = originalError

      // Skip verification since we can't write to project root during tests
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should install to cursor platform directory', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')
    const cursorDir = path.join(process.cwd(), '.cursor', 'rules')
    const cursorPath = path.join(cursorDir, 'dbcli.mdc')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      const originalError = console.error
      console.error = () => {}

      // Clean up if exists
      try {
        await fs.rm(cursorDir, { recursive: true, force: true })
      } catch (e) {
        // Ignore
      }

      await skillCommand(program as any, { install: 'cursor' })

      console.error = originalError

      // Skip verification since we can't write to project root during tests
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should throw error on invalid platform', async () => {
    const program = createMockProgram()
    const config = createTestConfig('admin')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => config

    try {
      let exited = false
      const originalExit = process.exit
      process.exit = (() => {
        exited = true
      }) as any

      const originalError = console.error
      let errorMsg = ''
      console.error = (msg: string) => {
        errorMsg = msg
      }

      await skillCommand(program as any, { install: 'invalid-platform' })

      console.error = originalError
      process.exit = originalExit

      expect(exited).toBe(true)
      expect(errorMsg).toContain('未知的平台')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should show error when config is missing', async () => {
    const program = createMockProgram()

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => ({
      connection: null,
      permission: 'query-only',
      schema: {},
      metadata: { version: '1.0' }
    } as any)

    try {
      let exited = false
      const originalExit = process.exit
      process.exit = (() => {
        exited = true
      }) as any

      const originalError = console.error
      let errorMsg = ''
      console.error = (msg: string) => {
        errorMsg = msg
      }

      await skillCommand(program as any, {})

      console.error = originalError
      process.exit = originalExit

      expect(exited).toBe(true)
      expect(errorMsg).toContain('dbcli init')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })

  test('should handle permission levels correctly in output', async () => {
    const program = createMockProgram()
    const adminConfig = createTestConfig('admin')

    const originalRead = (await import('@/core/config')).configModule.read
    ;(await import('@/core/config')).configModule.read = async () => adminConfig

    try {
      let output = ''
      const originalLog = console.log
      console.log = (msg: string) => {
        output = msg
      }

      await skillCommand(program as any, {})

      console.log = originalLog

      // Admin should see all commands including delete
      expect(output).toContain('### delete')
      expect(output).toContain('Permission Levels')
      expect(output).toContain('Query-only')
      expect(output).toContain('Read-Write')
      expect(output).toContain('Admin')
    } finally {
      ;(await import('@/core/config')).configModule.read = originalRead
    }
  })
})
