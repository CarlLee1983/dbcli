import { describe, test, expect } from 'bun:test'
import { isAllowedForCode } from '@/core/recovery/apply-allowlist'

describe('isAllowedForCode', () => {
  test('rejects argv that does not start with dbcli', () => {
    expect(isAllowedForCode(['rm', '-rf', '/'], 'CONFIG_MISSING')).toBe(false)
    expect(isAllowedForCode(['/usr/bin/dbcli', 'inspect'], 'CONFIG_MISSING')).toBe(false)
  })

  test('rejects empty argv', () => {
    expect(isAllowedForCode([], 'CONFIG_MISSING')).toBe(false)
  })

  test('CONFIG_MISSING allows init + inspect', () => {
    expect(isAllowedForCode(['dbcli', 'init'], 'CONFIG_MISSING')).toBe(true)
    expect(
      isAllowedForCode(['dbcli', 'inspect', '--no-connect', '--format', 'json'], 'CONFIG_MISSING')
    ).toBe(true)
  })

  test('CONFIG_MISSING rejects unrelated subcommand', () => {
    expect(isAllowedForCode(['dbcli', 'query', 'SELECT 1'], 'CONFIG_MISSING')).toBe(false)
  })

  test('CONN_REFUSED allows doctor + inspect + use', () => {
    expect(isAllowedForCode(['dbcli', 'doctor', '--format', 'json'], 'CONN_REFUSED')).toBe(true)
    expect(
      isAllowedForCode(['dbcli', 'inspect', '--no-connect', '--format', 'json'], 'CONN_REFUSED')
    ).toBe(true)
    expect(isAllowedForCode(['dbcli', 'use', 'staging'], 'CONN_REFUSED')).toBe(true)
  })

  test('PERMISSION_DENIED allows dry-run insert/update/delete + inspect + guide + init --force', () => {
    expect(isAllowedForCode(['dbcli', 'update', 'orders', '--dry-run'], 'PERMISSION_DENIED')).toBe(
      true
    )
    expect(isAllowedForCode(['dbcli', 'inspect', '--for-agent'], 'PERMISSION_DENIED')).toBe(true)
    expect(
      isAllowedForCode(['dbcli', 'guide', 'permissions', '--for-agent'], 'PERMISSION_DENIED')
    ).toBe(true)
    expect(isAllowedForCode(['dbcli', 'init', '--force'], 'PERMISSION_DENIED')).toBe(true)
  })

  test('BLACKLIST_TABLE allows blacklist list/remove + inspect', () => {
    expect(
      isAllowedForCode(['dbcli', 'blacklist', 'list', '--format', 'json'], 'BLACKLIST_TABLE')
    ).toBe(true)
    expect(isAllowedForCode(['dbcli', 'blacklist', 'remove', 'orders'], 'BLACKLIST_TABLE')).toBe(
      true
    )
    expect(isAllowedForCode(['dbcli', 'inspect', '--for-agent'], 'BLACKLIST_TABLE')).toBe(true)
  })

  test('BLACKLIST_TABLE rejects blacklist add (not in plan)', () => {
    expect(isAllowedForCode(['dbcli', 'blacklist', 'add', 'secrets'], 'BLACKLIST_TABLE')).toBe(
      false
    )
  })

  test('SNIPPET_NOT_FOUND allows queries list/search/suggest', () => {
    expect(
      isAllowedForCode(['dbcli', 'queries', 'list', '--format', 'json'], 'SNIPPET_NOT_FOUND')
    ).toBe(true)
    expect(isAllowedForCode(['dbcli', 'queries', 'search', 'slow'], 'SNIPPET_NOT_FOUND')).toBe(true)
    expect(
      isAllowedForCode(
        ['dbcli', 'queries', 'suggest', 'perf', '--format', 'json'],
        'SNIPPET_NOT_FOUND'
      )
    ).toBe(true)
  })

  test('SCHEMA_CACHE_MISSING allows schema --refresh, list, inspect', () => {
    expect(isAllowedForCode(['dbcli', 'schema', '--refresh'], 'SCHEMA_CACHE_MISSING')).toBe(true)
    expect(isAllowedForCode(['dbcli', 'list', '--format', 'json'], 'SCHEMA_CACHE_MISSING')).toBe(
      true
    )
    expect(isAllowedForCode(['dbcli', 'inspect', '--format', 'json'], 'SCHEMA_CACHE_MISSING')).toBe(
      true
    )
  })

  test('UNKNOWN allows doctor + inspect only', () => {
    expect(isAllowedForCode(['dbcli', 'doctor', '--format', 'json'], 'UNKNOWN')).toBe(true)
    expect(isAllowedForCode(['dbcli', 'inspect', '--for-agent'], 'UNKNOWN')).toBe(true)
    expect(isAllowedForCode(['dbcli', 'query', 'SELECT 1'], 'UNKNOWN')).toBe(false)
  })

  test('rejects argv with embedded shell metacharacters that survived parsing', () => {
    // parseArgv would normally reject these, but defence in depth — allowlist also screens.
    expect(isAllowedForCode(['dbcli', 'inspect;', 'ls'], 'CONFIG_MISSING')).toBe(false)
  })
})
