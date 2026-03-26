# Phase 9: AI Integration - Research

**Researched:** 2026-03-25
**Domain:** AI agent skill documentation, cross-platform CLI integration, dynamic skill generation
**Confidence:** HIGH (Claude Code and Gemini CLI), MEDIUM (Cursor, Copilot CLI)

## Summary

Phase 9 implements AI agent-consumable skill documentation for dbcli, enabling the tool to be first-class citizen in AI agent ecosystems. The core insight is that **skills follow a universal SKILL.md format** (Agent Skills open standard) adopted across Claude Code, Gemini CLI, GitHub Copilot CLI, and others. Each platform adds optional extensions (metadata, allowed-tools, invocation control), but the markdown + frontmatter pattern is universal.

**Key finding:** A single `dbcli skill` command can generate a SKILL.md file that works across platforms. Platform-specific installation (`--install claude`, `--install cursor`, etc.) handles directory placement and any platform-specific conversions.

The skill should be dynamically generated from the current CLI state (via Commander.js introspection) and permission level from `.dbcli` config, ensuring it reflects actual capabilities rather than hardcoded documentation.

**Primary recommendation:** Implement `dbcli skill` command that (1) introspects all CLI commands via Commander.js, (2) filters by current permission level, (3) generates a SKILL.md with command reference and copy-paste examples, and (4) provides `--install` to place the skill in platform-specific directories.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-01 | Create dbcli skill documentation (Claude Code compatible format) | SKILL.md format researched; aligns with Agent Skills standard; Claude Code extensions documented |
| AI-02 | Support cross-platform AI agents (Claude Code, Gemini, Copilot CLI, Cursor, IDEs) | All platforms adopt SKILL.md; platform-specific installation paths identified; no conflicts |
| AI-03 | Dynamic skill reflection (skill updates as CLI capabilities evolve) | Commander.js introspection enables runtime command discovery; permission filtering verified |

## Standard Stack

### Core Skill Generation & Installation

| Component | Technology | Version | Purpose | Why Standard |
|-----------|-----------|---------|---------|--------------|
| Skill format | SKILL.md (Agent Skills standard) | v1 | Universal cross-platform skill definition | Adopted by Claude Code, Gemini CLI, Copilot CLI; future-proof |
| CLI introspection | Commander.js | 13.0+ | Runtime command and option discovery | Already in dbcli; `.commands()` method provides full command tree |
| Config integration | .dbcli JSON + permission guard | Existing | Permission-aware skill content filtering | Existing architecture; no new dependencies |
| File I/O | Bun.file | Built-in | Skill file writing to platform directories | Per CLAUDE.md requirement; zero overhead |

### Platform-Specific Installation Paths

| Platform | Installation Path | Config Format | Supported |
|----------|-------------------|----------------|-----------|
| **Claude Code** | `~/.claude/skills/dbcli/SKILL.md` | SKILL.md with frontmatter | ✓ HIGH confidence |
| **Gemini CLI** | `~/.gemini/skills/dbcli/SKILL.md` | SKILL.md with frontmatter | ✓ HIGH confidence |
| **GitHub Copilot CLI** | `.github/skills/dbcli/SKILL.md` OR `~/.copilot/skills/dbcli/SKILL.md` | SKILL.md with frontmatter | ✓ MEDIUM confidence |
| **Cursor** | `.cursor/rules/dbcli.mdc` OR `.cursorrules` (legacy) | MDC format with YAML frontmatter | ✓ MEDIUM confidence |
| **VS Code Extensions** | `.vscode/settings.json` (via extension) | Extension-specific; skill loading via extension API | ⚠ LOW confidence (extension-dependent) |
| **JetBrains IDEs** | `.idea/codeStyleSettings.xml` (IDE-specific) | IDE-specific config; Copilot integration | ⚠ LOW confidence (IDE-dependent) |

