/**
 * Where the agent-mode configuration boundary is, stated as a roster.
 *
 * DBCLI-PLAT-012 moved one thing out from behind `assertConfigMutationApproved()`
 * — the schema cache — and nothing else. That is a sentence anyone can write in
 * a commit message; this file is what makes it checkable. It pins the set of
 * modules that call the guard, so removing a call from a writer that still
 * needs one fails here, and it pins that the new cache seam is not among them,
 * so a later edit cannot quietly put the cache back behind the guard or drag a
 * credential writer out from behind it.
 *
 * The roster is a ratchet in the direction that matters: entries may be added
 * (a new writer of connection identity, permission or credentials must guard),
 * and removing one is a boundary change that has to be argued for in a Story,
 * not slipped past in a refactor.
 */

import { describe, test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { assertConfigMutationApproved } from '@/core/config-mutation-guard'
import { ConfigError } from '@/utils/errors'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Every module that refuses a write under `DBCLI_AGENT_MODE=1`.
 *
 * Each one publishes connection identity, a permission level, or a credential:
 * things an untrusted automation context must not change, and for which an
 * environment variable supplied by that same process is not an approval.
 */
const GUARDED = [
  'src/core/config.ts',
  'src/core/config-v2.ts',
  'src/core/config-binding.ts',
  'src/core/connection-credential.ts',
  'src/core/schema-updater.ts',
  'src/commands/credential.ts',
].sort()

/**
 * Modules that must never guard, because they write only derived data.
 *
 * A schema cache is re-readable at any time from the database the config
 * already points at, so refusing to store it protects nothing and makes the
 * capability contract lie about `schema.read`.
 */
const UNGUARDED = ['src/core/schema-cache-persistence.ts']

const read = (path: string) => readFile(new URL(path, `file://${repoRoot}`), 'utf8')

/**
 * Source with comments removed.
 *
 * The seam and the schema command both *discuss* the guard in their header
 * comments — explaining why the cache is not behind it is the whole point of
 * those comments. A scan that counted a mention as a call would force the
 * explanation to be deleted to satisfy the test, which is the wrong direction:
 * the rule is about what the code does, so the check reads only code.
 */
const readCode = async (path: string) =>
  (await read(path)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the guard itself is unchanged', () => {
  test('it refuses under agent mode and is silent outside it', () => {
    const previous = process.env.DBCLI_AGENT_MODE
    try {
      delete process.env.DBCLI_AGENT_MODE
      expect(() => assertConfigMutationApproved()).not.toThrow()

      process.env.DBCLI_AGENT_MODE = '1'
      expect(() => assertConfigMutationApproved()).toThrow(ConfigError)
      expect(() => assertConfigMutationApproved()).toThrow(
        /Agent mode blocks configuration, permission, and credential changes/
      )
    } finally {
      if (previous === undefined) delete process.env.DBCLI_AGENT_MODE
      else process.env.DBCLI_AGENT_MODE = previous
    }
  })

  test('a value other than exactly "1" does not enable it', () => {
    const previous = process.env.DBCLI_AGENT_MODE
    try {
      for (const value of ['0', 'true', 'yes', '']) {
        process.env.DBCLI_AGENT_MODE = value
        expect(() => assertConfigMutationApproved()).not.toThrow()
      }
    } finally {
      if (previous === undefined) delete process.env.DBCLI_AGENT_MODE
      else process.env.DBCLI_AGENT_MODE = previous
    }
  })
})

describe('the roster of guarded writers', () => {
  test('every listed module calls the guard', async () => {
    for (const path of GUARDED) {
      expect(await readCode(path)).toContain('assertConfigMutationApproved()')
    }
  })

  test('no module outside the roster calls the guard', async () => {
    const found = (
      await Array.fromAsync(new Bun.Glob('{src,scripts}/**/*.ts').scan({ cwd: repoRoot }))
    )
      .map((entry) => entry.replaceAll('\\', '/'))
      .filter((path) => path !== 'src/core/config-mutation-guard.ts')

    const callers: string[] = []
    for (const path of found) {
      if ((await readCode(path)).includes('assertConfigMutationApproved()')) callers.push(path)
    }

    expect(callers.sort()).toEqual(GUARDED)
  })

  test('the schema cache seam is not among them', async () => {
    for (const path of UNGUARDED) {
      const source = await readCode(path)
      expect(source).not.toContain('assertConfigMutationApproved')
      expect(source).not.toContain('config-mutation-guard')
    }
  })

  test('the schema command reaches no guarded writer for its cache', async () => {
    // `configModule.write` and `writeV2Config` are whole-config publications and
    // stay guarded; the schema command must not be calling either.
    const source = await readCode('src/commands/schema.ts')
    expect(source).toContain('persistSchemaCache')
    expect(source).not.toContain('configModule.write(')
    expect(source).not.toContain('patchConnectionSchema')
    expect(source).not.toContain('writeV2Config')
  })
})
