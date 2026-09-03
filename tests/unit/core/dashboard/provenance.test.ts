import { test, expect, describe } from 'bun:test'
import {
  DASHBOARD_PROVENANCE_VERSION,
  DashboardProvenanceError,
  MAX_IDENTITY_BYTES,
  MAX_PROVENANCE_BYTES,
  validateDashboardProvenance,
} from '../../../../src/core/dashboard/provenance'

const valid = {
  version: 1,
  connection: { name: 'analytics', system: 'postgresql' },
  savedQuery: { key: '@dau', source: 'shared' },
  permission: 'query-only',
  limit: { state: 'applied', limitApplied: 1000, truncated: true },
}

describe('validateDashboardProvenance', () => {
  test('accepts the closed version 1 shape', () => {
    expect(validateDashboardProvenance(valid)).toEqual({
      version: DASHBOARD_PROVENANCE_VERSION,
      connection: { name: 'analytics', system: 'postgresql' },
      savedQuery: { key: '@dau', source: 'shared' },
      permission: 'query-only',
      limit: { state: 'applied', limitApplied: 1000, truncated: true },
    })
  })

  test('accepts a not-applied limit', () => {
    const provenance = validateDashboardProvenance({
      ...valid,
      limit: { state: 'not-applied', truncated: false },
    })
    expect(provenance.limit).toEqual({ state: 'not-applied', truncated: false })
  })

  test('rejects unknown top-level fields', () => {
    expect(() => validateDashboardProvenance({ ...valid, sqlBody: 'SELECT 1' })).toThrow(
      DashboardProvenanceError
    )
  })

  test('rejects unknown nested fields', () => {
    expect(() =>
      validateDashboardProvenance({
        ...valid,
        connection: { name: 'analytics', system: 'postgresql', host: 'db.internal' },
      })
    ).toThrow(/unknown field/)
  })

  test('rejects a wrong or missing version', () => {
    expect(() => validateDashboardProvenance({ ...valid, version: 2 })).toThrow(/version/)
    const { version: _dropped, ...withoutVersion } = valid
    expect(() => validateDashboardProvenance(withoutVersion)).toThrow(/version/)
  })

  test('rejects invalid enum values', () => {
    expect(() =>
      validateDashboardProvenance({ ...valid, connection: { name: 'a', system: 'sqlite' } })
    ).toThrow(/connection.system/)
    expect(() =>
      validateDashboardProvenance({ ...valid, savedQuery: { key: '@a', source: 'remote' } })
    ).toThrow(/savedQuery.source/)
    expect(() => validateDashboardProvenance({ ...valid, permission: 'root' })).toThrow(
      /permission/
    )
  })

  test('rejects inconsistent limit states', () => {
    expect(() =>
      validateDashboardProvenance({ ...valid, limit: { state: 'not-applied', truncated: true } })
    ).toThrow(/truncated/)
    expect(() =>
      validateDashboardProvenance({
        ...valid,
        limit: { state: 'not-applied', truncated: false, limitApplied: 10 },
      })
    ).toThrow(/unknown field/)
    expect(() =>
      validateDashboardProvenance({ ...valid, limit: { state: 'applied', truncated: false } })
    ).toThrow(/limitApplied/)
    expect(() =>
      validateDashboardProvenance({
        ...valid,
        limit: { state: 'applied', limitApplied: 0, truncated: false },
      })
    ).toThrow(/positive integer/)
    expect(() => validateDashboardProvenance({ ...valid, limit: { state: 'capped' } })).toThrow(
      /limit.state/
    )
  })

  test('rejects an over-long connection name or saved-query key', () => {
    const tooLong = 'a'.repeat(MAX_IDENTITY_BYTES + 1)
    expect(() =>
      validateDashboardProvenance({ ...valid, connection: { name: tooLong, system: 'mysql' } })
    ).toThrow(/512 UTF-8 bytes/)
    expect(() =>
      validateDashboardProvenance({ ...valid, savedQuery: { key: tooLong, source: 'local' } })
    ).toThrow(/512 UTF-8 bytes/)
  })

  test('counts identity limits in UTF-8 bytes, not characters', () => {
    // 171 three-byte characters = 513 bytes but only 171 characters.
    const multibyte = '連'.repeat(171)
    expect(multibyte.length).toBeLessThan(MAX_IDENTITY_BYTES)
    expect(() =>
      validateDashboardProvenance({ ...valid, connection: { name: multibyte, system: 'mysql' } })
    ).toThrow(/512 UTF-8 bytes/)
  })

  test('stays under the 4 KiB encoded cap at maximum identity lengths', () => {
    const name = 'n'.repeat(MAX_IDENTITY_BYTES)
    const provenance = validateDashboardProvenance({
      ...valid,
      connection: { name, system: 'mysql' },
      savedQuery: { key: name, source: 'local' },
    })
    expect(Buffer.byteLength(JSON.stringify(provenance), 'utf8')).toBeLessThanOrEqual(
      MAX_PROVENANCE_BYTES
    )
  })
})
