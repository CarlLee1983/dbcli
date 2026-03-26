---
phase: 09-ai-integration
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/skill-generator.ts
  - src/types/index.ts
  - src/core/index.ts
  - src/core/skill-generator.test.ts
autonomous: true
requirements:
  - AI-01
  - AI-03
must_haves:
  truths:
    - SkillGenerator introspects actual CLI commands at runtime via Commander.js
    - Generated SKILL.md contains valid YAML frontmatter and markdown command reference
    - Commands are filtered based on current permission level (Query-only hides write operations)
    - Skill content reflects current CLI capabilities (no hardcoded stale command lists)
    - Skill output is valid and ready to install to any platform
  artifacts:
    - path: src/core/skill-generator.ts
      provides: SkillGenerator class with introspection, filtering, and SKILL.md generation
      exports: "class SkillGenerator"
    - path: src/types/index.ts
      provides: SkillCommand and SkillGeneratorOptions interfaces
      exports: "SkillCommand, SkillGeneratorOptions"
    - path: src/core/skill-generator.test.ts
      provides: Comprehensive unit tests for skill generation
      min_tests: 15
  key_links:
    - from: src/core/skill-generator.ts
      to: src/cli.ts (program)
      via: "Constructor receives Commander.js program object and options"
      pattern: "new SkillGenerator({program, config, permissionLevel})"
    - from: src/core/skill-generator.ts
      to: src/types/index.ts
      via: "Imports SkillCommand, SkillGeneratorOptions types"
      pattern: "import.*SkillCommand.*from.*types"
    - from: src/core/skill-generator.ts
      to: src/core/permission-guard.ts
      via: "Uses PermissionGuard.classify() to detect command permission requirements"
      pattern: "PermissionGuard\\.classify"
---

<objective>
Build SkillGenerator infrastructure for dynamic, permission-aware SKILL.md generation. This plan creates the core engine that introspects the CLI at runtime and generates platform-agnostic skill documentation.

Purpose: Enable AI agents to understand dbcli capabilities dynamically as the CLI evolves. Skills must reflect actual permission level to prevent agents from attempting forbidden operations.

Output:
- SkillGenerator class capable of generating valid SKILL.md with frontmatter
- Comprehensive unit tests ensuring skill content is accurate and permission-filtered
- Type definitions for skill-related structures
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/09-ai-integration/09-RESEARCH.md
</execution_context>

<context>
## Phase Dependency Note

**IMPORTANT:** Phase 9 actually depends on Phases 7 and 8 being complete, NOT just Phase 6:
- Phase 6: init, list, schema, query commands
- Phase 7: adds insert, update, delete commands
- Phase 8: adds export command

The plans assume all 8 commands (init, list, schema, query, insert, update, delete, export) are registered in src/cli.ts.
If executed before Phase 7/8 complete, this plan will generate examples for non-existent commands.
Ensure Phases 7 and 8 are complete before executing Phase 9.

## Key Files to Understand Architecture

@src/cli.ts — Shows how Commander.js program is structured with all registered commands
@src/core/permission-guard.ts — Shows PermissionGuard.classify() method for statement classification
@src/core/config.ts — Shows how to load config and read permission level
@src/types/index.ts — Current type exports (will add SkillCommand, SkillGeneratorOptions)

## Permission Level Meanings

From `.planning/phases/09-ai-integration/09-RESEARCH.md`:
- **Query-only**: Can execute SELECT, list, schema, export only. Hides: insert, update, delete
- **Read-Write**: Can execute Query-only + INSERT, UPDATE. Hides: delete
- **Admin**: Can execute all operations including DELETE

## SKILL.md Structure

From research, SKILL.md has three sections:
1. YAML frontmatter with metadata (name, description, allowed-tools, etc.)
2. Markdown description and command reference
3. Copy-paste examples for each command

Current frontmatter values:
```yaml
---
name: dbcli
description: Database CLI for AI agents. Use to query, modify, and manage database schemas with permission-based access control.
user-invocable: true
allowed-tools: Bash(dbcli *)
---
```

