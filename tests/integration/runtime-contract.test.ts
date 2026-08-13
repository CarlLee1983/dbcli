/**
 * Runtime contract: `engines` must describe the runtimes the bundles can actually run on.
 *
 * v1.54.1 declared `engines.node: ">=18.0.0"` while every published entry point except
 * `./agent-core` failed under Node — `dist/cli.mjs` threw ERR_MODULE_NOT_FOUND on its
 * extensionless `./cli-runtime` import, and `dist/core.mjs` threw `Bun is not defined`.
 * This guard fails in both directions: re-adding `engines.node` without fixing the
 * bundles, or letting `./agent-core` lose the Node compatibility the docs promise.
 */

import { test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'

import { BUILD_HOOK_TIMEOUT_MS, ensureDistBuilt } from '../helpers/ensure-dist'
import pkg from '../../package.json'

const ROOT = resolve(import.meta.dir, '..', '..')

beforeAll(() => {
  ensureDistBuilt(ROOT)
}, BUILD_HOOK_TIMEOUT_MS)

/** Import a built bundle in a bare Node process; returns stderr on failure, '' on success. */
function importUnderNode(bundle: string): string {
  const path = join(ROOT, 'dist', bundle)
  const result = spawnSync(
    'node',
    ['--input-type=module', '-e', `await import(${JSON.stringify(path)})`],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    }
  )
  return result.status === 0 ? '' : (result.stderr || `exit ${result.status}`).trim()
}

test('engines does not claim Node support the CLI bundle cannot honor', () => {
  const declaresNode = 'node' in (pkg.engines as Record<string, string>)
  if (!declaresNode) {
    expect(declaresNode).toBe(false)
    return
  }
  // The declaration is only allowed to stand if the bundles back it up.
  expect(importUnderNode('cli.mjs')).toBe('')
  expect(importUnderNode('core.mjs')).toBe('')
})

test('engines declares the Bun version the CLI actually requires', () => {
  expect((pkg.engines as Record<string, string>).bun).toBeString()
})

test('dist/agent-core.mjs stays importable under Node', () => {
  expect(importUnderNode('agent-core.mjs')).toBe('')
})
