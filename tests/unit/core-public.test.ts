import { test, expect } from 'bun:test'
import * as core from '../../src/core/public'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('public API 暴露 engine 進入點', () => {
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

/**
 * 第五輪對抗式複查（HIGH）：`AdapterFactory` 在已發佈表面上，等於一扇繞過
 * 所有 gate 的門。
 *
 * `AdapterFactory.createElasticsearchAdapter(conn).request('DELETE', '/orders')`
 * 不經 permission、不經 blacklist、不寫 audit——這條分支花了五輪把 shell 那扇門
 * 補起來，門旁邊卻一直開著這扇窗。CLI 使用者進不來，`./core` 的消費者可以。
 *
 * 現在關掉的成本近乎零：預定消費者 `dbcli-gui` 尚未建出，沒有人 import 它。
 * 等到有人 import 之後再關，就是 breaking change。
 */
test('public API 不暴露未經 gate 的 adapter 工廠', () => {
  expect('AdapterFactory' in core).toBe(false)
})

/**
 * Capability contract on the published `./core` surface (DBCLI-PLAT-001).
 *
 * External Skills pin these names. Exporting them is the deliverable; the
 * point of the test is that a refactor cannot quietly drop one.
 */
test('public API 暴露 capability contract', () => {
  expect(core.CAPABILITY_CONTRACT_SCHEMA_VERSION).toBe(1)
  expect(typeof core.buildCapabilityCatalog).toBe('function')
  expect(typeof core.findCapability).toBe('function')
  expect(typeof core.listCapabilityIds).toBe('function')
  expect(typeof core.checkCapabilities).toBe('function')
  expect(typeof core.parseRequirements).toBe('function')
  expect(typeof core.parseCapabilityCatalog).toBe('function')
  expect(typeof core.parseCapabilityCheckReport).toBe('function')
  expect(core.CapabilityRequirementError).toBeDefined()
  expect(core.CapabilityContractError).toBeDefined()
  expect(Array.isArray(core.CAPABILITIES)).toBe(true)
})

test('capability contract 在 public 表面上是可往返驗證的', () => {
  const catalog = core.buildCapabilityCatalog()
  expect(core.parseCapabilityCatalog(JSON.parse(JSON.stringify(catalog)))).toBeDefined()

  const report = core.checkCapabilities(['schema.read'], {
    engine: 'postgresql',
    permission: 'query-only',
    connectionName: null,
    agentMode: false,
  })
  expect(report.ok).toBe(true)
  expect(core.parseCapabilityCheckReport(JSON.parse(JSON.stringify(report)))).toBeDefined()
})

test('public API 暴露 Operation Envelope v1 parser', () => {
  expect(core.OPERATION_ENVELOPE_SCHEMA_VERSION).toBe(1)
  expect(typeof core.parseOperationEnvelope).toBe('function')

  const parsed = core.parseOperationEnvelope({
    schemaVersion: 1,
    ok: true,
    operation: 'capabilities.check',
    status: 'succeeded',
    context: null,
    data: {
      required: ['schema.read'],
      results: [{ id: 'schema.read', status: 'available', reason: null }],
    },
    warnings: [],
    evidence: [],
    recovery: null,
    error: null,
  })
  expect(parsed.ok).toBe(true)

  const catalogEnvelope = core.parseOperationEnvelope({
    schemaVersion: 1,
    ok: true,
    operation: 'capabilities.list',
    status: 'succeeded',
    context: null,
    data: core.buildCapabilityCatalog(),
    warnings: [],
    evidence: [],
    recovery: null,
    error: null,
  })
  expect(catalogEnvelope.ok).toBe(true)
})
