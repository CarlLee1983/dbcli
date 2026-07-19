import { describe, expect, test } from 'bun:test'
import {
  COMMAND_CAPABILITY_KEYS,
  ENGINE_CAPABILITIES,
  getEngineCapabilities,
  getEngineCapability,
  supportsCapability,
  type CommandCapabilityKey,
} from 'src/adapters/capabilities'
import type { DatabaseSystem } from 'src/adapters/types'

const ENGINES: DatabaseSystem[] = [
  'postgresql',
  'mysql',
  'mariadb',
  'mongodb',
  'redis',
  'elasticsearch',
]

describe('engine capability registry', () => {
  test('defines every command capability for every engine', () => {
    for (const engine of ENGINES) {
      const caps = getEngineCapabilities(engine)
      for (const key of COMMAND_CAPABILITY_KEYS) {
        expect(caps[key]).toBeDefined()
        expect(['supported', 'limited', 'unsupported', 'not-applicable']).toContain(
          caps[key].status
        )
      }
    }
  })

  test('captures representative feature matrix support decisions', () => {
    expect(getEngineCapability('postgresql', 'migrate').status).toBe('supported')
    expect(getEngineCapability('mysql', 'check').status).toBe('supported')
    expect(getEngineCapability('postgresql', 'check').status).toBe('limited')
    expect(getEngineCapability('mongodb', 'queries').status).toBe('limited')
    expect(getEngineCapability('redis', 'queries').status).toBe('limited')
    expect(getEngineCapability('elasticsearch', 'queries').status).toBe('limited')
    expect(getEngineCapability('mongodb', 'q').status).toBe('limited')
    expect(getEngineCapability('redis', 'schemaFullScan').status).toBe('unsupported')
    expect(getEngineCapability('elasticsearch', 'query').status).toBe('limited')
    expect(getEngineCapability('redis', 'completion').status).toBe('not-applicable')
  })

  test('lint is readonly for SQL engines and unsupported elsewhere', () => {
    for (const engine of ['postgresql', 'mysql', 'mariadb'] as const) {
      expect(getEngineCapability(engine, 'lint')).toEqual(
        expect.objectContaining({ status: 'supported', tier: 'readonly' })
      )
    }
    for (const engine of ['mongodb', 'redis', 'elasticsearch'] as const) {
      expect(getEngineCapability(engine, 'lint').status).toBe('unsupported')
    }
  })

  test('Redis parity pack (v1.21.0): shell / auto-limit / blacklist capabilities', () => {
    const shell = getEngineCapability('redis', 'shell')
    expect(shell.status).toBe('limited')
    expect(shell.tier).toBe('interactive')

    const guard = getEngineCapability('redis', 'queryLimitGuard')
    expect(guard.status).toBe('limited')
    expect(guard.tier).toBe('readonly')

    const blacklist = getEngineCapability('redis', 'blacklist')
    expect(blacklist.status).toBe('limited')
    expect(blacklist.tier).toBe('local-write')
  })

  test('supportsCapability is false for limited and unsupported capabilities', () => {
    expect(supportsCapability('postgresql', 'query')).toBe(true)
    expect(supportsCapability('elasticsearch', 'query')).toBe(false)
    expect(supportsCapability('redis', 'export')).toBe(false)
  })

  test('registry is immutable from callers', () => {
    const caps = getEngineCapabilities('postgresql')
    expect(() => {
      ;(caps.query as { status: string }).status = 'unsupported'
    }).toThrow()
    expect(getEngineCapability('postgresql', 'query').status).toBe('supported')
  })

  test('command key type covers documented command rows', () => {
    const keys: CommandCapabilityKey[] = [...COMMAND_CAPABILITY_KEYS]
    expect(keys).toContain('inspect')
    expect(keys).toContain('report')
    expect(keys).toContain('recover')
    expect(keys).toContain('skill')
  })

  test('registry root export is defined', () => {
    expect(ENGINE_CAPABILITIES).toBeDefined()
  })

  test('feature matrix points maintainers to the capability registry', async () => {
    const text = await Bun.file('docs/feature-matrix.md').text()
    expect(text).toContain('src/adapters/capabilities.ts')
    expect(text).toContain('tests/unit/adapters/capabilities.test.ts')
  })
})