**Note:** Claude Code and Gemini CLI are primary targets (HIGH confidence). Cursor support via legacy `.cursorrules` fallback is safe. VS Code / JetBrains rely on IDE extensions rather than static files.

## Architecture Patterns

### Pattern 1: Dynamic Skill Generation from CLI State

**What:** Introspect the actual CLI at runtime (command names, descriptions, options) and filter by permission level, generating a fresh SKILL.md on each `dbcli skill` invocation.

**When to use:** Always. Skills must reflect current capabilities as dbcli evolves.

**Implementation:**
```typescript
// Pseudo-code: src/core/skill-generator.ts
interface SkillCommand {
  name: string
  description: string
  args: string[]
  options: Array<{ flag: string; description: string; required: boolean }>
  permissionLevel: 'query-only' | 'read-write' | 'admin'
  examples: string[]
}

export class SkillGenerator {
  constructor(
    private program: Command,
    private config: DbcliConfig,
    private permissionLevel: PermissionLevel
  ) {}

  /**
   * Introspect CLI and generate SKILL.md content
   * Filters commands based on current permission level
   * Returns markdown-formatted skill with frontmatter
   */
  generateSkillMarkdown(): string {
    const commands = this.collectCommands()
    const filtered = this.filterByPermission(commands)
    return this.renderSkillMarkdown(filtered)
  }

  private collectCommands(): SkillCommand[] {
    const commands: SkillCommand[] = []

    // Use Commander.js .commands() method to get all registered commands
    this.program.commands.forEach(cmd => {
      commands.push({
        name: cmd.name(),
        description: cmd.description(),
        args: cmd.args || [],
        options: cmd.options.map(opt => ({
          flag: opt.flags,
          description: opt.description,
          required: opt.required ?? false
        })),
        permissionLevel: this.detectPermissionRequirement(cmd.name()),
        examples: this.generateExamples(cmd.name())
      })
    })

    return commands
  }

  private filterByPermission(commands: SkillCommand[]): SkillCommand[] {
    // Query-only: hide insert, update, delete
    // Read-Write: hide delete
    // Admin: show all
    return commands.filter(cmd => {
      if (this.permissionLevel === 'query-only') {
        return !['insert', 'update', 'delete'].includes(cmd.name)
      }
      if (this.permissionLevel === 'read-write') {
        return cmd.name !== 'delete'
      }
      return true
    })
  }

  private renderSkillMarkdown(commands: SkillCommand[]): string {
    // Generate SKILL.md with YAML frontmatter + command reference
    // See "Code Examples" section below
  }
}
```

**Why this pattern:**
- Skill always reflects reality (no manual updates needed)
- Permission level automatically hides restricted commands
- New commands added to CLI automatically appear in skill
- No hardcoded command list to maintain

### Pattern 2: Platform-Specific Installation via `--install` Flag

**What:** Single `dbcli skill` command with optional `--install <platform>` flag that places skill in platform-specific directories with necessary conversions.

**When to use:** When user runs `dbcli skill --install claude` or `dbcli skill --install cursor`.

