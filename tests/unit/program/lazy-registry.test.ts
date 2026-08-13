/**
 * Contract between the two registration paths.
 *
 * buildProgram() stays eager — check-cli-contract.ts, the completion tree and a
 * dozen tests walk the whole command tree in-process and must keep seeing it.
 * buildProgramFor(argv) registers only the command argv actually names, so a
 * real CLI invocation stops paying for the other ~40 command modules.
 *
 * Two registration paths can drift. These tests are what stops that: the
 * registry must name exactly the commands the eager tree has, and each command
 * built lazily must be indistinguishable from its eager twin — same options,
 * same arguments, same subcommand tree, all the way down.
 */

import { describe, expect, test } from 'bun:test'
import type { Command } from 'commander'
import { buildProgram } from '@/program'
import { buildProgramFor, COMMAND_NAMES } from '@/program-lazy'

function topLevelNames(program: Command): string[] {
  return program.commands.map((command) => command.name().split(' ')[0]!).sort()
}

/** Everything about a command that the CLI/help contract can observe. */
function shape(command: Command) {
  return {
    name: command.name(),
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => ({
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
    })),
    options: command.options
      .map((option) => ({
        flags: option.flags,
        long: option.long,
        short: option.short,
        description: option.description,
        defaultValue: option.defaultValue,
        required: option.required,
        optional: option.optional,
        // A parser moved to the wrong side of the split is exactly the drift
        // this file guards; record its presence, not its identity.
        hasParser: typeof option.parseArg === 'function',
        choices: (option as { argChoices?: string[] }).argChoices,
      }))
      .sort((a, b) => (a.flags < b.flags ? -1 : 1)),
    subcommands: command.commands
      .slice()
      .sort((a, b) => (a.name() < b.name() ? -1 : 1))
      .map(shape),
  }
}

function find(program: Command, name: string): Command {
  const command = program.commands.find((candidate) => candidate.name().split(' ')[0] === name)
  if (!command) throw new Error(`command not registered: ${name}`)
  return command
}

describe('lazy command registry', () => {
  const eager = buildProgram()
  const eagerNames = topLevelNames(eager)

  test('the registry names exactly the commands the eager tree registers', () => {
    expect([...COMMAND_NAMES].sort()).toEqual(eagerNames)
  })

  test.each(eagerNames)('lazily built %s is identical to its eager twin', async (name: string) => {
    const lazy = await buildProgramFor(['node', 'dbcli', name])
    expect(topLevelNames(lazy)).toEqual([name])
    expect(shape(find(lazy, name))).toEqual(shape(find(buildProgram(), name)))
  })

  test('root options are identical on both paths', async () => {
    const lazy = await buildProgramFor(['node', 'dbcli', 'query'])
    expect(shape(lazy).options).toEqual(shape(buildProgram()).options)
  })
})

describe('argv dispatch', () => {
  test.each([
    [['node', 'dbcli', 'query', 'SELECT 1'], 'query'],
    [['node', 'dbcli', '--config', 'x/query', 'schema', 'users'], 'schema'],
    // A root option that takes a value must not have its value read as the
    // command name — '5000' would fall back to eager and silently lose the win.
    [['node', 'dbcli', '--timeout', '5000', 'list'], 'list'],
    [['node', 'dbcli', '--statement-timeout=0', 'inspect'], 'inspect'],
    [['node', 'dbcli', '--use', 'prod', 'export', 'SELECT 1'], 'export'],
    [['node', 'dbcli', '-v', '--global', 'doctor'], 'doctor'],
    [['node', 'dbcli', 'query', '--help'], 'query'],
  ] as Array<[string[], string]>)(
    '%o resolves to a single registered command',
    async (argv, expected) => {
      const program = await buildProgramFor(argv)
      expect(topLevelNames(program)).toEqual([expected])
    }
  )

  test.each([
    ['no command', ['node', 'dbcli']],
    ['root help', ['node', 'dbcli', '--help']],
    ['unknown command', ['node', 'dbcli', 'nonexistent']],
    ['only root options', ['node', 'dbcli', '--verbose']],
    // Everything after `--` is an operand, never a command name.
    ['after a bare --', ['node', 'dbcli', '--', 'query']],
  ] as Array<[string, string[]]>)('%s falls back to the full eager tree', async (_label, argv) => {
    const program = await buildProgramFor(argv)
    expect(topLevelNames(program)).toEqual(topLevelNames(buildProgram()))
  })
})
