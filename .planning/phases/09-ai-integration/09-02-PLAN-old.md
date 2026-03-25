---
phase: 09-ai-integration
plan: 02
type: execute
wave: 2
depends_on:
  - 09-01
files_modified:
  - src/commands/skill.ts
  - src/cli.ts
  - src/commands/skill.test.ts
autonomous: true
requirements:
  - AI-01
  - AI-02
  - AI-03
must_haves:
  truths:
    - "`dbcli skill` outputs complete SKILL.md to stdout ready for use"
    - "`dbcli skill --install claude` writes skill to ~/.claude/skills/dbcli/SKILL.md"
    - "`dbcli skill --install cursor` writes skill to .cursor/rules/dbcli.mdc"
    - "`dbcli skill --output <path>` writes skill to specified file"
    - "Skill generation is permission-aware (Query-only user sees different commands than Admin user)"
    - "Skill updates dynamically as CLI capabilities evolve (uses runtime introspection)"
  artifacts:
    - path: src/commands/skill.ts
      provides: "Skill command handler with --install and --output flags"
      exports: "export async function skillCommand(...)"
    - path: src/cli.ts
      provides: "CLI registration of skill command"
      contains: "program.addCommand(skillCommand) or inline skill command registration"
    - path: src/commands/skill.test.ts
      provides: "Integration tests for skill command and installation"
      min_tests: 10
  key_links:
    - from: src/commands/skill.ts
      to: src/core/skill-generator.ts
      via: "SkillGenerator instantiation and generateSkillMarkdown() call"
      pattern: "new SkillGenerator.*generateSkillMarkdown"
    - from: src/commands/skill.ts
      to: src/core/config.ts
      via: "Load .dbcli config to get permission level"
      pattern: "configModule\\.read"
    - from: src/cli.ts
      to: src/commands/skill.ts
      via: "Register skill command with --install and --output options"
      pattern: "skillCommand|skill.*command"
---

<objective>
Implement `dbcli skill` command with installation support for multiple AI platforms. This plan integrates SkillGenerator (from Plan 09-01) into a CLI command that users invoke to generate, display, and install skill documentation.

Purpose: Enable developers to install dbcli skill documentation into their AI agent configuration directories (Claude Code, Gemini CLI, Cursor) with a single command.

Output:
- `dbcli skill` command implementation with --install, --output, and default stdout options
- CLI registration and integration
- Comprehensive integration tests covering all installation scenarios
- Cross-platform path handling for Windows/macOS/Linux
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/09-ai-integration/09-RESEARCH.md
</execution_context>

<context>
## From Plan 09-01: SkillGenerator Infrastructure

SkillGenerator is now available in src/core/skill-generator.ts with:
- Constructor: `new SkillGenerator(options)` where options has {program, config, permissionLevel}
- Method: `generateSkillMarkdown(): string`
- Already filters by permission level
- Already generates valid SKILL.md with frontmatter

## Platform-Specific Installation Paths

From 09-RESEARCH.md:
- **Claude Code:** `~/.claude/skills/dbcli/SKILL.md`
- **Gemini CLI:** `~/.gemini/skills/dbcli/SKILL.md`
- **Copilot CLI:** `.github/skills/dbcli/SKILL.md` (project-local)
- **Cursor:** `.cursor/rules/dbcli.mdc` OR `.cursorrules` (legacy fallback)

## CLI Command Pattern

From src/cli.ts and src/commands/export.ts:
1. Command handler receives options object from Commander.js
2. Load config via configModule.read('.dbcli')
3. Create adapter or other dependencies
4. Perform action
5. Error handling with specific error types (ConnectionError, PermissionError, etc.)

## Directory Creation