**Implementation:**
```typescript
// Pseudo-code: src/commands/skill.ts
export async function skillCommand(options: { install?: string; output?: string }) {
  const skillGen = new SkillGenerator(program, config, config.permissionLevel)
  const skillMarkdown = skillGen.generateSkillMarkdown()

  if (options.output) {
    // Write to specified file
    await Bun.file(options.output).write(skillMarkdown)
    console.log(`✓ Skill written to ${options.output}`)
    return
  }

  if (options.install) {
    // Install to platform-specific location
    const platform = options.install.toLowerCase()
    const installPath = this.getInstallPath(platform)

    // Create directories if needed
    await ensureDir(installPath)

    // Write skill with platform-specific conversions
    const content = this.adaptForPlatform(skillMarkdown, platform)
    await Bun.file(installPath).write(content)

    console.log(`✓ Skill installed for ${platform} at ${installPath}`)
    return
  }

  // Default: print to stdout
  console.log(skillMarkdown)
}

private getInstallPath(platform: string): string {
  const home = process.env.HOME || os.homedir()

  switch (platform) {
    case 'claude':
      return `${home}/.claude/skills/dbcli/SKILL.md`
    case 'gemini':
      return `${home}/.gemini/skills/dbcli/SKILL.md`
    case 'copilot':
      return `.github/skills/dbcli/SKILL.md` // Assumes .github dir exists
    case 'cursor':
      return `.cursor/rules/dbcli.mdc`
    default:
      throw new Error(`Unknown platform: ${platform}`)
  }
}

private adaptForPlatform(markdown: string, platform: string): string {
  if (platform === 'cursor') {
    // Cursor uses .mdc format (similar to SKILL.md but stored differently)
    // Content is compatible; just different file extension and location
    return markdown
  }
  // All other platforms use SKILL.md as-is
  return markdown
}
```

**Why this pattern:**
- Single `dbcli skill` command handles all platforms
- `--install` creates directories (user-friendly)
- Skill can be printed to stdout for piping/debugging
- `--output` enables custom placement

### Pattern 3: SKILL.md Structure for CLI Tools

**What:** SKILL.md format with YAML frontmatter describing the skill, followed by command reference and examples.

**When to use:** This is the universal format; use for all platforms except Cursor (which needs .mdc wrapper).

**Template Structure:**
```yaml
---
name: dbcli
description: Database CLI for AI agents. Use to query, modify, and manage database schemas with permission-based access control. Reference available tables, write SQL queries, insert/update data, and export results.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(dbcli *)
---

# dbcli Skill Documentation

Database CLI for AI agents with permission-based access control.

## Commands

### list
List all tables in the connected database.

**Usage:** `dbcli list`
**Permission required:** Query-only or higher
**Output format:** Table or JSON

**Example:**
\`\`\`bash
dbcli list
\`\`\`

### schema [table]
Display schema for a table (or all tables if no table specified).

**Usage:** `dbcli schema [table]`
**Options:**
- `--format <type>`: Output format (table, json; default: table)

**Permission required:** Query-only or higher

**Example:**
\`\`\`bash
dbcli schema users
dbcli schema users --format json
\`\`\`

### query <sql>
Execute SQL query against the database.

**Usage:** `dbcli query "<SQL>"`
**Options:**
- `--format <type>`: Output format (table, json, csv; default: table)
- `--limit <number>`: Override row limit
- `--no-limit`: Disable auto-limit in query-only mode

**Permission required:** Query-only or higher
**Note:** Query-only mode auto-limits to 1000 rows. Read-Write and Admin modes are unlimited.

**Example:**
\`\`\`bash
dbcli query "SELECT * FROM users LIMIT 10"
dbcli query "SELECT id, email FROM users" --format json
\`\`\`

### insert <table>
Insert data into a table.

**Usage:** `dbcli insert <table> --data '<JSON>'`
**Options:**
- `--data <json>`: JSON object to insert (required)
- `--dry-run`: Show generated SQL without executing
- `--force`: Skip confirmation prompt

**Permission required:** Read-Write or Admin
**Example:**
\`\`\`bash
dbcli insert users --data '{"name":"Alice","email":"alice@example.com"}'
\`\`\`

### update <table>
Update data in a table.

**Usage:** `dbcli update <table> --where "<condition>" --set '<JSON>'`
**Options:**
- `--where <condition>`: WHERE clause (required, e.g., "id=1")
- `--set <json>`: Fields to update as JSON (required)
- `--dry-run`: Show generated SQL without executing
- `--force`: Skip confirmation prompt

**Permission required:** Read-Write or Admin
**Example:**
\`\`\`bash
dbcli update users --where "id=1" --set '{"name":"Bob"}'
\`\`\`

### delete <table>
Delete data from a table (Admin-only).

**Usage:** `dbcli delete <table> --where "<condition>" --force`
**Options:**
- `--where <condition>`: WHERE clause (required, e.g., "id=1")
- `--dry-run`: Show generated SQL without executing
- `--force`: Skip confirmation prompt (required for safety)

**Permission required:** Admin
**Example:**
\`\`\`bash
dbcli delete users --where "id=1" --force
\`\`\`

### export <sql>
Export query results to JSON or CSV.

**Usage:** `dbcli export "<SQL>" --format <format> [--output <path>]`
**Options:**
- `--format <format>`: Output format (json or csv; required)
- `--output <path>`: File to write (if omitted, writes to stdout)

**Permission required:** Query-only or higher
**Note:** Query-only mode auto-limits to 1000 rows.

**Example:**
\`\`\`bash
dbcli export "SELECT * FROM users" --format csv --output users.csv
dbcli export "SELECT * FROM users" --format json | jq '.[]'
\`\`\`

## Permission Levels

dbcli enforces permission-based access control:

- **Query-only**: Execute SELECT queries, list tables, view schemas, export data
- **Read-Write**: Query-only + INSERT and UPDATE operations
- **Admin**: Read-Write + DELETE operations

Your current permission level is set in `.dbcli` config and affects which commands are available.

## Error Handling

dbcli provides helpful error messages:

- **Missing table**: "Did you mean: 'users' or 'user_accounts'?" (Levenshtein distance suggestions)
- **Permission denied**: "DELETE not allowed in query-only mode" (clear permission error)
- **Query syntax**: Database-specific error with troubleshooting hints

## Configuration

dbcli reads configuration from `.dbcli` file in your project root:

\`\`\`json
{
  "database": {
    "system": "postgresql",
    "host": "localhost",
    "port": 5432,
    "name": "mydb",
    "user": "postgres"
  },
  "permissionLevel": "query-only"
}
\`\`\`

Run `dbcli init` to set up configuration interactively.

## Tips for AI Agents

1. **Schema introspection first**: Start with `dbcli schema <table>` to understand structure
2. **Test with --dry-run**: Use `--dry-run` to preview SQL before executing
3. **Use --format json**: AI parsing of JSON is more reliable than tables
4. **Check permission level**: Review `.dbcli` to understand what operations are allowed
5. **Large exports**: Use `--limit` or export in chunks for large datasets
```

