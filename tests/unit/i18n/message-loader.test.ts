import { describe, test, expect } from 'bun:test'
import { MessageLoader, t, t_vars } from '@/i18n/message-loader'

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

/**
 * `interpolate` used `String.replace(regex, value)`, whose replacement string
 * honours `$&`, `$'`, `` $` `` and `$1`. Every caller before the Elasticsearch
 * shell passed values that were effectively trusted; the shell passes the path
 * an operator typed, the index expression that matched, and the field name that
 * was refused. So a refusal message — and the `error` field of the audit row
 * built from it — became partly writable by the person being refused.
 *
 * It also replaced one variable at a time, so a value containing another
 * variable's placeholder was rewritten by the next pass.
 */
describe('interpolate does not let a value rewrite the message', () => {
  test('a `$&` in a value is inserted literally, not expanded to the match', () => {
    const rendered = MessageLoader.getInstance().interpolate('shell.es.blacklist_index', {
      index: 'sec$&rets',
    })
    expect(rendered).toContain('sec$&rets')
    expect(rendered).not.toContain('{index}')
  })

  test("a `$'` in a value does not duplicate the rest of the message", () => {
    const rendered = MessageLoader.getInstance().interpolate('shell.es.refuse_dot_segment', {
      path: "/a$'b",
    })
    expect(rendered).toContain("/a$'b")
    // The tail of the message must appear once, not twice.
    expect(rendered.split('Elasticsearch').length - 1).toBe(1)
  })

  test('a value that looks like another placeholder is not substituted again', () => {
    const rendered = MessageLoader.getInstance().interpolate('shell.es.refuse_not_canonical', {
      path: '{canonical}',
      canonical: '/x',
    })
    expect(rendered).toContain("'{canonical}'")
    expect(rendered).toContain("'/x'")
  })

  test('an unsupplied placeholder is left alone', () => {
    const rendered = MessageLoader.getInstance().interpolate('shell.es.refuse_not_canonical', {
      path: '/a',
    })
    expect(rendered).toContain('{canonical}')
  })
})
