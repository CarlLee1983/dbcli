import { describe, test, expect } from 'bun:test'
import { isAllowedForCode, classifyArgvForCode } from '@/core/recovery/apply-allowlist'

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

describe('classifyArgvForCode tier mapping', () => {
  test('readonly subcommands return tier=readonly', () => {
    expect(classifyArgvForCode(['dbcli', 'inspect', '--for-agent'], 'UNKNOWN')).toEqual({
      kind: 'allowed',
      tier: 'readonly',
    })
    expect(classifyArgvForCode(['dbcli', 'doctor', '--format', 'json'], 'UNKNOWN')).toEqual({
      kind: 'allowed',
      tier: 'readonly',
    })
    expect(
      classifyArgvForCode(['dbcli', 'blacklist', 'list', '--format', 'json'], 'BLACKLIST_TABLE')
    ).toEqual({ kind: 'allowed', tier: 'readonly' })
  })

  test('dbcli init / init --force is tier=interactive', () => {
    expect(classifyArgvForCode(['dbcli', 'init'], 'CONFIG_MISSING')).toEqual({
      kind: 'allowed',
      tier: 'interactive',
    })
    expect(classifyArgvForCode(['dbcli', 'init', '--force'], 'PERMISSION_DENIED')).toEqual({
      kind: 'allowed',
      tier: 'interactive',
    })
  })

  test('dbcli use <name> is tier=local-write (writes config)', () => {
    expect(classifyArgvForCode(['dbcli', 'use', 'staging'], 'CONN_REFUSED')).toEqual({
      kind: 'allowed',
      tier: 'local-write',
    })
  })

  test('dbcli blacklist remove <table> is tier=local-write', () => {
    expect(
      classifyArgvForCode(['dbcli', 'blacklist', 'remove', 'orders'], 'BLACKLIST_TABLE')
    ).toEqual({ kind: 'allowed', tier: 'local-write' })
  })

  test('dbcli schema --refresh is tier=local-write; without --refresh it is readonly', () => {
    expect(
      classifyArgvForCode(['dbcli', 'schema', '--refresh'], 'SCHEMA_CACHE_MISSING')
    ).toEqual({ kind: 'allowed', tier: 'local-write' })
    expect(
      classifyArgvForCode(['dbcli', 'schema', 'users', '--format', 'json'], 'BLACKLIST_COLUMN_WRITE')
    ).toEqual({ kind: 'allowed', tier: 'readonly' })
  })

  test('insert/update/delete WITH --dry-run are tier=dry-run', () => {
    for (const sub of ['insert', 'update', 'delete'] as const) {
      const cls = classifyArgvForCode(
        ['dbcli', sub, 'orders', '--dry-run'],
        'PERMISSION_DENIED'
      )
      expect(cls).toEqual({ kind: 'allowed', tier: 'dry-run' })
    }
  })

  test('insert/update/delete WITHOUT --dry-run are tier=db-write', () => {
    expect(
      classifyArgvForCode(
        ['dbcli', 'delete', 'users', '--where', 'id=1'],
        'PERMISSION_DENIED'
      )
    ).toEqual({ kind: 'allowed', tier: 'db-write' })
    expect(
      classifyArgvForCode(
        ['dbcli', 'update', 'orders', '--where', 'id=1', '--set', 'name=foo'],
        'PERMISSION_DENIED'
      )
    ).toEqual({ kind: 'allowed', tier: 'db-write' })
    expect(
      classifyArgvForCode(['dbcli', 'insert', 'orders', '--data', 'foo=bar'], 'PERMISSION_DENIED')
    ).toEqual({ kind: 'allowed', tier: 'db-write' })
  })

  test('dbcli q with --dry-run is tier=dry-run; without is tier=db-write', () => {
    expect(
      classifyArgvForCode(['dbcli', 'q', '@foo', '--dry-run'], 'SNIPPET_AMBIGUOUS')
    ).toEqual({ kind: 'allowed', tier: 'dry-run' })
    expect(classifyArgvForCode(['dbcli', 'q', '@foo'], 'SNIPPET_AMBIGUOUS')).toEqual({
      kind: 'allowed',
      tier: 'db-write',
    })
  })

  test('non-allowlisted subcommand returns kind=unsafe with reason', () => {
    const cls = classifyArgvForCode(['dbcli', 'query', 'SELECT 1'], 'CONFIG_MISSING')
    expect(cls.kind).toBe('unsafe')
    if (cls.kind === 'unsafe') expect(cls.reason).toContain('CONFIG_MISSING')
  })

  test('forbidden token returns unsafe', () => {
    expect(classifyArgvForCode(['dbcli', 'inspect;', 'ls'], 'CONFIG_MISSING')).toMatchObject({
      kind: 'unsafe',
    })
  })

  test('non-dbcli argv[0] returns unsafe', () => {
    expect(classifyArgvForCode(['rm', '-rf', '/'], 'UNKNOWN')).toMatchObject({ kind: 'unsafe' })
  })
})