## Current CLI Commands to Introspect

From src/cli.ts:
- init (setup, always visible)
- list (schema discovery)
- schema (schema discovery)
- query (read operation)
- insert (write operation, requires read-write+)
- update (write operation, requires read-write+)
- delete (admin operation, requires admin)
- export (read operation)

## Permission Filtering Rules

From research Pitfall 2:
- Query-only: Hide insert, update, delete
- Read-Write: Hide delete
- Admin: Show all

Use PermissionGuard.classify() to detect if a command name corresponds to a write or delete operation.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create SkillCommand type definitions and SkillGeneratorOptions interface</name>
  <files>src/types/index.ts</files>
  <read_first>
    - src/types/index.ts (current exports and interfaces)
    - src/cli.ts (shows command structure: name, description, options, args)
  </read_first>
  <action>
Add two new interfaces to src/types/index.ts after existing exports:

```typescript
/**
 * Represents a single CLI command in the skill documentation
 */
export interface SkillCommand {
  name: string
  description: string
  args: string[]
  options: Array<{
    flag: string
    description: string
    required: boolean
  }>
  permissionLevel: 'query-only' | 'read-write' | 'admin'
  examples: string[]
}

/**
 * Options for SkillGenerator instantiation
 */
export interface SkillGeneratorOptions {
  program: any // Commander.js program object
  config: DbcliConfig
  permissionLevel: Permission
}
```

These interfaces define the contract that SkillGenerator will use to collect and structure CLI information.
  </action>
  <verify>
    npm run build 2>&1 | grep -q "0 errors" && \
    grep -q "export interface SkillCommand" src/types/index.ts && \
    grep -q "export interface SkillGeneratorOptions" src/types/index.ts && \
    grep -q "permissionLevel:" src/types/index.ts
  </verify>
  <done>
    - SkillCommand interface exported (name, description, args, options, permissionLevel, examples)
    - SkillGeneratorOptions interface exported (program, config, permissionLevel)
    - Types compile without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement SkillGenerator class with CLI introspection and SKILL.md generation</name>
  <files>src/core/skill-generator.ts</files>
  <read_first>
    - src/cli.ts (to understand Commander.js program structure: program.commands, cmd.name(), cmd.description(), cmd.options)
    - src/core/permission-guard.ts (search for PermissionGuard.classify() method to understand statement classification)
    - src/types/index.ts (for SkillCommand, SkillGeneratorOptions, Permission, DbcliConfig types)
    - 09-RESEARCH.md Pattern 1 (pseudo-code example of SkillGenerator structure)
  </read_first>
  <action>
Create src/core/skill-generator.ts with complete SkillGenerator implementation:

**Core responsibilities:**
1. Introspect Commander.js program object to collect all registered commands
2. Extract command name, description, arguments, options from each command
3. Detect permission level required for each command (query-only, read-write, admin)
4. Filter commands based on current permission level from config
5. Generate copy-paste examples for each command
6. Render markdown-formatted SKILL.md with YAML frontmatter

**Class structure:**

