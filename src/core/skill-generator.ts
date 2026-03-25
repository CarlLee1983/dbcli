import type { Command } from 'commander'
import type { SkillCommand, SkillGeneratorOptions, Permission } from '@/types'

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
   * Gracefully handles missing commands (Phase 7/8 may not be registered yet)
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
   * insert/update → read-write, delete → admin, others → query-only
   */
  private detectPermissionLevel(commandName: string): 'query-only' | 'read-write' | 'admin' {
    if (commandName === 'delete') return 'admin'
    if (['insert', 'update'].includes(commandName)) return 'read-write'
    return 'query-only'
  }

  /**
   * Filter commands based on current permission level
   * CRITICAL FIX: Read from this.options.permissionLevel (not config.permission)
   * Query-only: hide insert, update, delete
   * Read-Write: hide delete
   * Admin: show all
   */
  private filterByPermission(commands: SkillCommand[]): SkillCommand[] {
    const permLevel = this.options.permissionLevel  // ✅ Correct field access
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
   * Graceful fallback for unknown commands
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

Your current permission level is set in \`.dbcli\` config.

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
    const argsStr = cmd.args.length > 0 ? ' ' + cmd.args.join(' ') : ''
    const optionsStr = cmd.options.length > 0
      ? cmd.options.map(opt => `- \`${opt.flag}\`: ${opt.description}`).join('\n')
      : '(No options)'
    const examplesStr = cmd.examples
      .map(ex => `\`\`\`bash\n${ex}\n\`\`\``)
      .join('\n\n')

    return `### ${cmd.name}

${cmd.description}

**Usage:** \`dbcli ${cmd.name}${argsStr}\`

**Options:**
${optionsStr}

**Permission required:** ${cmd.permissionLevel} or higher

**Example:**
${examplesStr}`
  }
}