Use Bash.sh (Bun's native shell) or native mkdir:
```typescript
await $`mkdir -p ${dir}`.quiet()  // Bun shell API
```

## Cross-Platform Home Directory

```typescript
import { homedir } from 'node:os'
const home = process.env.HOME || homedir()
```

## Cross-Platform Path Handling

Use node:path.join() for cross-platform correctness (Windows backslashes):
```typescript
import * as path from 'node:path'
const skillPath = path.join(home, '.claude', 'skills', 'dbcli', 'SKILL.md')
```
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement skill command handler with --install and --output flag support</name>
  <files>src/commands/skill.ts</files>
  <read_first>
    - src/commands/export.ts (command handler pattern: load config, error handling, etc.)
    - src/cli.ts (shows program object structure)
    - src/core/skill-generator.ts (SkillGenerator class and generateSkillMarkdown() method)
    - src/core/config.ts (configModule.read() usage)
    - 09-RESEARCH.md Pattern 2 (skillCommand pseudo-code and installation logic)
  </read_first>
  <action>
Create src/commands/skill.ts with complete skill command implementation:

```typescript
/**
 * dbcli skill command
 * Generate, display, and install AI agent skill documentation (SKILL.md)
 */

import * as path from 'node:path'
import { homedir } from 'node:os'
import { SkillGenerator } from '@/core/skill-generator'
import { configModule } from '@/core/config'
import type { Command } from 'commander'

export interface SkillOptions {
  install?: string  // Platform: claude, gemini, copilot, cursor
  output?: string   // Custom output file path
}

/**
 * Skill command handler
 * Generates SKILL.md and outputs to stdout, file, or platform directory
 *
 * Usage:
 *   dbcli skill                    # Print to stdout
 *   dbcli skill --output ./skill.md  # Write to file
 *   dbcli skill --install claude   # Install to ~/.claude/skills/dbcli/SKILL.md
 *   dbcli skill --install cursor   # Install to .cursor/rules/dbcli.mdc
 */
export async function skillCommand(
  program: Command,
  options: SkillOptions
): Promise<void> {
  try {
    // 1. Load configuration to get permission level
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" first')
    }

    // 2. Create SkillGenerator
    const skillGen = new SkillGenerator({
      program,
      config,
      permissionLevel: config.permission
    })

    // 3. Generate SKILL.md content
    const skillMarkdown = skillGen.generateSkillMarkdown()

    // 4. Handle output based on options
    if (options.output) {
      // Write to specified file
      await Bun.file(options.output).write(skillMarkdown)
      console.error(`✅ Skill written to ${options.output}`)
      return
    }

    if (options.install) {
      // Install to platform-specific directory
      const installPath = getInstallPath(options.install)
      await ensureDir(path.dirname(installPath))
      await Bun.file(installPath).write(skillMarkdown)
      console.error(`✅ Skill installed for ${options.install} at ${installPath}`)
      return
    }

    // 5. Default: print to stdout (for piping)
    console.log(skillMarkdown)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`❌ Skill generation failed: ${message}`)
    process.exit(1)
  }
}

/**
 * Get platform-specific installation path
 * Handles home directory expansion and cross-platform paths
 */
function getInstallPath(platform: string): string {
  const home = process.env.HOME || homedir()
  const platformLower = platform.toLowerCase()

  switch (platformLower) {
    case 'claude':
      return path.join(home, '.claude', 'skills', 'dbcli', 'SKILL.md')

    case 'gemini':
      return path.join(home, '.gemini', 'skills', 'dbcli', 'SKILL.md')

    case 'copilot':
      return path.join(process.cwd(), '.github', 'skills', 'dbcli', 'SKILL.md')

    case 'cursor':
      // Prefer modern .cursor/rules/*.mdc format
      return path.join(process.cwd(), '.cursor', 'rules', 'dbcli.mdc')

    default:
      throw new Error(
        `Unknown platform: ${platform}. Supported: claude, gemini, copilot, cursor`
      )
  }
}

/**
 * Ensure directory exists, creating parent directories as needed
 * Uses Bun's native shell for cross-platform compatibility
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    // Use Bun's native shell ($) for cross-platform mkdir
    await $`mkdir -p ${dirPath}`.quiet()
  } catch (error) {
    // If shell not available, try Bun.file.mkdir (Bun v1.3.3+)
    const dir = Bun.file(dirPath)
    if (!(await dir.exists())) {
      throw new Error(`Failed to create directory: ${dirPath}`)
    }
  }
}
```

**Key implementation details:**
- skillCommand receives program (Commander.js) and options (--install, --output)
- Load .dbcli config to get permission level for skill filtering
- Create SkillGenerator with program, config, and permission level
- Call generateSkillMarkdown() to get content
- Three output modes: stdout (default), file (--output), installation (--install)
- getInstallPath() maps platform names to correct directories using node:path for cross-platform handling
- ensureDir() creates directories with `mkdir -p` before writing
- All errors caught and logged with helpful messages

**Permission-aware behavior:**
- Skill content is automatically filtered based on config.permission
- Query-only user gets skill without insert/update/delete
- Read-Write user gets skill without delete
- Admin user gets complete skill
  </action>
  <verify>
    npm run build 2>&1 | grep -q "0 errors" && \
    grep -q "export async function skillCommand" src/commands/skill.ts && \
    grep -q "function getInstallPath" src/commands/skill.ts && \
    grep -q "\.claude.*SKILL\.md\|\.gemini.*SKILL\.md\|\.github.*SKILL\.md\|\.cursor.*mdc" src/commands/skill.ts
  </verify>
  <done>
    - skillCommand handler implemented with --install and --output support
    - getInstallPath() returns correct paths for claude, gemini, copilot, cursor platforms
    - ensureDir() creates parent directories before writing files
    - Error handling with helpful messages
    - Cross-platform path handling using node:path.join()
    - Compiles with 0 TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Register skill command in CLI (src/cli.ts)</name>
  <files>src/cli.ts</files>
  <read_first>
    - src/cli.ts (current command registrations)
    - src/commands/skill.ts (the skillCommand function signature)
    - src/commands/export.ts (pattern for inline command registration)
  </read_first>
  <action>
Add skill command registration to src/cli.ts after the export command registration (after line 114):

```typescript
// Register skill command
program
  .command('skill')
  .description('Generate AI agent skill documentation (SKILL.md)')
  .option('--install <platform>', 'Install to platform directory (claude, gemini, copilot, cursor)')
  .option('--output <path>', 'Write skill to file instead of stdout')
  .action(async (options: any) => {
    try {
      await skillCommand(program, options)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })
```

Also add import at top of file:
```typescript
import { skillCommand } from './commands/skill'
```

**Placement in file:**
- Add import with other command imports (around line 4-10)
- Add command registration after export command (after line 114, before closing brace)

**Option descriptions:**
- `--install`: Accepts platform name (claude, gemini, copilot, cursor)
- `--output`: Custom file path for skill output
- If neither flag provided, defaults to stdout

**Error handling:**
- skillCommand errors are caught and logged via process.exit(1)
- Follows pattern used by other commands
  </action>
  <verify>
    npm run build 2>&1 | grep -q "0 errors" && \
    grep -q "import.*skillCommand" src/cli.ts && \
    grep -q "program.*command.*skill" src/cli.ts && \
    grep -q "\-\-install.*platform" src/cli.ts && \
    grep -q "\-\-output.*path" src/cli.ts
  </verify>
  <done>
    - skillCommand imported at top of src/cli.ts
    - skill command registered with --install and --output options
    - Command description provided
    - Error handling follows existing pattern
    - Build succeeds with 0 TypeScript errors
  </done>
</task>

<task type="auto">
  <name>Task 3: Write integration tests for skill command (stdout, file output, installations)</name>
  <files>src/commands/skill.test.ts</files>
  <read_first>
    - src/commands/skill.ts (the function being tested)
    - src/commands/export.test.ts or similar (test patterns in this project)
    - vitest.config.ts (test configuration)
  </read_first>
  <action>
Create src/commands/skill.test.ts with 10+ integration tests covering all scenarios:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { skillCommand } from './skill'
import { configModule } from '@/core/config'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { homedir } from 'node:os'

// Mock program object with test commands
function createMockProgram() {
  return {
    commands: [
      {
        name: () => 'query',
        description: () => 'Execute SQL query',
        args: [],
        options: [{ flags: '--format <type>', description: 'Output format', required: false }]
      },
      {
        name: () => 'insert',
        description: () => 'Insert data into table',
        args: ['<table>'],
        options: [{ flags: '--data <json>', description: 'Data to insert', required: true }]
      },
      {
        name: () => 'delete',
        description: () => 'Delete data from table',
        args: ['<table>'],
        options: [{ flags: '--where <condition>', description: 'WHERE clause', required: true }]
      }
    ]
  }
}

describe('skillCommand', () => {
  let originalConsole: any
  let capturedOutput: string[]

  beforeEach(() => {
    capturedOutput = []
    originalConsole = console.log
    console.log = (...args: any[]) => {
      capturedOutput.push(args.join(' '))
    }
  })

  afterEach(() => {
    console.log = originalConsole
  })

  describe('Default behavior (stdout)', () => {
    it('outputs valid SKILL.md to stdout with frontmatter', async () => {
      // Test that default skill command outputs to stdout
      // Verify output contains YAML frontmatter
      // Verify frontmatter has name: dbcli, description, allowed-tools
    })

    it('includes command reference in output', async () => {
      // Test that output includes ## query, ## insert, etc.
      // Verify command sections have Usage, Options, Examples
    })

    it('respects permission level (query-only hides write ops)', async () => {
      // Test with Query-only permission
      // Verify output doesn't include insert, update, delete commands
      // Verify query, list, schema are present
    })
  })

  describe('File output (--output)', () => {
    it('writes skill to specified file path', async () => {
      // Test --output flag
      // Create temp file path
      // Call skillCommand with --output option
      // Verify file is created and contains SKILL.md content
    })

    it('creates output file in non-existent directory', async () => {
      // Test creating file in new subdirectory
      // Verify parent directories are created
    })

    it('succeeds even if file already exists (overwrites)', async () => {
      // Test overwriting existing file
      // Verify new content replaces old
    })
  })

  describe('Platform installation (--install)', () => {
    it('installs to ~/.claude/skills/dbcli/SKILL.md with --install claude', async () => {
      // Test --install claude
      // Verify path includes ~/.claude/skills/dbcli/SKILL.md
      // Note: Don't actually write to user's home; mock or use temp dir
    })

    it('installs to ~/.gemini/skills/dbcli/SKILL.md with --install gemini', async () => {
      // Test --install gemini
      // Verify correct path
    })

    it('installs to .github/skills/dbcli/SKILL.md with --install copilot', async () => {
      // Test --install copilot
      // Verify project-local path
    })

    it('installs to .cursor/rules/dbcli.mdc with --install cursor', async () => {
      // Test --install cursor
      // Verify MDC file extension and location
    })

    it('rejects unknown platform with helpful error', async () => {
      // Test --install unknown
      // Verify error message suggests valid platforms: claude, gemini, copilot, cursor
    })
  })

  describe('Permission-aware skill content', () => {
    it('Query-only: hides insert, update, delete but shows query, list, schema', async () => {
      // Test with config.permission = 'query-only'
      // Verify skill includes: query, list, schema, export
      // Verify skill excludes: insert, update, delete
    })

    it('Read-Write: hides delete but shows insert, update, query, list', async () => {
      // Test with config.permission = 'read-write'
      // Verify skill includes: query, list, insert, update
      // Verify skill excludes: delete
    })

    it('Admin: shows all commands', async () => {
      // Test with config.permission = 'admin'
      // Verify skill includes all: query, insert, update, delete, list, schema
    })
  })

  describe('Error handling', () => {
    it('requires .dbcli config to exist', async () => {
      // Test when .dbcli doesn't exist
      // Verify error message: "Run dbcli init first"
    })

    it('creates directories for --install if missing', async () => {
      // Test that parent directories are created automatically
      // Verify success message
    })
  })
})
```

**Test coverage:**
- Default stdout output (valid SKILL.md with frontmatter)
- File output (--output flag creates file)
- Platform installations (--install claude/gemini/copilot/cursor)
- Permission-aware filtering (3 tests for different permission levels)
- Error handling (missing config, invalid platform)

**Testing approach:**
- Use Vitest for test framework (per bun:test)
- Mock console.log to capture stdout output
- Mock filesystem operations or use temp directories
- Don't actually write to user's home directory
- Focus on behavior validation, not implementation details
  </action>
  <verify>
    bun test src/commands/skill.test.ts --run 2>&1 | grep -q "pass" && \
    bun test src/commands/skill.test.ts --run 2>&1 | grep -v "fail" | grep -q "✓"
  </verify>
  <done>
    - 10+ integration tests created for skill command
    - Tests cover stdout, file output, and all platform installations
    - Tests verify permission-aware skill content filtering
    - Tests validate error handling
    - All tests passing
  </done>
</task>

<task type="auto">
  <name>Task 4: Run full test suite and verify integration with existing code</name>
  <files></files>
  <read_first>
    - src/cli.ts (skill command registration)
    - src/commands/skill.ts (skill command handler)
    - src/core/skill-generator.ts (from Plan 09-01)
  </read_first>
  <action>
Execute full test suite and verify no regressions:

```bash
# 1. Run full unit test suite (all tests)
bun test --run

# 2. Verify build succeeds
npm run build

# 3. Verify skill command is registered
./dist/cli.mjs skill --help

# 4. Verify skill output (manual spot check)
# Create a temp .dbcli config and run:
# ./dist/cli.mjs skill 2>/dev/null | head -20
# Should output SKILL.md frontmatter and command reference
```

**Success criteria:**
- All tests pass (no failures, all green)
- Build produces 0 TypeScript errors
- `./dist/cli.mjs skill --help` displays command help
- Skill command is listed in main help: `./dist/cli.mjs --help`
- No regressions in existing tests (all 300+ tests should still pass)
  </action>
  <verify>
    bun test --run 2>&1 | grep -E "pass|✓" && \
    npm run build 2>&1 | grep -q "0 errors" && \
    ./dist/cli.mjs skill --help 2>&1 | grep -q "skill" && \
    ./dist/cli.mjs --help 2>&1 | grep -q "skill"
  </verify>
  <done>
    - Full test suite passes (all tests green, no failures)
    - Build succeeds with 0 TypeScript errors
    - `dbcli skill --help` works correctly
    - Skill command appears in main help
    - No regressions in existing functionality
    - Ready for user testing and phase verification
  </done>
</task>

</tasks>

<verification>
After all tasks complete:

1. **Code Integration:**
   - grep "import.*skillCommand" src/cli.ts shows import present
   - grep "command.*skill" src/cli.ts shows registration present
   - SkillGenerator available from src/core/skill-generator.ts

2. **Command Execution:**
   - `./dist/cli.mjs skill --help` returns command help
   - `./dist/cli.mjs --help` includes skill in command list
   - `./dist/cli.mjs skill` outputs valid SKILL.md to stdout

3. **Test Results:**
   - `bun test --run` shows 0 failures
   - `bun test src/commands/skill.test.ts --run` shows 10+ tests passing
   - `bun test src/core/skill-generator.test.ts --run` shows 15+ tests passing (from Plan 09-01)

4. **Functional Verification (manual):**
   - Create temp .dbcli with query-only permission
   - Run `./dist/cli.mjs skill` — verify insert/update/delete commands are hidden
   - Run `./dist/cli.mjs skill --output /tmp/test.md` — verify file is created
   - Run `./dist/cli.mjs skill --install cursor` — verify .cursor/rules/dbcli.mdc is created (or appropriate error if dir not writable)

5. **Requirements Coverage:**
   - AI-01: Create dbcli skill documentation ✓ (SKILL.md generated with command reference)
   - AI-02: Support cross-platform AI agents ✓ (--install supports claude, gemini, copilot, cursor)
   - AI-03: Dynamic skill reflection ✓ (introspection-based, updates with CLI, permission-filtered)
</verification>

<success_criteria>
- skillCommand handler implemented and integrated into CLI
- `dbcli skill` command registered with --install and --output options
- Default behavior: outputs valid SKILL.md to stdout
- `--install <platform>` installs to platform-specific directories (claude, gemini, copilot, cursor)
- `--output <path>` writes skill to specified file
- Skill content is permission-aware (Query-only hides write ops)
- 10+ integration tests all passing
- Full test suite passes with 0 failures
- Build succeeds with 0 TypeScript errors
- No regressions in existing functionality (300+ tests still passing)
- All three requirements (AI-01, AI-02, AI-03) fully satisfied
- Ready for phase verification and user testing
</success_criteria>

<output>
After successful execution, create `.planning/phases/09-ai-integration/09-02-SUMMARY.md`
</output>
