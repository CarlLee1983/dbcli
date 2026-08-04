import { describe, test, expect } from 'bun:test'
import * as core from '@/core/public'

describe('public core barrel exposes the connection writer surface', () => {
  test('exports writer + mutations', () => {
    for (const name of [
      'writeV2Config',
      'writeConnectionSecret',
      'envVarNameFor',
      'upsertConnection',
      'removeConnection',
      'setDefaultConnection',
      'migrateV1ToV2',
      'writeProjectBinding',
      'getProjectStoragePath',
      'getDbcliConfigHome',
      'getGlobalConfigPath',
      'isGlobalConfigPath',
    ]) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe('function')
    }
  })
})

describe('public core barrel exposes the data-editing surface', () => {
  test('exports DataExecutor class', () => {
    expect(typeof (core as Record<string, unknown>).DataExecutor).toBe('function')
  })
})
