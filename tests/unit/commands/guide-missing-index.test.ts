// tests/unit/commands/guide-missing-index.test.ts
import { test, expect } from 'bun:test'
import { Command } from 'commander'
import { resolveSingleQuery, registerMissingIndexCommand } from '@/commands/guide-missing-index'
import { guideCommand } from '@/commands/guide'

test('returns raw SQL unchanged when not an @reference', async () => {
  const sql = await resolveSingleQuery('SELECT 1 FROM t', async () => null)
  expect(sql).toBe('SELECT 1 FROM t')
})

test('resolves a @saved-query to its SQL body', async () => {
  const loader = async (name: string) =>
    name === 'analytics/live' ? [{ name, sql: 'SELECT * FROM live' }] : null
  const sql = await resolveSingleQuery('@analytics/live', loader)
  expect(sql).toBe('SELECT * FROM live')
})

test('throws when @saved-query is not found', async () => {
  await expect(resolveSingleQuery('@nope', async () => null)).rejects.toThrow(/not found/i)
})

test('throws when no query is provided', async () => {
  await expect(resolveSingleQuery('', async () => null)).rejects.toThrow(/no query/i)
})

// Regression: `--format` placed after the `missing-index-for` subcommand must bind
// to the leaf command and not be absorbed by the parent `guide`'s same-named option.
// Requires the parent (and program) to opt in via enablePositionalOptions().
test('--format after subcommand routes to the leaf command', () => {
  // Wire the real parent exactly as cli.ts does, so this guards production setup
  // (program + guide both calling enablePositionalOptions).
  const program = new Command().enablePositionalOptions()
  registerMissingIndexCommand(guideCommand)
  program.addCommand(guideCommand)

  let captured: string | undefined
  const sub = guideCommand.commands.find((c: Command) => c.name() === 'missing-index-for')!
  sub.action(((_q: string, opts: Record<string, unknown>) => {
    captured = opts.format as string
  }) as never)

  program.parse(['node', 'dbcli', 'guide', 'missing-index-for', '--format', 'json', 'SELECT 1'])
  expect(captured).toBe('json')
})