```typescript
import type { Command } from 'commander'
import type { SkillCommand, SkillGeneratorOptions, DbcliConfig, Permission } from '@/types'
import { PermissionGuard } from './permission-guard'

export class SkillGenerator {
  constructor(private options: SkillGeneratorOptions) {}

  /**
   * Main entry point: generate complete SKILL.md markdown content
   */
  generateSkillMarkdown(): string {
    const commands = this.collectCommands()
    const filtered = this.filterByPermission(commands)
    return this.renderSkillMarkdown(filtered)
  }

  /**
   * Introspect program.commands and extract SkillCommand[] array
   */
  private collectCommands(): SkillCommand[] {
    const commands: SkillCommand[] = []
    this.options.program.commands.forEach((cmd: Command) => {
      const skillCmd: SkillCommand = {
        name: cmd.name(),
        description: cmd.description() || 'No description',
        args: cmd.args || [],
        options: cmd.options.map((opt: any) => ({
          flag: opt.flags,
          description: opt.description || 'No description',
          required: opt.required ?? false
        })),
        permissionLevel: this.detectPermissionLevel(cmd.name()),
        examples: this.generateExamples(cmd.name())
      }
      commands.push(skillCmd)
    })
    return commands
  }

  /**
   * Detect permission level required for a command by name
   * Uses command names to classify: init, list, schema, query are query-only
   * insert, update are read-write+, delete is admin-only
   */
  private detectPermissionLevel(commandName: string): 'query-only' | 'read-write' | 'admin' {
    if (['delete'].includes(commandName)) return 'admin'
    if (['insert', 'update'].includes(commandName)) return 'read-write'
    return 'query-only'
  }

  /**
   * Filter commands based on current permission level from config
   * Query-only: hide insert, update, delete
   * Read-Write: hide delete
   * Admin: show all
   */
  private filterByPermission(commands: SkillCommand[]): SkillCommand[] {
    const permLevel = this.options.permissionLevel
    return commands.filter(cmd => {
      if (permLevel === 'query-only') {
        return !['insert', 'update', 'delete'].includes(cmd.name)
      }
      if (permLevel === 'read-write') {
        return cmd.name !== 'delete'
      }
      return true
    })
  }

  /**
   * Generate copy-paste examples for each command
   * Examples should be simple and ready to paste into agent context
   */
  private generateExamples(commandName: string): string[] {
    const examples: Record<string, string[]> = {
      init: ['dbcli init'],
      list: ['dbcli list', 'dbcli list --format json'],
      schema: ['dbcli schema users', 'dbcli schema users --format json'],
      query: [
        'dbcli query "SELECT * FROM users LIMIT 10"',
        'dbcli query "SELECT id, email FROM users" --format json'
      ],
      insert: ['dbcli insert users --data \'{"name":"Alice","email":"alice@example.com"}\''],
      update: ['dbcli update users --where "id=1" --set \'{"name":"Bob"}\''],
      delete: ['dbcli delete users --where "id=1" --force'],
      export: [
        'dbcli export "SELECT * FROM users" --format csv --output users.csv',
        'dbcli export "SELECT * FROM users" --format json | jq \'.[]\'']
    }
    return examples[commandName] || [`dbcli ${commandName}`]
  }

  /**
   * Render complete SKILL.md with YAML frontmatter and markdown command reference
   */
  private renderSkillMarkdown(commands: SkillCommand[]): string {
    const frontmatter = `---
name: dbcli
description: Database CLI for AI agents. Use to query, modify, and manage database schemas with permission-based access control.
user-invocable: true
allowed-tools: Bash(dbcli *)
---`

    const header = `# dbcli Skill Documentation

Database CLI for AI agents with permission-based access control.