**Why this structure:**
- YAML frontmatter is recognized by all platforms
- Command reference is scannable and complete
- Examples are copy-paste ready (critical for AI agents)
- Permission info is explicit (reduces errors)
- MDC conversion for Cursor is trivial (just rename file and add description)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI introspection | Manual command registry or hardcoded list | Commander.js `.commands()` method | Maintains single source of truth; auto-updates |
| Permission filtering | If-else chains checking command names | `PermissionGuard.classify()` (existing) | Reuses battle-tested logic; consistent with CLI |
| File I/O and directory creation | Node.js fs module | Bun.file (per CLAUDE.md) + native mkdir | Bun is faster, simpler; satisfies project constraints |
| Cross-platform path handling | String concatenation | Use template literals + `path.join()` from `node:path` | Handles Windows/macOS/Linux differences |
| SKILL.md validation | Manual template checking | Zod schema (existing in project) | Type-safe; consistent error messages |

**Key insight:** The SKILL.md format is simple enough that hand-rolling a generator is tempting, but introspection-based generation is only ~150-200 lines and pays dividends as the CLI evolves.

## Common Pitfalls

### Pitfall 1: Hardcoded Command References
**What goes wrong:** Skill lists commands manually, gets out of sync when new commands are added (Phase 10+).
**Why it happens:** Static documentation is easier to write than introspection code.
**How to avoid:** Use SkillGenerator class with CommanderJS introspection; regenerate on every `dbcli skill` call.
**Warning signs:** Skill doesn't mention a command that exists in CLI help.

