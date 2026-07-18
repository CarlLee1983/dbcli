import { describe, test, expect } from 'bun:test'
import { buildSchemaContext, loadSchemaContext } from '@/core/lint/context'
import { SchemaWriter } from '@/core/schema-writer'
import type { TableSchema } from '@/adapters/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const users: TableSchema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'email', type: 'varchar(255)', nullable: true },
  ],
}

describe('buildSchemaContext', () => {
  test('unavailable when schema is undefined or empty', () => {
    expect(buildSchemaContext(undefined).available).toBe(false)
    expect(buildSchemaContext({}).available).toBe(false)
  })

  test('resolves table and column case-insensitively', () => {
    const ctx = buildSchemaContext({ users })
    expect(ctx.available).toBe(true)
    expect(ctx.getTable('USERS')?.name).toBe('users')
    expect(ctx.resolveColumn(['users'], 'EMAIL')?.column.type).toBe('varchar(255)')
  })

  test('resolveColumn returns undefined for unknown table or column', () => {
    const ctx = buildSchemaContext({ users })
    expect(ctx.resolveColumn(['orders'], 'id')).toBeUndefined()
    expect(ctx.resolveColumn(['users'], 'nope')).toBeUndefined()
  })

  test('loads the named connection from the layered .dbcli/schemas cache', async () => {
    const dbcliPath = await mkdtemp(join(tmpdir(), 'dbcli-lint-schema-'))
    try {
      await new SchemaWriter(dbcliPath).save({ users }, 'staging')
      const ctx = await loadSchemaContext(dbcliPath, 'staging')
      expect(ctx.available).toBe(true)
      expect(ctx.getTable('users')?.columns[0]?.name).toBe('id')
    } finally {
      await rm(dbcliPath, { recursive: true, force: true })
    }
  })
})
