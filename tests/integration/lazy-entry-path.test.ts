/**
 * The lazy entry path, exercised through a real process.
 *
 * `buildProgramFor()` (ADR 0007) only runs in `src/cli-runtime.ts`, so nothing
 * that constructs a program in-process can observe it. The unit tests next door
 * compare *declared shape*; this file exists because a command whose behaviour
 * depends on its siblings passes those and is still broken end to end — which
 * is exactly what `completion` did: under a one-command root it emitted a
 * script listing only itself, and `--install` writes that into the user's
 * shell rc.
 */

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function run(...args: string[]): string {
  const result = spawnSync('bun', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
  })
  expect(result.status).toBe(0)
  return result.stdout
}

describe('lazy entry path', () => {
  test.each(['bash', 'zsh', 'fish'])(
    'completion %s describes the whole command tree, not just itself',
    (shell) => {
      const script = run('completion', shell)

      // A truncated script still contains `completion`; the siblings are what
      // disappears when the tree is read off this command's parent.
      for (const command of ['query', 'schema', 'list', 'export', 'impact']) {
        expect(script).toContain(command)
      }
    }
  )

  test('root help lists every top-level command', () => {
    const help = run('--help')

    for (const command of ['query', 'schema', 'list', 'export', 'impact', 'completion']) {
      expect(help).toContain(command)
    }
  })

  test('a lazily dispatched command renders its own full help', () => {
    const help = run('query', '--help')

    expect(help).toContain('Usage: dbcli query')
    for (const flag of ['--format', '--limit', '--no-limit', '--fields', '--slow-ms', '--use']) {
      expect(help).toContain(flag)
    }
  })
})