### Pitfall 2: Permission Level Misalignment
**What goes wrong:** Skill shows `insert` command to Query-only user, generating failed attempts.
**Why it happens:** Forgetting to read permission level from `.dbcli` config.
**How to avoid:** SkillGenerator filters commands based on `config.permissionLevel` + `PermissionGuard.classify()`.
**Warning signs:** `dbcli skill` output differs between read-only and admin configs.

### Pitfall 3: Installation Directory Not Created
**What goes wrong:** `dbcli skill --install claude` fails with "directory not found".
**Why it happens:** Assuming `~/.claude/skills/` already exists.
**How to avoid:** Use `ensureDir()` before writing; use Bun.file which handles most paths.
**Warning signs:** First-time installation fails silently.

### Pitfall 4: Cursor .cursorrules Format Mismatch
**What goes wrong:** `.cursorrules` works but `.cursor/rules/*.mdc` doesn't get loaded.
**Why it happens:** Different Cursor versions support different formats; MDC is newer but not universally adopted.
**How to avoid:** Support both `.cursorrules` (legacy) and `.cursor/rules/*.mdc` (modern). Default to legacy for compatibility.
**Warning signs:** `dbcli skill --install cursor` installs but Cursor doesn't load it.

### Pitfall 5: Platform-Specific Example Failures
**What goes wrong:** Claude Code runs example verbatim but Gemini CLI syntax varies.
**Why it happens:** Each platform may have different shell environments or argument parsing.
**How to avoid:** Keep examples simple (just command + basic flags); document any platform-specific nuances.
**Warning signs:** "Command not found" or "invalid syntax" errors when agent runs examples.

## Code Examples

### Example 1: CLI Introspection with Commander.js
```typescript
// Source: Commander.js documentation + dbcli src/cli.ts pattern
import { Command } from 'commander'

const program = new Command()
  .name('dbcli')
  .description('Database CLI for AI agents')

program
  .command('query <sql>')
  .description('Execute SQL query')
  .option('--format <type>', 'Output format')
  .action(() => {})

// Introspect all commands at runtime
const commands = program.commands
commands.forEach(cmd => {
  console.log(`Command: ${cmd.name()}`)
  console.log(`Description: ${cmd.description()}`)
  console.log(`Options: ${cmd.options.map(o => o.flags).join(', ')}`)
})
```

### Example 2: Permission-Based Skill Filtering
```typescript
// Source: Existing PermissionGuard + Permission Model (Phase 4)
import { PermissionGuard, PermissionLevel } from '../core/permission-guard'

class SkillGenerator {
  filterCommands(
    allCommands: Command[],
    permissionLevel: PermissionLevel
  ): Command[] {
    return allCommands.filter(cmd => {
      // Use existing PermissionGuard logic
      const classified = PermissionGuard.classify(cmd.name())

      // Query-only blocks write operations
      if (permissionLevel === 'query-only' && classified.isWrite) {
        return false
      }

      // Read-Write blocks delete
      if (permissionLevel === 'read-write' && classified.isDelete) {
        return false
      }

      return true
    })
  }
}
```

### Example 3: SKILL.md Generation with Frontmatter
```typescript
// Source: Claude Code SKILL.md specification
export function generateSkillMarkdown(
  commands: SkillCommand[],
  permissionLevel: string
): string {
  const frontmatter = `---
name: dbcli
description: Database CLI for AI agents. Query, insert, update, and export data with permission-based access control.
user-invocable: true
allowed-tools: Bash(dbcli *)
---`

  const commandDocs = commands
    .map(cmd => generateCommandSection(cmd))
    .join('\n\n')

  return `${frontmatter}\n\n# dbcli Skill\n\n${commandDocs}`
}

function generateCommandSection(cmd: SkillCommand): string {
  return `## ${cmd.name}

${cmd.description}

**Usage:** \`dbcli ${cmd.name} ${cmd.args.join(' ')}\`

${cmd.options.map(opt => `- \`${opt.flag}\`: ${opt.description}`).join('\n')}

