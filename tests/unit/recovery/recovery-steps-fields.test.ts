import { describe, test, expect } from 'bun:test'
import { stepsForCode } from '@/core/recovery/recovery-steps'

describe('recovery-steps populates v1.17 fields', () => {
  test('CONFIG_MISSING marks `dbcli init` interactive', () => {
    const steps = stepsForCode('CONFIG_MISSING', { operation: 'query' })
    const init = steps.find((s) => s.command === 'dbcli init')
    expect(init?.interactive).toBe(true)
  })

  test('CONN_AUTH_FAILED marks `dbcli init --force` interactive', () => {
    const steps = stepsForCode('CONN_AUTH_FAILED', { operation: 'query' })
    const force = steps.find((s) => s.command === 'dbcli init --force')
    expect(force?.interactive).toBe(true)
  })

  test('PERMISSION_DENIED marks `dbcli init --force` interactive', () => {
    const steps = stepsForCode('PERMISSION_DENIED', { operation: 'update', writeOperation: 'UPDATE' })
    const force = steps.find((s) => s.command === 'dbcli init --force')
    expect(force?.interactive).toBe(true)
  })

  test('BLACKLIST_TABLE without table ctx places <table> placeholder', () => {
    const steps = stepsForCode('BLACKLIST_TABLE', { operation: 'query' })
    const remove = steps.find((s) => s.command === 'dbcli blacklist remove <table>')
    expect(remove?.placeholders).toEqual(['<table>'])
  })

  test('BLACKLIST_TABLE with table ctx has no placeholders on the remove step', () => {
    const steps = stepsForCode('BLACKLIST_TABLE', { operation: 'query', table: 'users' })
    const remove = steps.find((s) => s.command === 'dbcli blacklist remove users')
    expect(remove?.placeholders).toBeUndefined()
  })

  test('SNIPPET_NOT_FOUND without hint/snippet places <hint> placeholder', () => {
    const steps = stepsForCode('SNIPPET_NOT_FOUND', { operation: 'q' })
    const search = steps.find((s) => s.command === 'dbcli queries search <hint>')
    expect(search?.placeholders).toEqual(['<hint>'])
  })

  test('SNIPPET_AMBIGUOUS without snippet ctx places <snippet> placeholder', () => {
    const steps = stepsForCode('SNIPPET_AMBIGUOUS', { operation: 'q' })
    const dry = steps.find((s) => s.command === 'dbcli q <snippet> --dry-run')
    expect(dry?.placeholders).toEqual(['<snippet>'])
  })

  test('SNIPPET_PARAM_MISSING places <snippet>, <name>, <value> when ctx empty', () => {
    const steps = stepsForCode('SNIPPET_PARAM_MISSING', { operation: 'q' })
    const dry = steps.find((s) => s.command.startsWith('dbcli q <snippet>'))
    expect(dry?.placeholders).toEqual(['<snippet>', '<name>', '<value>'])
  })

  test('SCHEMA_CACHE_MISSING steps have no placeholders / interactive flags', () => {
    const steps = stepsForCode('SCHEMA_CACHE_MISSING', { operation: 'schema' })
    for (const s of steps) {
      expect(s.interactive).toBeUndefined()
      expect(s.placeholders).toBeUndefined()
    }
  })

  test('no current recovery step sets dbWrite', () => {
    for (const code of [
      'CONFIG_MISSING',
      'CONN_REFUSED',
      'CONN_AUTH_FAILED',
      'CONN_TIMEOUT',
      'CONN_HOST_NOT_FOUND',
      'CONN_UNKNOWN',
      'PERMISSION_DENIED',
      'BLACKLIST_TABLE',
      'BLACKLIST_COLUMN_WRITE',
      'SNIPPET_NOT_FOUND',
      'SNIPPET_AMBIGUOUS',
      'SNIPPET_PARAM_MISSING',
      'SCHEMA_CACHE_MISSING',
      'UNKNOWN',
    ] as const) {
      for (const s of stepsForCode(code, { operation: 'query' })) {
        expect(s.dbWrite).toBeUndefined()
      }
    }
  })
})
