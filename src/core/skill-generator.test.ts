import { test, expect, describe } from 'bun:test'
import { SkillGenerator } from './skill-generator'
import type { SkillCommand, DbcliConfig, Permission } from '@/types'

/**
 * Mock Commander.js Command class for testing
 */
class MockCommand {
  private _name: string
  private _description: string
  private _options: any[] = []
  private _args: string[] = []

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

  setArgs(args: string[]) {
    this._args = args
    return this
  }

  get options() {
    return this._options
  }

  get args() {
    return this._args
  }
}

/**
 * Create mock program with test commands
 */
function createMockProgram(commandNames: string[] = ['list', 'schema', 'query']) {
  const commands = commandNames.map(name => {
    const cmd = new MockCommand(name, `${name} command description`)
    const optionsMap: Record<string, any[]> = {
      list: [
        { flags: '--format <type>', description: 'Output format', required: false },
        { flags: '--limit <number>', description: 'Limit results', required: false }
      ],
      schema: [
        { flags: '--format <type>', description: 'Output format', required: false }
      ],
      query: [
        { flags: '--format <type>', description: 'Output format', required: false },
        { flags: '--limit <number>', description: 'Limit results', required: false }
      ],
      insert: [
        { flags: '--data <json>', description: 'JSON data to insert', required: true },
        { flags: '--dry-run', description: 'Preview SQL', required: false }
      ],
      update: [
        { flags: '--where <condition>', description: 'WHERE clause', required: true },
        { flags: '--set <json>', description: 'JSON to set', required: true }
      ],
      delete: [
        { flags: '--where <condition>', description: 'WHERE clause', required: true },
        { flags: '--force', description: 'Skip confirmation', required: false }
      ],
      export: [
        { flags: '--format <format>', description: 'json or csv', required: false },
        { flags: '--output <path>', description: 'Output file path', required: false }
      ]
    }

    if (optionsMap[name]) {
      cmd.setOptions(optionsMap[name])
    }

    return cmd
  })

  return { commands: commands as any[] }
}