## Commands`

    const commandDocs = commands
      .map(cmd => this.renderCommandSection(cmd))
      .join('\n\n')

    const footer = `## Permission Levels

dbcli enforces permission-based access control:

- **Query-only**: Execute SELECT queries, list tables, view schemas, export data
- **Read-Write**: Query-only + INSERT and UPDATE operations
- **Admin**: Read-Write + DELETE operations

Your current permission level is set in \`.dbcli\` config and affects which commands are available.

## Tips for AI Agents

1. **Schema introspection first**: Start with \`dbcli schema <table>\` to understand structure
2. **Test with --dry-run**: Use \`--dry-run\` to preview SQL before executing
3. **Use --format json**: AI parsing of JSON is more reliable than tables
4. **Check permission level**: Review \`.dbcli\` to understand what operations are allowed`

    return `${frontmatter}\n\n${header}\n\n${commandDocs}\n\n${footer}`
  }

  /**
   * Render individual command section with usage, options, and examples
   */
  private renderCommandSection(cmd: SkillCommand): string {
    const argsStr = cmd.args.length > 0 ? cmd.args.join(' ') : ''
    const optionsStr = cmd.options.length > 0
      ? cmd.options.map(opt => `- \`${opt.flag}\`: ${opt.description}`).join('\n')
      : 'No options'
    const examplesStr = cmd.examples
      .map(ex => `\`\`\`bash\n${ex}\n\`\`\``)
      .join('\n\n')

    return `### ${cmd.name}

${cmd.description}

**Usage:** \`dbcli ${cmd.name} ${argsStr}\`.trim()

**Options:**
${optionsStr}

**Permission required:** ${cmd.permissionLevel} or higher

**Example:**
${examplesStr}`
  }
}
```

**Key implementation details:**
- Use program.commands to iterate over all registered commands (Commander.js API)
- Extract name, description from cmd.name() and cmd.description()
- Extract options via cmd.options array and map to {flag, description, required}
- Detect permission level by command name (simple hardcoded map, maintainable)
- Filter commands based on this.options.permissionLevel from constructor parameter
- Generate examples as static strings (copy-paste ready for agents)
- Render markdown with proper formatting (code blocks, lists, headers)
  </action>
  <verify>
    npm run build 2>&1 | grep -q "0 errors" && \
    grep -q "class SkillGenerator" src/core/skill-generator.ts && \
    grep -q "generateSkillMarkdown()" src/core/skill-generator.ts && \
    grep -q "private collectCommands" src/core/skill-generator.ts && \
    grep -q "private filterByPermission" src/core/skill-generator.ts && \
    grep -q "private renderSkillMarkdown" src/core/skill-generator.ts
  </verify>
  <done>
    - SkillGenerator class implemented with generateSkillMarkdown() method
    - collectCommands() introspects program.commands and extracts command metadata
    - filterByPermission() hides write operations based on this.options.permissionLevel
    - renderSkillMarkdown() generates valid SKILL.md with frontmatter and command reference
    - All methods have clear responsibility separation
    - Class compiles without TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 3: Export SkillGenerator from core module index</name>
  <files>src/core/index.ts</files>
  <read_first>
    - src/core/index.ts (current exports)
    - src/core/skill-generator.ts (the new class being exported)
  </read_first>
  <action>
Add SkillGenerator export to src/core/index.ts:

```typescript
export { SkillGenerator } from './skill-generator'
```

This enables other modules to import SkillGenerator from the core module barrel export (following project convention).
  </action>
  <verify>
    grep -q "export { SkillGenerator }" src/core/index.ts && \
    npm run build 2>&1 | grep -q "0 errors"
  </verify>
  <done>
    - SkillGenerator exported from src/core/index.ts
    - Build succeeds with no TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 4: Write comprehensive unit tests for SkillGenerator (introspection, filtering, rendering)</name>
  <files>src/core/skill-generator.test.ts</files>
  <read_first>
    - src/core/skill-generator.ts (implementation to test)
    - src/types/index.ts (SkillCommand, SkillGeneratorOptions, DbcliConfig types)
    - vitest.config.ts (test configuration)
    - Any existing *.test.ts file (test patterns in this project)
  </read_first>
  <action>
Create src/core/skill-generator.test.ts with 15+ unit tests covering:

**Test categories:**

1. **Introspection Tests (3-4 tests)**
   - collectCommands() returns array of SkillCommand objects
   - Each SkillCommand has required fields (name, description, args, options, permissionLevel, examples)
   - Command count matches registered commands in program

2. **Permission Filtering Tests (4-5 tests)**
   - Query-only config hides insert, update, delete commands
   - Read-Write config hides delete command only
   - Admin config shows all commands
   - Filtering preserves command order
   - Filtered commands have correct permissionLevel

3. **SKILL.md Rendering Tests (3-4 tests)**
   - Output contains YAML frontmatter with name: dbcli
   - Output contains frontmatter fields: name, description, user-invocable, allowed-tools
   - Output contains command reference sections (# Commands, ## command-name)
   - Output is valid markdown (no unescaped backticks, proper headers)

4. **Example Generation Tests (2-3 tests)**
   - Examples include copy-paste ready commands (dbcli query, dbcli insert, etc.)
   - Examples have at least one per command
   - Examples don't contain placeholder text

**Test structure template:**
```typescript
import { describe, it, expect } from 'bun:test'
import { SkillGenerator } from './skill-generator'
import type { DbcliConfig } from '@/types'

