import { describe, test, expect } from 'bun:test'
import { collectPermission } from '@/core/inspect/collect-permission'

describe('collectPermission', () => {
  test('query-only: read-only', () => {
    expect(collectPermission('query-only')).toEqual({
      level: 'query-only',
      canWrite: false,
      canDestruct: false,
    })
  })

  test('read-write: writes ok, no destruct', () => {
    expect(collectPermission('read-write')).toEqual({
      level: 'read-write',
      canWrite: true,
      canDestruct: false,
    })
  })

  test('data-admin: writes + destruct on data', () => {
    expect(collectPermission('data-admin')).toEqual({
      level: 'data-admin',
      canWrite: true,
      canDestruct: true,
    })
  })

  test('admin: full', () => {
    expect(collectPermission('admin')).toEqual({
      level: 'admin',
      canWrite: true,
      canDestruct: true,
    })
  })
})
