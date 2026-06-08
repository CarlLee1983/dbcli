import { test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'

// 此測試驗證「對外發布的產物」可被 import，等同外部消費者的視角。
// beforeAll 會重新 build，確保測的是當前原始碼（mirrors dist-smoke.test.ts）。

const ROOT = resolve(import.meta.dir, '..', '..')

beforeAll(() => {
  // Rebuild dist so we test current source, not a stale artifact (mirrors dist-smoke.test.ts).
  // dts-bundle-generator can take ~8s on first run; allow generous timeout.
  const build = spawnSync('bun', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 })
  if (build.status !== 0) {
    throw new Error(`bun run build failed:\n${build.stdout}\n${build.stderr}`)
  }
}, 60_000)

test('dist/core.mjs 暴露 engine 進入點', async () => {
  const core = await import(join(ROOT, 'dist', 'core.mjs'))
  expect(typeof core.AdapterFactory).toBe('function')
  expect(typeof core.QueryExecutor).toBe('function')
  expect(typeof core.SchemaLayeredLoader).toBe('function')
  expect(typeof core.listConnections).toBe('function')
  expect(typeof core.BlacklistManager).toBe('function')
})
