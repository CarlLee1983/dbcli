import { test, expect } from 'bun:test'
import * as core from '../../src/core/public'

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
