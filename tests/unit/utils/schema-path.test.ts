import { describe, test, expect } from 'bun:test'
import { resolveSchemaPath } from '@/utils/schema-path'
import { join } from 'path'

describe('resolveSchemaPath', () => {
  test('V1 / no connection name → .dbcli/schemas', () => {
    expect(resolveSchemaPath('/proj/.dbcli', undefined)).toBe(join('/proj/.dbcli', 'schemas'))
  })

  test('V2 named → .dbcli/schemas/<name>', () => {
    expect(resolveSchemaPath('/proj/.dbcli', 'prod')).toBe(join('/proj/.dbcli', 'schemas', 'prod'))
  })
})
