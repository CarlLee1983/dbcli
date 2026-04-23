import { test, expect } from 'bun:test'
import { t, t_vars } from '@/i18n/message-loader'

/**
 * Integration tests for i18n functionality
 * Verifies message loading across all message keys
 */

// Test 1: Init command messages load
test('init.welcome message loads', () => {
  const msg = t('init.welcome')
  expect(typeof msg).toBe('string')
  expect(msg.length).toBeGreaterThan(0)
})

// Test 2: Init select_system message loads
test('init.select_system message loads', () => {
  const msg = t('init.select_system')
  expect(typeof msg).toBe('string')
})

// Test 3: Schema description loads
test('schema.description message loads', () => {
  const msg = t('schema.description')
  expect(typeof msg).toBe('string')
})

// Test 4: List description loads
test('list.description message loads', () => {
  const msg = t('list.description')
  expect(typeof msg).toBe('string')
})

// Test 5: Query description loads
test('query.description message loads', () => {
  const msg = t('query.description')
  expect(typeof msg).toBe('string')
})

// Test 6: Insert description loads
test('insert.description message loads', () => {
  const msg = t('insert.description')
  expect(typeof msg).toBe('string')
})

// Test 7: Update description loads
test('update.description message loads', () => {
  const msg = t('update.description')
  expect(typeof msg).toBe('string')
})

// Test 8: Delete description loads
test('delete.description message loads', () => {
  const msg = t('delete.description')
  expect(typeof msg).toBe('string')
})

// Test 9: Export description loads
test('export.description message loads', () => {
  const msg = t('export.description')
  expect(typeof msg).toBe('string')
})

// Test 10: Skill description loads
test('skill.description message loads', () => {
  const msg = t('skill.description')
  expect(typeof msg).toBe('string')
})

// Test 11: Error message interpolation works
test('error.message interpolates variables', () => {
  const msg = t_vars('errors.message', { message: 'test error' })
  expect(msg).toContain('test error')
})

// Test 12: Connection failed error interpolates
test('errors.connection_failed interpolates correctly', () => {
  const msg = t_vars('errors.connection_failed', { message: 'ECONNREFUSED' })
  expect(msg).toContain('ECONNREFUSED')
})

// Test 13: Permission denied interpolates
test('errors.permission_denied interpolates correctly', () => {
  const msg = t_vars('errors.permission_denied', { required: 'admin' })
  expect(msg).toContain('admin')
})

// Test 14: Table not found error interpolates
test('errors.table_not_found interpolates correctly', () => {
  const msg = t_vars('errors.table_not_found', { table: 'users' })
  expect(msg).toContain('users')
})

// Test 15: Invalid JSON error interpolates
test('errors.invalid_json interpolates correctly', () => {
  const msg = t_vars('errors.invalid_json', { message: 'Unexpected token' })
  expect(msg).toContain('Unexpected token')
})

// Test 16: Success inserted interpolates
test('success.inserted interpolates row count', () => {
  const msg = t_vars('success.inserted', { count: 10 })
  expect(msg).toContain('10')
})

// Test 17: Success updated interpolates
test('success.updated interpolates row count', () => {
  const msg = t_vars('success.updated', { count: 5 })
  expect(msg).toContain('5')
})

// Test 18: Success deleted interpolates
test('success.deleted interpolates row count', () => {
  const msg = t_vars('success.deleted', { count: 3 })
  expect(msg).toContain('3')
})

// Test 19: Export exported message interpolates
test('export.exported interpolates count and file', () => {
  const msg = t_vars('export.exported', { count: 100, file: 'data.json' })
  expect(msg).toContain('100')
  expect(msg).toContain('data.json')
})

// Test 20: Skill installed message interpolates
test('skill.installed interpolates path', () => {
  const msg = t_vars('skill.installed', { path: '/home/user/.claude/skills/dbcli/SKILL.md' })
  expect(msg).toContain('/home/user')
  expect(msg).toContain('SKILL.md')
})

// Test 21: Query result count interpolation
test('query.result_count interpolates row count', () => {
  const msg = t_vars('query.result_count', { count: 25 })
  expect(msg).toContain('25')
})

// Test 22: Insert confirm interpolates
test('insert.confirm interpolates count and table', () => {
  const msg = t_vars('insert.confirm', { count: 1, table: 'users' })
  expect(msg).toContain('1')
  expect(msg).toContain('users')
})

// Test 23: Update confirm interpolates
test('update.confirm interpolates table', () => {
  const msg = t_vars('update.confirm', { table: 'posts' })
  expect(msg).toContain('posts')
})

// Test 24: Delete confirm interpolates
test('delete.confirm interpolates table', () => {
  const msg = t_vars('delete.confirm', { table: 'comments' })
  expect(msg).toContain('comments')
})

// Test 25: All command descriptions are non-empty
test('all command descriptions are non-empty strings', () => {
  const commands = [
    'init.description',
    'schema.description',
    'list.description',
    'query.description',
    'insert.description',
    'update.description',
    'delete.description',
    'export.description',
    'skill.description',
  ]

  for (const key of commands) {
    const msg = t(key)
    expect(msg).toBeTruthy()
    expect(msg.length).toBeGreaterThan(0)
    expect(typeof msg).toBe('string')
  }
})
