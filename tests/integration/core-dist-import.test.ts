import { test, expect, beforeAll } from 'bun:test'
import { existsSync } from 'node:fs'

// 此測試驗證「對外發布的產物」可被 import，等同外部消費者的視角。
// 需先 `bun run build` 產生 dist/core.mjs。

beforeAll(() => {
  if (!existsSync('dist/core.mjs')) {
    throw new Error('dist/core.mjs 不存在 — 請先執行 `bun run build`')
  }
})

test('dist/core.mjs 暴露 engine 進入點', async () => {
  const core = await import('../../dist/core.mjs')
  expect(typeof core.AdapterFactory).toBe('function')
  expect(typeof core.QueryExecutor).toBe('function')
  expect(typeof core.SchemaLayeredLoader).toBe('function')
  expect(typeof core.listConnections).toBe('function')
  expect(typeof core.BlacklistManager).toBe('function')
})