**Example:**
\`\`\`bash
${cmd.examples[0] || `dbcli ${cmd.name}`}
\`\`\``
}
```

### Example 4: Cross-Platform Installation
```typescript
// Source: Platform-specific directory structure research
import { Bun } from 'bun'
import * as path from 'node:path'
import * as os from 'node:os'

async function installSkill(
  skillContent: string,
  platform: 'claude' | 'gemini' | 'copilot' | 'cursor'
): Promise<string> {
  const home = process.env.HOME || os.homedir()

  let installPath: string
  switch (platform) {
    case 'claude':
      installPath = path.join(home, '.claude/skills/dbcli/SKILL.md')
      break
    case 'gemini':
      installPath = path.join(home, '.gemini/skills/dbcli/SKILL.md')
      break
    case 'copilot':
      installPath = path.join(process.cwd(), '.github/skills/dbcli/SKILL.md')
      break
    case 'cursor':
      // Prefer .cursor/rules/*.mdc (modern) but fallback to .cursorrules (legacy)
      const modernPath = path.join(process.cwd(), '.cursor/rules/dbcli.mdc')
      const legacyPath = path.join(process.cwd(), '.cursorrules')
      installPath = modernPath
      break
  }

  // Create directories
  const dir = path.dirname(installPath)
  await $`mkdir -p ${dir}`.quiet()

  // Write file
  await Bun.file(installPath).write(skillContent)

  return installPath
}
```

## Platform-Specific Notes

### Claude Code (HIGH Confidence)
- **Format:** SKILL.md in `~/.claude/skills/dbcli/`
- **Frontmatter fields:** name, description, disable-model-invocation, user-invocable, allowed-tools
- **Behavior:** Claude Code loads skill descriptions into context; full skill content loads when invoked or needed
- **Supported:** ✓ All features; this is the primary target

**Example frontmatter:**
```yaml
---
name: dbcli
description: Database CLI for AI agents. Use to query databases with permission-based access.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(dbcli *)
---
```

### Gemini CLI (HIGH Confidence)
- **Format:** SKILL.md in `~/.gemini/skills/dbcli/`
- **Frontmatter fields:** name, description (same as Claude Code)
- **Behavior:** Skills are lazy-loaded; kept in separate directories for clean context
- **Supported:** ✓ All features; identical to Claude Code format

**No format changes needed.**

### GitHub Copilot CLI (MEDIUM Confidence)
- **Format:** SKILL.md in `.github/skills/dbcli/` (project) or `~/.copilot/skills/dbcli/` (user)
- **Frontmatter fields:** name, description (compatible with Claude Code)
- **Behavior:** Skills are discoverable via Copilot CLI skill system
- **Supported:** ✓ Core features; check official docs for latest syntax

**Installation:** Check if `.github/` directory exists; create if needed.

### Cursor (MEDIUM Confidence)
- **Formats:**
  - Modern: `.cursor/rules/dbcli.mdc` (recommended)
  - Legacy: `.cursorrules` in project root (deprecated but still works)
- **Frontmatter fields:** name, description, globs, alwaysApply (MDC format specific)
- **Behavior:** Cursor loads .cursor rules first; falls back to .cursorrules
- **Supported:** ✓ If using legacy .cursorrules format (just copy SKILL.md content)

**Best practice:** Install to `.cursor/rules/dbcli.mdc` for modern Cursor versions; document fallback to `.cursorrules` for older versions.

### VS Code / JetBrains (LOW Confidence)
- **Format:** Extension-specific (not directly installable)
- **Behavior:** IDE extensions for GitHub Copilot or other agents may load skills via their own discovery mechanisms
- **Supported:** ⚠ Depends on IDE extension implementation; not directly supported in Phase 9

**Recommendation:** Document that VS Code/JetBrains users can manually copy dbcli skill content into their extension-specific configuration files.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.2+ |
| Config file | vitest.config.ts (existing) |
| Quick run command | `bun test src/core/skill-generator.test.ts --run` |
| Full suite command | `bun test --run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | `dbcli skill` outputs valid SKILL.md with frontmatter | unit | `bun test src/core/skill-generator.test.ts --run` | ❌ Wave 0 |
| AI-02 | `dbcli skill --install claude` writes to `~/.claude/skills/dbcli/SKILL.md` | integration | `bun test src/commands/skill.test.ts --run` | ❌ Wave 0 |
| AI-02 | `dbcli skill --install cursor` writes to `.cursor/rules/dbcli.mdc` | integration | `bun test src/commands/skill.test.ts --run` | ❌ Wave 0 |
| AI-03 | Skill reflects current permission level (Query-only hides insert/update/delete) | unit | `bun test src/core/skill-generator.test.ts --run` | ❌ Wave 0 |
| AI-03 | Skill reflects current commands (no stale references) | unit | `bun test src/core/skill-generator.test.ts --run` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test src/core/skill-generator.test.ts --run` (fast, unit-focused)
- **Per wave merge:** `bun test --run` (full suite, includes integration tests)
- **Phase gate:** Full suite green + manual verification that `dbcli skill` output is valid SKILL.md before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/core/skill-generator.ts` — SkillGenerator class with introspection and generation
- [ ] `src/commands/skill.ts` — Skill command with --install and --output flags
- [ ] `src/core/skill-generator.test.ts` — Unit tests (frontmatter, filtering, examples)
- [ ] `src/commands/skill.test.ts` — Integration tests (file I/O, directory creation)
- [ ] CLI registration in `src/cli.ts` — Add skill command to program
- [ ] Update `src/types/index.ts` — SkillCommand interface and related types

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | File I/O for skill writing | ✓ | 1.3.3+ | — |
| Commander.js | CLI introspection | ✓ | 13.0.0 | — |
| node:path | Cross-platform path handling | ✓ | Built-in | — |
| node:os | Home directory detection | ✓ | Built-in | — |
| .dbcli config file | Permission level detection | ✓ | Existing | — |
| ~/.claude/skills directory | Claude Code installation | ? | User-dependent | Create if missing |
| ~/.gemini/skills directory | Gemini CLI installation | ? | User-dependent | Create if missing |
| .github/skills directory | Copilot CLI installation | ? | User-dependent | Create if missing |

