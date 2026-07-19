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

  test('preserves exact schema identifiers and withholds ambiguous folded table lookups', () => {
    const lower: TableSchema = {
      name: 'foo',
      columns: [{ name: 'lower_id', type: 'integer', nullable: false }],
    }
    const quoted: TableSchema = {
      name: 'Foo',
      columns: [{ name: 'quoted_id', type: 'integer', nullable: false }],
    }
    const ctx = buildSchemaContext({ foo: lower, Foo: quoted })

    expect(ctx.getTable('foo')?.name).toBe('foo')
    expect(ctx.getTable('Foo')?.name).toBe('Foo')
    expect(ctx.getTable('FOO')).toBeUndefined()
  })

  test('withholds ambiguous folded column lookups but preserves exact columns', () => {
    const collision: TableSchema = {
      name: 'collision',
      columns: [
        { name: 'code', type: 'integer', nullable: false },
        { name: 'Code', type: 'text', nullable: true },
      ],
    }
    const ctx = buildSchemaContext({ collision })

    expect(ctx.resolveColumn(['collision'], 'code')?.column.type).toBe('integer')
    expect(ctx.resolveColumn(['collision'], 'Code')?.column.type).toBe('text')
    expect(ctx.resolveColumn(['collision'], 'CODE')).toBeUndefined()
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