/**
 * Create default test config
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
    metadata: { version: '1.0.0' }
  }
}

describe('SkillGenerator - Introspection Tests', () => {
  test('collectCommands extracts commands from program', () => {
    const program = createMockProgram(['list', 'schema', 'query'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('list')
    expect(markdown).toContain('schema')
    expect(markdown).toContain('query')
  })

  test('handles empty command list gracefully', () => {
    const program = { commands: [] }
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('# dbcli Skill Documentation')
    expect(markdown).toContain('## Permission Levels')
  })

  test('extracts command options correctly', () => {
    const program = createMockProgram(['query'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('--format')
    expect(markdown).toContain('--limit')
  })

  test('includes command descriptions', () => {
    const program = createMockProgram(['list'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('list command description')
  })
})

describe('SkillGenerator - Permission Filtering Tests', () => {
  test('query-only permission hides write operations', () => {
    const program = createMockProgram(['list', 'schema', 'query', 'insert', 'update', 'delete'])
    const config = createTestConfig('query-only')
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'query-only'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### list')
    expect(markdown).toContain('### schema')
    expect(markdown).toContain('### query')
    expect(markdown).not.toContain('### insert')
    expect(markdown).not.toContain('### update')
    expect(markdown).not.toContain('### delete')
  })

  test('read-write permission hides delete operations', () => {
    const program = createMockProgram(['list', 'schema', 'query', 'insert', 'update', 'delete'])
    const config = createTestConfig('read-write')
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'read-write'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### list')
    expect(markdown).toContain('### schema')
    expect(markdown).toContain('### query')
    expect(markdown).toContain('### insert')
    expect(markdown).toContain('### update')
    expect(markdown).not.toContain('### delete')
  })

  test('admin permission shows all operations', () => {
    const program = createMockProgram(['list', 'schema', 'query', 'insert', 'update', 'delete'])
    const config = createTestConfig('admin')
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### list')
    expect(markdown).toContain('### schema')
    expect(markdown).toContain('### query')
    expect(markdown).toContain('### insert')
    expect(markdown).toContain('### update')
    expect(markdown).toContain('### delete')
  })

  test('permission filtering only affects specified commands', () => {
    const program = createMockProgram(['list', 'insert', 'query'])
    const config = createTestConfig('query-only')
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'query-only'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### list')
    expect(markdown).toContain('### query')
    expect(markdown).not.toContain('### insert')
  })
})

describe('SkillGenerator - SKILL.md Rendering Tests', () => {
  test('renders valid YAML frontmatter', () => {
    const program = createMockProgram(['list'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toMatch(/^---\nname: dbcli/)
    expect(markdown).toContain('description: Database CLI for AI agents')
    expect(markdown).toContain('user-invocable: true')
    expect(markdown).toContain('allowed-tools: Bash(dbcli *)')
    expect(markdown).toContain('---\n')
  })

  test('includes main header and sections', () => {
    const program = createMockProgram(['list'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('# dbcli Skill Documentation')
    expect(markdown).toContain('## Commands')
    expect(markdown).toContain('## Permission Levels')
    expect(markdown).toContain('## Tips for AI Agents')
  })

  test('renders command sections with usage and examples', () => {
    const program = createMockProgram(['list'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### list')
    expect(markdown).toContain('**Usage:** `dbcli list`')
    expect(markdown).toContain('**Permission required:**')
    expect(markdown).toContain('**Example:**')
    expect(markdown).toContain('```bash')
  })

  test('includes permission level information', () => {
    const program = createMockProgram(['query'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('**Query-only**: Execute SELECT queries')
    expect(markdown).toContain('**Read-Write**: Query-only + INSERT and UPDATE')
    expect(markdown).toContain('**Admin**: Read-Write + DELETE')
  })

  test('includes tips for AI agents', () => {
    const program = createMockProgram(['list'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('Schema introspection first')
    expect(markdown).toContain('Test with --dry-run')
    expect(markdown).toContain('Use --format json')
    expect(markdown).toContain('Check permission level')
  })
})

describe('SkillGenerator - Examples Tests', () => {
  test('generates examples for all known commands', () => {
    const program = createMockProgram(['init', 'list', 'schema', 'query', 'insert', 'update', 'delete', 'export'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    const knownCommands = ['init', 'list', 'schema', 'query', 'insert', 'update', 'delete', 'export']

    for (const cmd of knownCommands) {
      const section = markdown.split(`### ${cmd}`)[1]
      if (section) {
        expect(section).toContain('```bash')
        expect(section).toContain('```')
      }
    }
  })

  test('includes examples for query command', () => {
    const program = createMockProgram(['query'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('SELECT * FROM users')
    expect(markdown).toContain('--format json')
  })

  test('includes examples for insert command', () => {
    const program = createMockProgram(['insert'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('dbcli insert')
    expect(markdown).toContain('--data')
  })

  test('provides fallback example for unknown commands', () => {
    const cmd = new MockCommand('unknown', 'Unknown command')
    cmd.setOptions([])
    const program = { commands: [cmd as any] }
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('dbcli unknown')
  })

  test('examples are copy-paste ready', () => {
    const program = createMockProgram(['delete'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('```bash\ndbcli delete')
    expect(markdown).toContain('--where')
    expect(markdown).toContain('--force')
  })
})

describe('SkillGenerator - Permission Detection Tests', () => {
  test('insert command requires read-write permission', () => {
    const program = createMockProgram(['insert'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('**Permission required:** read-write')
  })

  test('delete command requires admin permission', () => {
    const program = createMockProgram(['delete'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('**Permission required:** admin')
  })

  test('query commands require query-only permission', () => {
    const program = createMockProgram(['query', 'list', 'schema'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    const sections = markdown.split('### ')
    const querySection = sections.find(s => s.startsWith('query'))
    expect(querySection).toContain('**Permission required:** query-only')
  })
})

describe('SkillGenerator - Edge Cases', () => {
  test('handles commands with no options', () => {
    const cmd = new MockCommand('init', 'Initialize dbcli')
    cmd.setOptions([])
    const program = { commands: [cmd as any] }
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### init')
    expect(markdown).toContain('(No options)')
  })

  test('handles commands with missing descriptions', () => {
    const cmd = new MockCommand('test', '')
    cmd.setOptions([])
    const program = { commands: [cmd as any] }
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('No description')
  })

  test('permission level uses options.permissionLevel not config.permission', () => {
    const program = createMockProgram(['list', 'insert'])
    // config says admin, but options.permissionLevel says query-only
    const config = createTestConfig('admin')
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'query-only' // This should take precedence
    })

    const markdown = generator.generateSkillMarkdown()
    expect(markdown).toContain('### list')
    expect(markdown).not.toContain('### insert')
  })

  test('renders multiple examples per command', () => {
    const program = createMockProgram(['query'])
    const config = createTestConfig()
    const generator = new SkillGenerator({
      program,
      config,
      permissionLevel: 'admin'
    })

    const markdown = generator.generateSkillMarkdown()
    // Query should have multiple examples
    const querySection = markdown.split('### query')[1]
    const codeBlockCount = (querySection?.match(/```bash/g) || []).length
    expect(codeBlockCount).toBeGreaterThanOrEqual(2)
  })
})