**Missing dependencies with fallback:**
- `~/.claude/skills/dbcli/`: `--install claude` will create if missing
- `~/.gemini/skills/dbcli/`: `--install gemini` will create if missing
- `.github/skills/dbcli/`: `--install copilot` will create if missing
- `.cursor/rules/`: `--install cursor` will create if missing

**No blocking dependencies:** All required components are available or will be created.

## Open Questions

1. **Should `dbcli skill` auto-generate on each invocation, or cache?**
   - **What we know:** Introspection is fast (~50ms); no performance concern
   - **What's unclear:** User expectation for caching vs. freshness
   - **Recommendation:** Always generate fresh (simplest, most reliable); add `--cached` flag if users report slowness later

2. **How to detect current permission level for skill generation?**
   - **What we know:** `.dbcli` config stores permissionLevel; already readable
   - **What's unclear:** What if `.dbcli` doesn't exist yet (project not initialized)?
   - **Recommendation:** Require `dbcli init` first; if `.dbcli` missing, error with helpful message pointing to `dbcli init`

3. **Should examples include connection setup (`dbcli init`)?**
   - **What we know:** Skill is for already-initialized projects (`.dbcli` exists)
   - **What's unclear:** Should we document init flow in skill or assume prior setup?
   - **Recommendation:** Include link to README for first-time setup; skill itself assumes `.dbcli` exists

