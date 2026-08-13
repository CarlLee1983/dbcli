/**
 * Runtime contract: `engines` must describe the runtimes the bundles can actually run on.
 *
 * v1.54.1 declared `engines.node: ">=18.0.0"` while every published entry point except
 * `./agent-core` failed under Node — `dist/cli.mjs` threw ERR_MODULE_NOT_FOUND on its
 * extensionless `./cli-runtime` import, and `dist/core.mjs` threw `Bun is not defined`.
 *
 * The guard is a positive control in both directions. While `engines.node` is absent, the
 * CLI bundles must still fail under Node — the day they stop failing, this test says so
 * and the declaration can come back. If `engines.node` is declared, they must load. Either
 * way `importUnderNode` runs every time, so the mechanism cannot rot unnoticed.
 *
 * Deliberately not gated on SKIP_INTEGRATION_TESTS: that flag exists for tests needing a
 * live database (see tests/integration/helpers.ts), and CI sets it on every run — gating
 * here would mean this never executes where it matters. tests/integration/dist-smoke.test.ts
 * ignores it for the same reason.
 */

import { test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BUILD_HOOK_TIMEOUT_MS, ensureDistBuilt } from '../helpers/ensure-dist'
import pkg from '../../package.json'

const ROOT = resolve(import.meta.dir, '..', '..')
const NODE_SPAWN_TIMEOUT_MS = 30_000

const engines = pkg.engines as Record<string, string>

beforeAll(() => {
  ensureDistBuilt(ROOT)
}, BUILD_HOOK_TIMEOUT_MS)

/**
 * Import a built bundle in a bare Node process. Returns '' on success, else the failure
 * text. The path goes through pathToFileURL because Node's dynamic import rejects a
 * Windows drive-letter path with ERR_UNSUPPORTED_ESM_URL_SCHEME.
 */
function importUnderNode(bundle: string): string {
  const url = pathToFileURL(join(ROOT, 'dist', bundle)).href
  const result = spawnSync(
    'node',
    ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: NODE_SPAWN_TIMEOUT_MS,
      env: { ...process.env, NO_COLOR: '1' },
    }
  )
  if (result.status === 0) return ''
  // `node` missing from PATH leaves status null and stderr empty; surface result.error
  // so the failure names the real cause instead of reporting "exit null".
  return [result.error?.message, result.stderr, `exit ${result.status}`]
    .filter(Boolean)
    .join(' ')
    .trim()
}

test('engines and the CLI bundles agree about Node', () => {
  if ('node' in engines) {
    // The declaration only stands if the bundles back it up.
    expect(importUnderNode('cli.mjs')).toBe('')
    expect(importUnderNode('core.mjs')).toBe('')
    return
  }
  // No declaration — assert the reason still holds, so a bundle that becomes
  // Node-safe fails here rather than silently outgrowing the docs.
  expect(importUnderNode('cli.mjs')).not.toBe('')
  expect(importUnderNode('core.mjs')).not.toBe('')
})

test('engines declares the Bun version the CLI actually requires', () => {
  expect(engines.bun).toBeString()
})

test('dist/agent-core.mjs stays importable under Node', () => {
  expect(importUnderNode('agent-core.mjs')).toBe('')
})
