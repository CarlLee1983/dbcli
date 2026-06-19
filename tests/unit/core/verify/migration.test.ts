import { describe, test, expect } from 'bun:test'
import {
  isSingleStatement,
  isAlterTableDdl,
  extractAlterTableTarget,
  ddlTargetMatchesTable,
  classifyMigrationDdl,
} from '@/core/verify/migration'

describe('migration DDL classification', () => {
  test('isSingleStatement ignores a trailing semicolon and literals', () => {
    expect(isSingleStatement('ALTER TABLE users ADD COLUMN a int')).toBe(true)
    expect(isSingleStatement('ALTER TABLE users ADD COLUMN a int;')).toBe(true)
    expect(isSingleStatement("ALTER TABLE users ADD COLUMN a text DEFAULT 'a;b'")).toBe(true)
    expect(isSingleStatement('ALTER TABLE users ADD a int; DROP TABLE users')).toBe(false)
  })

  test('isAlterTableDdl accepts ALTER TABLE forms only', () => {
    expect(isAlterTableDdl('ALTER TABLE users ADD COLUMN a int')).toBe(true)
    expect(isAlterTableDdl('alter   table public.users add column a int')).toBe(true)
    expect(isAlterTableDdl('CREATE TABLE users (id int)')).toBe(false)
    expect(isAlterTableDdl('CREATE INDEX idx ON users (id)')).toBe(false)
    expect(isAlterTableDdl('DROP TABLE users')).toBe(false)
    expect(isAlterTableDdl('ALTER INDEX idx RENAME TO idx2')).toBe(false)
  })

  test('extractAlterTableTarget returns the qualified target', () => {
    expect(extractAlterTableTarget('ALTER TABLE users ADD a int')).toBe('users')
    expect(extractAlterTableTarget('ALTER TABLE public.users ADD a int')).toBe('public.users')
    expect(extractAlterTableTarget('ALTER TABLE IF EXISTS audit.users ADD a int')).toBe(
      'audit.users'
    )
    expect(extractAlterTableTarget('ALTER TABLE ONLY "Users" ADD a int')).toBe('"Users"')
    expect(extractAlterTableTarget('CREATE TABLE users (id int)')).toBeNull()
  })

  test('ddlTargetMatchesTable is schema-aware', () => {
    expect(ddlTargetMatchesTable('ALTER TABLE public.users ADD a int', 'public.users')).toBe(true)
    expect(ddlTargetMatchesTable('ALTER TABLE public.users ADD a int', 'audit.users')).toBe(false)
    expect(ddlTargetMatchesTable('ALTER TABLE users ADD a int', 'public.users')).toBe(true)
  })

  test('classifyMigrationDdl blocks non-ALTER and multi-statement with bounded reasons', () => {
    expect(classifyMigrationDdl('ALTER TABLE users ADD a int')).toEqual({ ok: true })
    expect(classifyMigrationDdl('CREATE TABLE users (id int)').ok).toBe(false)
    expect(classifyMigrationDdl('DROP TABLE users').ok).toBe(false)
    expect(classifyMigrationDdl('CREATE INDEX idx ON users (id)').ok).toBe(false)
    expect(classifyMigrationDdl('ALTER TABLE users ADD a int; DROP TABLE users').ok).toBe(false)
    const reason = classifyMigrationDdl('CREATE TABLE users (id int)').reason ?? ''
    expect(reason.length).toBeGreaterThan(0)
    expect(reason.length).toBeLessThanOrEqual(200)
  })
})
