import { test, expect } from 'bun:test'
import * as core from '../../src/core/public'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('public API 暴露 engine 進入點', () => {
  expect(typeof core.AdapterFactory).toBe('function')
  expect(typeof core.QueryExecutor).toBe('function')
  expect(typeof core.SchemaLayeredLoader).toBe('function')
  expect(core.ConnectionError).toBeDefined()
})

test('public API 暴露 config 解析器', () => {
  expect(typeof core.resolveConnection).toBe('function')
  expect(typeof core.listConnections).toBe('function')
  expect(typeof core.readV2Config).toBe('function')
  expect(typeof core.loadConnectionEnv).toBe('function')
  expect(typeof core.detectConfigVersion).toBe('function')
})

test('public API 暴露 blacklist 安全機制', () => {
  expect(typeof core.BlacklistManager).toBe('function')
  expect(typeof core.BlacklistValidator).toBe('function')
  expect(core.BlacklistError).toBeDefined()
})

test('public API 暴露 config-read 入口', () => {
  expect(typeof core.readConfig).toBe('function')
  expect(typeof core.resolveConfigStoragePath).toBe('function')
})

test('resolveConfigStoragePath 對無 binding 的路徑回傳原路徑', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-cfg-'))
  try {
    expect(await core.resolveConfigStoragePath(dir)).toBe(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readConfig 對空目錄回傳預設 config（含 connection + permission）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-cfg-'))
  try {
    const cfg = await core.readConfig(dir)
    expect(cfg).toBeDefined()
    expect(cfg.connection).toBeDefined()
    expect(typeof cfg.permission).toBe('string')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