4. **How to handle IDE extensions (VS Code, JetBrains)?**
   - **What we know:** Extensions have proprietary config; no standard format
   - **What's unclear:** Should Phase 9 include extension-specific installation, or defer to Phase 10 (Polish)?
   - **Recommendation:** Phase 9 focuses on SKILL.md format; defer IDE extension integration to Phase 10 or future

5. **Should skill include Bun-specific installation instructions?**
   - **What we know:** dbcli runs on Bun; users need to know how to invoke it
   - **What's unclear:** Should skill document `bun run dbcli skill` or assume dbcli is in PATH?
   - **Recommendation:** Assume npm global install (`npm install -g dbcli`); after Phase 10, path will be clear

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual skill documentation | Dynamic generation from CLI state | 2026 (Agent Skills standard adoption) | Skills stay current; no docs maintenance burden |
| Platform-specific instructions | Universal SKILL.md format | 2026 (Claude Code, Gemini CLI, Copilot CLI alignment) | Write once, deploy everywhere |
| Hardcoded permission models | Config-driven filtering | Phase 4 (dbcli) | Skill respects actual permissions |
| Static help text | Generated from introspection | 2026 (AI agent era) | Help text scales with CLI |

**Deprecated:**
- Manual `.cursorrules` files without SKILL.md equivalent (still supported for backward compatibility, but SKILL.md is standard now)
- Platform-specific skill dialects (converging on SKILL.md + frontmatter)

## Sources

### Primary (HIGH confidence)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills) - SKILL.md format, frontmatter fields, supported features
- [Agent Skills Standard](https://agentskills.io) - Universal skill format adopted across Claude Code, Gemini CLI, Copilot CLI
- [Commander.js CLI Documentation](https://github.com/tj/commander.js) - `.commands()` method for introspection

### Secondary (MEDIUM confidence)
- [Gemini CLI Documentation](https://geminicli.com/docs/) - SKILL.md compatibility, skills directory location
- [GitHub Copilot CLI Reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) - Skill support, format compatibility
- [Cursor .cursorrules Documentation](https://docs.cursor.com/context/rules-for-ai) - .cursorrules format, .cursor/rules/*.mdc modern format

### Tertiary (Community/Verified)
- [dotcursorrules.com](https://dotcursorrules.com/) - Cursor rules examples and format specifications
- [awesome-copilot skills](https://github.com/github/awesome-copilot/blob/main/docs/README.skills.md) - GitHub Copilot CLI skill examples

## Metadata

**Confidence breakdown:**
- SKILL.md format: **HIGH** — Claude Code docs comprehensive; Agent Skills standard public; Gemini CLI docs confirm alignment
- Cross-platform support: **MEDIUM** — Cursor confirmed compatible (legacy .cursorrules + modern .cursor/rules); Copilot CLI confirmed via GitHub docs; VS Code/JetBrains extension support LOW (extension-dependent)
- Dynamic generation: **HIGH** — Commander.js introspection proven; permission filtering uses existing PermissionGuard
- Installation flow: **MEDIUM** — Platform paths identified; directory creation straightforward; no edge cases known

**Research date:** 2026-03-25
**Valid until:** 2026-05-01 (AI platform formats stable; skill standard unlikely to change; check before Phase 10 for IDE extension updates)

**Assumptions made:**
- Users have either `~/.claude/`, `~/.gemini/`, or `.github/` directory for skill installation (or are willing to create them)
- dbcli is installed via npm and available in PATH for agent invocation
- `.dbcli` config file exists before skill generation (requirement for permission filtering)
- Agent Skills standard (SKILL.md format) remains stable through Phase 10 release

**Edge cases to handle:**
- `.dbcli` not found → Error with clear message: "Run `dbcli init` first"
- Installation directory doesn't exist → `ensureDir()` creates it
- Multiple permission levels → Skill content updates dynamically on each run
- Windows path separators → Use `node:path` for cross-platform handling
- Stdout buffering for large skill output → Unlikely (<5KB typical); should be fine
