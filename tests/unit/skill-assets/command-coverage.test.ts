/**
 * Content contract: every CLI top-level command is documented in reference.md.
 *
 * The skill's `reference.md` is the "exhaustive flags and examples" doc shipped
 * to agents. Nothing else fails when a command is added to (or removed from) the
 * CLI without updating reference.md — this test closes that drift gap by deriving
 * the command list from the live program tree (the real source of truth) and
 * asserting each one has a heading in reference.md.
 *
 * If this fails after you add a command: add a `### <command>` section to
 * assets/reference.md (and run `bun run plugin:sync`).
 */

import { test, expect, describe } from 'bun:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { buildProgram } from '../../../src/program'
import {
  buildCompletionTree,
  listTopLevelCommandNames,
} from '../../../src/core/completion/command-tree'

const REFERENCE_PATH = join(import.meta.dir, '../../../assets/reference.md')

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * reference.md documents commands with a level 2-4 heading, in either style:
 *   `### query`            (bare command)
 *   `### `dbcli shell``     (backticked, with the `dbcli ` prefix)
 * Accept both: optional backtick, optional `dbcli ` prefix, exact command word
 * at a boundary.
 */
function hasCommandHeading(reference: string, command: string): boolean {
  const re = new RegExp(`^#{2,4}\\s+\`?(?:dbcli\\s+)?${escapeRegex(command)}(?:[\\s\`]|$)`, 'im')
  return re.test(reference)
}

describe('reference.md command coverage', () => {
  const reference = readFileSync(REFERENCE_PATH, 'utf8')
  const commands = listTopLevelCommandNames(buildCompletionTree(buildProgram())).filter(
    (c) => c !== 'help'
  )

  test('derives a non-trivial command list from the program tree', () => {
    // Guards against the extraction silently returning [] and vacuously passing.
    expect(commands.length).toBeGreaterThan(20)
  })

  for (const command of commands) {
    test(`documents "${command}" in reference.md`, () => {
      expect(hasCommandHeading(reference, command)).toBe(true)
    })
  }

  test('the heading matcher has teeth (a bogus command is NOT found)', () => {
    expect(hasCommandHeading(reference, 'nonexistent-command-xyz')).toBe(false)
  })
})
