import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { buildProgram } from '@/program'

// Build the eager tree, including skill tasks and other lazily dispatched commands.
const program = buildProgram()
const taskDirectory = join(import.meta.dir, '../../assets/tasks')

function examples(source: string): string[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  const document = frontmatter
    ? (Bun.YAML.parse(frontmatter[1]!) as { steps?: { command: string }[] })
    : undefined
  const steps = (document?.steps ?? []).map((step) => `dbcli ${step.command}`)
  const body = source.slice(frontmatter?.[0].length ?? 0).replace(/\\\r?\n\s*/g, ' ')
  // Inline code and fenced shell lines are separate, so prose flags are not
  // accidentally attached to the preceding command example.
  const inline = [...body.matchAll(/`(dbcli\s+[^`]+)`/g)].map((match) => match[1]!)
  const lines = [...body.matchAll(/^\s*\$?\s*(dbcli(?:\s+.*)?)$/gm)].map((match) => match[1]!)
  return [...steps, ...inline, ...lines]
}

function violations(example: string): string[] {
  // Preserve quoted SQL/JSON as a single argument, including embedded -- text.
  const tokens = example.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'])+/g) ?? []
  let command = program
  const path: string[] = []
  const problems: string[] = []
  let argumentsStarted = false
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '--' || token === '#') break
    if (token.startsWith('-')) {
      const flag = token.split('=')[0]!
      const option = command.options.find((entry) => entry.long === flag || entry.short === flag)
      if (!option && token.startsWith('--')) {
        problems.push(`${path.join(' ') || 'dbcli'} does not declare ${flag}`)
      }
      if (option && (option.required || option.optional) && !token.includes('=')) {
        const next = tokens[index + 1]
        if (next && !next.startsWith('-')) index += 1
      }
      continue
    }
    const child = !argumentsStarted
      ? command.commands.find((entry) => entry.name() === token || entry.aliases().includes(token))
      : undefined
    if (child) {
      command = child
      path.push(command.name())
    } else {
      if (!argumentsStarted && command.commands.length && !command.registeredArguments.length) {
        problems.push(`unknown command ${[...path, token].join(' ')}`)
      }
      argumentsStarted = true
    }
  }
  return problems
}

describe('Task Pack command flags', () => {
  for (const file of Array.from(new Bun.Glob('*.md').scanSync(taskDirectory)).sort()) {
    test(`${file}: every example resolves and declares its long flags`, async () => {
      const source = await Bun.file(join(taskDirectory, file)).text()
      const failures = examples(source).flatMap((example) =>
        violations(example).map((problem) => `${file}: ${problem}\n  ${example}`)
      )
      expect(failures).toEqual([])
    })
  }
})