// Create mock program with test commands
function createMockProgram() {
  // Mock Commander.js program with some test commands
  return {
    commands: [
      {
        name: () => 'query',
        description: () => 'Execute SQL query',
        args: [],
        options: [
          { flags: '--format <type>', description: 'Output format', required: false }
        ]
      },
      {
        name: () => 'insert',
        description: () => 'Insert data into table',
        args: ['<table>'],
        options: [
          { flags: '--data <json>', description: 'Data to insert', required: true }
        ]
      }
    ]
  }
}

describe('SkillGenerator', () => {
  describe('Introspection', () => {
    it('collects all commands from program', () => {
      // Test collectCommands() returns array
    })

    it('extracts command metadata correctly', () => {
      // Test command name, description, options extracted
    })
  })

  describe('Permission Filtering', () => {
    it('hides write operations in query-only mode', () => {
      // Test query-only hides insert, update, delete
    })

    it('hides delete in read-write mode', () => {
      // Test read-write hides delete only
    })

    it('shows all commands in admin mode', () => {
      // Test admin shows all
    })
  })

  describe('SKILL.md Rendering', () => {
    it('includes valid YAML frontmatter', () => {
      // Test frontmatter with name, description, allowed-tools
    })

    it('renders markdown command reference', () => {
      // Test command sections are properly formatted
    })

    it('includes examples for each command', () => {
      // Test examples are present and valid
    })
  })
})
```

Use bun:test framework (as specified in CLAUDE.md) and follow existing test patterns in this project.
  </action>
  <verify>
    bun test src/core/skill-generator.test.ts --run 2>&1 | grep -q "pass" && \
    bun test src/core/skill-generator.test.ts --run 2>&1 | grep -v "fail" | grep -q "✓"
  </verify>
  <done>
    - 15+ unit tests created and all passing
    - Tests cover introspection, filtering, rendering, and example generation
    - No failing tests
    - Test file compiles with TypeScript
  </done>
</task>

</tasks>

<verification>
After all tasks complete, verify:

1. **Build passes:** `npm run build` produces 0 TypeScript errors
2. **Tests pass:** `bun test src/core/skill-generator.test.ts --run` shows all tests passing
3. **Type exports:** `grep "export.*SkillCommand\|export.*SkillGeneratorOptions" src/types/index.ts` shows both types
4. **Core export:** `grep "export.*SkillGenerator" src/core/index.ts` shows export present
5. **Integration ready:** SkillGenerator can be imported in next plan (09-02) for CLI integration

Manual verification:
- Read generated SKILL.md output manually to check formatting and permission filtering is correct
- Verify permission-level transitions (query-only has fewer commands than read-write, which has fewer than admin)
</verification>

<success_criteria>
- SkillCommand and SkillGeneratorOptions interfaces defined and exported from src/types/index.ts
- SkillGenerator class fully implemented with introspection, filtering, and rendering methods
- generateSkillMarkdown() produces valid SKILL.md with YAML frontmatter and markdown command reference
- Command filtering respects permission levels (Query-only hides write ops, Read-Write hides delete)
- Skill content reflects actual CLI commands (no hardcoded stale lists)
- 15+ comprehensive unit tests all passing
- Build succeeds with 0 TypeScript errors
- Ready for Plan 09-02 to integrate with CLI commands
</success_criteria>

<output>
After successful execution, create `.planning/phases/09-ai-integration/09-01-SUMMARY.md`
</output>
