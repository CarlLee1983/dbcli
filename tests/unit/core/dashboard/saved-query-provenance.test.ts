import { test, expect, describe } from 'bun:test'
import { buildSavedQueryProvenance } from '../../../../src/core/dashboard/saved-query-provenance'
import { DashboardProvenanceError } from '../../../../src/core/dashboard/provenance'

const base = {
  connectionName: 'analytics',
  system: 'postgresql',
  savedQueryKey: '@dau',
  savedQuerySource: 'shared',
  permission: 'query-only',
}

describe('buildSavedQueryProvenance', () => {
  test('describes an execution governed by an applied limit', () => {
    expect(
      buildSavedQueryProvenance({ ...base, appliedLimit: { truncated: true, limitApplied: 1000 } })
    ).toEqual({
      version: 1,
      connection: { name: 'analytics', system: 'postgresql' },
      savedQuery: { key: '@dau', source: 'shared' },
      permission: 'query-only',
      limit: { state: 'applied', limitApplied: 1000, truncated: true },
    })
  })

  test('distinguishes an execution with no applied limit', () => {
    expect(buildSavedQueryProvenance(base).limit).toEqual({
      state: 'not-applied',
      truncated: false,
    })
  })

  test('rejects missing provenance rather than guessing it', () => {
    for (const missing of [
      'connectionName',
      'system',
      'savedQueryKey',
      'savedQuerySource',
      'permission',
    ] as const) {
      const input = { ...base, [missing]: undefined } as unknown as typeof base
      expect(() => buildSavedQueryProvenance(input)).toThrow(DashboardProvenanceError)
    }
  })

  test('rejects a system or permission outside the contract', () => {
    expect(() => buildSavedQueryProvenance({ ...base, system: 'sqlite' })).toThrow(/system/)
    expect(() => buildSavedQueryProvenance({ ...base, permission: 'root' })).toThrow(/permission/)
  })
})
