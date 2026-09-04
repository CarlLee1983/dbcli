/**
 * Capability catalog — unit tests (DBCLI-PLAT-001).
 *
 * The catalog is a published contract, so these assert the properties an
 * external consumer relies on: stable ordering, unique ids, no invented engine
 * or risk claims, and nothing resembling a credential in the payload.
 */
import { describe, expect, test } from 'bun:test'
import {
  CAPABILITIES,
  CAPABILITY_CONTRACT_SCHEMA_VERSION,
  CAPABILITY_DECLARATIONS,
  buildCapabilityCatalog,
  findCapability,
  listCapabilityIds,
  riskForSideEffect,
} from '@/core/capabilities'
import { CapabilitySchema, CapabilityCatalogSchema } from '@/core/capabilities/schema'
import { COMMAND_CAPABILITY_KEYS, ENGINE_CAPABILITIES } from '@/adapters/capabilities'
import { DATABASE_SYSTEMS } from '@/adapters/types'
import { minimumPermissionFor } from '@/core/permission-guard'

describe('capability catalog', () => {
  test('is sorted by id and therefore deterministic across builds', () => {
    const ids = CAPABILITIES.map((capability) => capability.id)
    expect(ids).toEqual([...ids].sort())
  })

  test('emits byte-identical JSON on repeated calls', () => {
    expect(JSON.stringify(buildCapabilityCatalog())).toBe(JSON.stringify(buildCapabilityCatalog()))
  })

  test('ids are unique', () => {
    const ids = listCapabilityIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('carries the contract schema version, not the package version', () => {
    const catalog = buildCapabilityCatalog()
    expect(catalog.schemaVersion).toBe(CAPABILITY_CONTRACT_SCHEMA_VERSION)
    expect(catalog.schemaVersion).toBe(1)
  })

  test('every capability satisfies the strict schema', () => {
    for (const capability of CAPABILITIES) {
      expect(() => CapabilitySchema.parse(capability)).not.toThrow()
    }
    expect(() => CapabilityCatalogSchema.parse(buildCapabilityCatalog())).not.toThrow()
  })

  test('the strict schema rejects an unknown field', () => {
    const [first] = CAPABILITIES
    expect(() => CapabilitySchema.parse({ ...first, extra: true })).toThrow()
  })

  test('the strict schema rejects an unknown schemaVersion', () => {
    expect(() =>
      CapabilityCatalogSchema.parse({ ...buildCapabilityCatalog(), schemaVersion: 2 })
    ).toThrow()
  })

  test('engines are drawn only from the supported roster', () => {
    for (const capability of CAPABILITIES) {
      for (const engine of capability.engines) {
        expect(DATABASE_SYSTEMS).toContain(engine)
      }
    }
  })

  test('engine lists match ENGINE_CAPABILITIES rather than a second table', () => {
    for (const declaration of CAPABILITY_DECLARATIONS) {
      const capability = findCapability(declaration.id)!
      if (capability.engineIndependent) continue

      const expected = DATABASE_SYSTEMS.filter((system) => {
        const status = ENGINE_CAPABILITIES[system][declaration.key].status
        return status === 'supported' || status === 'limited'
      })
      expect(capability.engines).toEqual(expected)
    }
  })

  test('an engine-independent capability lists every engine', () => {
    for (const capability of CAPABILITIES) {
      if (!capability.engineIndependent) continue
      expect(capability.engines).toEqual([...DATABASE_SYSTEMS])
    }
  })

  test('risk is derived from the published side-effect tier', () => {
    for (const capability of CAPABILITIES) {
      expect(capability.risk).toBe(riskForSideEffect(capability.sideEffect))
    }
  })

  test('every declaration names a real engine matrix key', () => {
    for (const declaration of CAPABILITY_DECLARATIONS) {
      expect(COMMAND_CAPABILITY_KEYS).toContain(declaration.key)
    }
  })

  test('every engine matrix key is represented by at least one capability', () => {
    const covered = new Set(CAPABILITY_DECLARATIONS.map((declaration) => declaration.key))
    for (const key of COMMAND_CAPABILITY_KEYS) {
      expect(covered.has(key)).toBe(true)
    }
  })

  test('a write capability never claims readonly risk', () => {
    for (const capability of CAPABILITIES) {
      if (capability.sideEffect === 'db-write' || capability.sideEffect === 'local-write') {
        expect(capability.risk).toBe('write')
      }
    }
  })

  test('permissions come from the runtime permission ladder, not a copy of it', () => {
    // Compared against `minimumPermissionFor` rather than against a literal:
    // asserting `data.delete` is `data-admin` only restates the declaration and
    // stays green when TIER_GRANTS changes underneath it.
    expect(findCapability('query.read')!.minimumPermission).toBe(minimumPermissionFor('SELECT'))
    expect(findCapability('data.insert')!.minimumPermission).toBe(minimumPermissionFor('INSERT'))
    expect(findCapability('data.update')!.minimumPermission).toBe(minimumPermissionFor('UPDATE'))
    expect(findCapability('data.delete')!.minimumPermission).toBe(minimumPermissionFor('DELETE'))
    expect(findCapability('schema.migrate')!.minimumPermission).toBe(minimumPermissionFor('ALTER'))
  })

  test('limitedEngines is the matrix `limited` subset of engines', () => {
    for (const declaration of CAPABILITY_DECLARATIONS) {
      const capability = findCapability(declaration.id)!
      if (capability.engineIndependent) {
        expect(capability.limitedEngines).toEqual([])
        continue
      }

      const expected = DATABASE_SYSTEMS.filter(
        (system) => ENGINE_CAPABILITIES[system][declaration.key].status === 'limited'
      )
      expect({ id: capability.id, limited: [...capability.limitedEngines] }).toEqual({
        id: capability.id,
        limited: [...expected],
      })
      for (const engine of capability.limitedEngines) {
        expect(capability.engines).toContain(engine)
      }
    }
  })

  test('at least one capability really is limited somewhere, so the field is load-bearing', () => {
    // Guards the assertion above from passing vacuously.
    expect(CAPABILITIES.some((capability) => capability.limitedEngines.length > 0)).toBe(true)
  })

  test('mutatesConfiguration marks the capabilities agent mode refuses', () => {
    const marked = CAPABILITIES.filter((capability) => capability.mutatesConfiguration).map(
      (capability) => capability.id
    )
    expect(marked).toEqual(['blacklist.manage', 'connection.init', 'connection.select'])
  })

  test('ids name tool abilities, never job titles or methods', () => {
    const forbidden = ['dba', 'crud', 'cqrs', 'developer', 'engineer', 'operator', 'review']
    for (const capability of CAPABILITIES) {
      const domain = capability.id.split('.')[0]!
      expect(forbidden).not.toContain(domain)
    }
  })

  test('exposes exactly the contract fields and nothing else', () => {
    const expected = [
      'command',
      'description',
      'engineIndependent',
      'engines',
      'id',
      'limitedEngines',
      'minimumPermission',
      'mutatesConfiguration',
      'requiresConnection',
      'risk',
      'sideEffect',
      'supportsEvidence',
      'supportsJson',
    ]
    for (const capability of CAPABILITIES) {
      expect(Object.keys(capability).sort()).toEqual(expected)
    }
  })

  test('no capability value looks like a host, port, credential or connection string', () => {
    // Checked value by value rather than over the whole JSON blob: a substring
    // scan flags "report" for containing "port" and proves nothing.
    const suspicious =
      /(:\/\/)|(\b\d{2,5}\b)|(localhost)|(127\.0\.0\.1)|(password)|(secret)|(token)/i
    for (const capability of CAPABILITIES) {
      for (const [field, value] of Object.entries(capability)) {
        if (typeof value !== 'string') continue
        expect({ id: capability.id, field, value: suspicious.test(value) }).toEqual({
          id: capability.id,
          field,
          value: false,
        })
      }
    }
  })

  test('uses the DatabaseSystem engine vocabulary, never the task-pack fork', () => {
    const serialized = JSON.stringify(buildCapabilityCatalog())
    expect(serialized).toContain('postgresql')
    expect(serialized).not.toMatch(/"postgres"/)
  })

  test('findCapability fails closed on an unknown id', () => {
    expect(findCapability('schema.reed')).toBeUndefined()
    expect(findCapability('')).toBeUndefined()
  })
})
