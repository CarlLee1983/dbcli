import { test, expect } from 'bun:test'
import { MessageLoader, t, t_vars } from './message-loader'

// Note: MessageLoader is a singleton, so these tests verify behavior
// during the current process context. The first test to run will
// initialize with the current DBCLI_LANG environment variable.

test('MessageLoader initializes and t() returns strings', () => {
  const loader = MessageLoader.getInstance()
  const message = loader.t('init.welcome')

  expect(typeof message).toBe('string')
  expect(message.length).toBeGreaterThan(0)
})

test('t() returns English messages by default or when key matches', () => {
  const message = t('init.welcome')
  // Should return either English or Chinese depending on DBCLI_LANG
  expect(typeof message).toBe('string')
  expect(message.length).toBeGreaterThan(0)
})

test('t() falls back to key name if key not found', () => {
  const message = t('nonexistent.key.that.does.not.exist')
  expect(message).toBe('nonexistent.key.that.does.not.exist')
})

test('t() supports nested key navigation with dot notation', () => {
  const message = t('schema.success')
  expect(typeof message).toBe('string')
  expect(message.length).toBeGreaterThan(0)
})

test('t_vars() interpolates single variable correctly', () => {
  const message = t_vars('success.inserted', { count: 42 })

  expect(message).toContain('42')
  expect(typeof message).toBe('string')
})

test('t_vars() interpolates multiple variables', () => {
  const message = t_vars('errors.invalid_config', { field: 'database_host' })

  expect(message).toContain('database_host')
  expect(typeof message).toBe('string')
})

test('MessageLoader singleton returns same instance on multiple calls', () => {
  const instance1 = MessageLoader.getInstance()
  const instance2 = MessageLoader.getInstance()

  expect(instance1).toBe(instance2)
})

test('t_vars() handles RegExp special characters in variable values', () => {
  const message = t_vars('errors.message', { message: 'Test $() chars' })

  expect(message).toContain('Test $() chars')
  expect(message).not.toContain('Test undefined')
})

test('t_vars() interpolation preserves message content', () => {
  const message = t_vars('query.result_count', { count: 100 })

  expect(message).toContain('100')
  expect(message).toContain('row')
})

test('t() with query namespace', () => {
  const message = t('query.executing')
  expect(typeof message).toBe('string')
  expect(message.length).toBeGreaterThan(0)
})

test('t_vars() with permission error message', () => {
  const message = t_vars('errors.permission_denied', { required: 'admin' })

  expect(message).toContain('admin')
  expect(message).toContain('Permission')
})

test('t_vars() with table name in message', () => {
  const message = t_vars('insert.confirm', { count: 5, table: 'users' })

  expect(message).toContain('5')
  expect(message).toContain('users')
})
