// Verify the shipped CLI/help contract against the agent-facing skill assets.
//
// The live Commander tree is the source of truth for supported commands and
// flags.  The exhaustive reference must mention every live long option; the
// compact skills may mention a subset, but every flag they mention must exist.
// Command examples are also parsed so a root-only option such as `--use` cannot
// silently drift into a command-level position that Commander rejects.

import type { Command, Option } from 'commander'
import { buildProgram } from '../src/program'
import { buildCompletionTree, listTopLevelCommandNames } from '../src/core/completion/command-tree'

type CommandEntry = {
  path: readonly string[]
  command: Command
}

type Example = {
  file: string
  line: number
  command: string
}

const REFERENCE_PATH = 'assets/reference.md'
const SKILL_PATHS = ['assets/SKILL.md'] as const

// These are options belonging to third-party tools or prose wildcards, not
// dbcli. They are intentionally explicit so a newly documented dbcli flag
// still fails this check instead of being silently ignored.
const NON_DBCLI_FLAGS = new Set(['--env-', '--next-p2', '--schema-only', '--no-data'])

function commandName(command: Command): string {
  return command.name().split(' ')[0] ?? command.name()
}

function flattenCommands(command: Command, parentPath: readonly string[] = []): CommandEntry[] {
  const name = commandName(command)
  const path = name === 'dbcli' ? parentPath : [...parentPath, name]
  const entries: CommandEntry[] = [{ path, command }]
  for (const child of command.commands) entries.push(...flattenCommands(child, path))
  return entries
}

function longOptions(command: Command): Set<string> {
  return new Set(
    command.options.map((option) => option.long).filter((flag): flag is string => !!flag)
  )
}

function optionTakesValue(option: Option): boolean {
  return option.required || option.optional
}

function optionFor(command: Command, token: string): Option | undefined {
  const flag = token.split('=', 1)[0]
  return command.options.find((option) => option.long === flag || option.short === flag)
}

function extractFlags(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/(?<![A-Za-z0-9_])--[a-z][a-z0-9-]*/g)]
      .map((match) => match[0]!)
      .filter((flag) => !NON_DBCLI_FLAGS.has(flag) && !flag.endsWith('-'))
  )
}

function hasTopLevelHeading(reference: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^#{2,4}\\s+\`?(?:dbcli\\s+)?${escaped}(?:[\\s\`]|$)`, 'im').test(reference)
}

function tokenize(line: string): string[] {
  return [...line.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|[^\\s]+/g)].map(
    (match) => match[0]!
  )
}

function collectExamples(file: string, source: string): Example[] {
  const examples: Example[] = []
  const lines = source.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*\$?\s*(dbcli(?:\s|$).*)$/.exec(lines[index] ?? '')
    if (!match) continue

    let command = match[1]!.trim()
    const line = index + 1
    while (/\\\s*$/.test(command) && index + 1 < lines.length) {
      command = `${command.replace(/\\\s*$/, '')} ${(lines[++index] ?? '').trim()}`
    }
    examples.push({ file, line, command })
  }

  return examples
}

function validateExample(example: Example, root: Command): string[] {
  const tokens = tokenize(example.command)
  const problems: string[] = []
  if (tokens[0] !== 'dbcli') return problems

  let index = 1
  let current = root

  // Root options are only valid before the command path. This is the exact
  // placement rule that makes `dbcli --use prod status` valid while
  // `dbcli status --use prod` is rejected with a copyable hint.
  while (index < tokens.length && tokens[index]!.startsWith('-')) {
    const token = tokens[index]!
    if (token === '--') break
    const option = optionFor(root, token)
    if (!option) {
      problems.push(`${example.file}:${example.line}: unknown root option ${token}`)
      index += 1
      continue
    }
    index += 1
    if (optionTakesValue(option) && !token.includes('=') && index < tokens.length) index += 1
  }

  const path: string[] = []
  while (index < tokens.length && !tokens[index]!.startsWith('-')) {
    const token = tokens[index]!
    if (token === '#' || token.startsWith('<') || token.startsWith('[')) break
    const child = current.commands.find((candidate) => commandName(candidate) === token)
    if (!child) break
    path.push(commandName(child))
    current = child
    index += 1
  }

  if (path.length === 0) return problems

  const pathLabel = path.join(' ')
  while (index < tokens.length) {
    const token = tokens[index]!
    if (token === '#') break
    if (!token.startsWith('-')) {
      index += 1
      continue
    }
    if (token === '--') break

    const option = optionFor(current, token)
    if (!option) {
      problems.push(
        `${example.file}:${example.line}: ${pathLabel} does not support ${token}; ` +
          'place root options before the command or update the command contract'
      )
      index += 1
      continue
    }
    index += 1
    if (optionTakesValue(option) && !token.includes('=') && index < tokens.length) index += 1
  }

  return problems
}

async function read(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`Missing CLI contract surface: ${path}`)
  return file.text()
}

const root = buildProgram()
const entries = flattenCommands(root)
const rootEntry = entries.find((entry) => entry.path.length === 0)
if (!rootEntry) throw new Error('Unable to locate root dbcli command')

const reference = await read(REFERENCE_PATH)
const skills = await Promise.all(SKILL_PATHS.map((path) => read(path)))
const problems: string[] = []

const liveLongFlags = new Set<string>()
for (const entry of entries) {
  for (const flag of longOptions(entry.command)) liveLongFlags.add(flag)

  // Commander is the live help renderer. Every registered option must be
  // visible in that command's actual --help output.
  const help = entry.command.helpInformation()
  for (const flag of longOptions(entry.command)) {
    if (!help.includes(flag)) {
      problems.push(`${entry.path.join(' ') || 'dbcli'} --help is missing ${flag}`)
    }
  }
}

const referenceFlags = extractFlags(reference)
for (const flag of [...liveLongFlags].sort()) {
  if (!referenceFlags.has(flag)) {
    problems.push(`${REFERENCE_PATH} is missing live flag ${flag}`)
  }
}
for (const flag of [...referenceFlags].sort()) {
  if (!liveLongFlags.has(flag)) {
    problems.push(`${REFERENCE_PATH} documents unsupported flag ${flag}`)
  }
}

for (const [index, skill] of skills.entries()) {
  const path = SKILL_PATHS[index]!
  for (const flag of [...extractFlags(skill)].sort()) {
    if (!liveLongFlags.has(flag)) problems.push(`${path} documents unsupported flag ${flag}`)
  }
}

const topLevelCommands = listTopLevelCommandNames(buildCompletionTree(root)).filter(
  (command) => command !== 'help'
)
for (const command of topLevelCommands) {
  if (!hasTopLevelHeading(reference, command)) {
    problems.push(`${REFERENCE_PATH} is missing command heading ${command}`)
  }
}

for (const [path, source] of [
  [REFERENCE_PATH, reference],
  ...SKILL_PATHS.map((path, index) => [path, skills[index]!] as const),
] as const) {
  for (const example of collectExamples(path, source)) {
    problems.push(...validateExample(example, root))
  }
}

if (problems.length > 0) {
  console.error('✗ CLI/help/skill/reference contract check failed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `✓ CLI contract aligned: ${entries.length - 1} command paths, ${liveLongFlags.size} live long flags, ${SKILL_PATHS.length + 1} documentation surfaces`
)
