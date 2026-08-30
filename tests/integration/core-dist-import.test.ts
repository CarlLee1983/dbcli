import { test, expect, beforeAll } from 'bun:test'
import { resolve, join } from 'node:path'

import { BUILD_HOOK_TIMEOUT_MS, ensureDistBuilt } from '../helpers/ensure-dist'

// 此測試驗證「對外發布的產物」可被 import，等同外部消費者的視角。
// beforeAll 確保測的是當前原始碼；產物已是最新時不會重 build（mirrors dist-smoke.test.ts）。

const ROOT = resolve(import.meta.dir, '..', '..')

beforeAll(() => {
  ensureDistBuilt(ROOT)
}, BUILD_HOOK_TIMEOUT_MS)

test('dist/core.mjs 暴露 engine 進入點', async () => {
  const core = await import(join(ROOT, 'dist', 'core.mjs'))
  expect(typeof core.QueryExecutor).toBe('function')
  expect(typeof core.SchemaLayeredLoader).toBe('function')
  expect(typeof core.listConnections).toBe('function')
  expect(typeof core.BlacklistManager).toBe('function')
  expect(typeof core.readConfig).toBe('function')
  expect(typeof core.resolveConfigStoragePath).toBe('function')

  // 建置產物也要看得到這件事：`AdapterFactory` 給的是一條不經 permission、
  // 不經 blacklist、不寫 audit 的路徑，已從公共表面移除。
  expect('AdapterFactory' in core).toBe(false)
})

test('dist/agent-core.mjs exposes only the stable agent interface', async () => {
  const agentCore = await import(join(ROOT, 'dist', 'agent-core.mjs'))
  expect(Object.keys(agentCore).sort()).toEqual([
    'ConfigError',
    'loadEnvFile',
    'parseConnectionNames',
    'resolveConnectionSelector',
    'resolveEnvRef',
    'trimAppliedLimit',
  ])
})
