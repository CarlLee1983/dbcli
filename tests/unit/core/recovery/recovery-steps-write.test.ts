import { describe, test, expect } from 'bun:test'
import { stepsForCode, MAX_RECOVERY_STEPS } from '@/core/recovery/recovery-steps'
import type { RecoveryContext } from '@/core/recovery/types'

const baseCtx: RecoveryContext = { operation: 'insert', table: 'users' }

describe('recovery-steps: write-operation dry-run additions', () => {
  test('BLACKLIST_COLUMN_WRITE without writeOperation is unchanged (no dry-run step)', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', baseCtx)
    expect(steps.length).toBeLessThanOrEqual(MAX_RECOVERY_STEPS)
    expect(steps.some((s) => s.risk === 'dry-run')).toBe(false)
    expect(steps[0]!.command).toContain('dbcli blacklist list')
  })

  test('BLACKLIST_COLUMN_WRITE with writeOperation=INSERT prepends a dry-run step', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', { ...baseCtx, writeOperation: 'INSERT' })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toMatch(/^dbcli insert users .*--dry-run$/)
    expect(steps.length).toBeLessThanOrEqual(MAX_RECOVERY_STEPS)
  })

  test('BLACKLIST_COLUMN_WRITE with writeOperation=UPDATE prepends a dry-run step', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
      ...baseCtx,
      operation: 'update',
      writeOperation: 'UPDATE',
    })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toMatch(/^dbcli update users .*--dry-run$/)
  })

  test('BLACKLIST_COLUMN_WRITE with writeOperation=DELETE prepends a dry-run step', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
      ...baseCtx,
      operation: 'delete',
      writeOperation: 'DELETE',
    })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toMatch(/^dbcli delete users .*--dry-run$/)
  })

  test('PERMISSION_DENIED without writeOperation is unchanged (no dry-run step)', () => {
    const steps = stepsForCode('PERMISSION_DENIED', { operation: 'query' })
    expect(steps.some((s) => s.risk === 'dry-run')).toBe(false)
  })

  test('PERMISSION_DENIED with writeOperation=INSERT prepends a dry-run step', () => {
    const steps = stepsForCode('PERMISSION_DENIED', {
      operation: 'insert',
      table: 'orders',
      writeOperation: 'INSERT',
    })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toMatch(/^dbcli insert orders .*--dry-run$/)
  })

  test('writeOperation step uses <table> placeholder when ctx.table is missing', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
      operation: 'insert',
      writeOperation: 'INSERT',
    })
    expect(steps[0]!.command).toContain('<table>')
  })

  test('step ordering is renumbered after the dry-run prepend', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', { ...baseCtx, writeOperation: 'INSERT' })
    steps.forEach((s, i) => expect(s.order).toBe(i + 1))
  })

  test('total step count stays at or below MAX_RECOVERY_STEPS even with the prepend', () => {
    const steps = stepsForCode('PERMISSION_DENIED', {
      operation: 'insert',
      table: 'users',
      writeOperation: 'INSERT',
    })
    expect(steps.length).toBeLessThanOrEqual(MAX_RECOVERY_STEPS)
  })

  test('PERMISSION_DENIED with writeOperation=UPDATE prepends a dry-run step', () => {
    const steps = stepsForCode('PERMISSION_DENIED', {
      operation: 'update',
      table: 'users',
      writeOperation: 'UPDATE',
    })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toMatch(/^dbcli update users .*--dry-run$/)
  })

  describe('write dry-run carries placeholders for required write args (so --apply skips, never fails)', () => {
    test('INSERT command embeds <data> placeholder and declares it', () => {
      const steps = stepsForCode('PERMISSION_DENIED', {
        operation: 'insert',
        table: 'users',
        writeOperation: 'INSERT',
      })
      expect(steps[0]!.command).toBe('dbcli insert users --data <data> --dry-run')
      expect(steps[0]!.placeholders).toEqual(['<data>'])
    })

    test('UPDATE command embeds <set> and <where> placeholders and declares both', () => {
      const steps = stepsForCode('PERMISSION_DENIED', {
        operation: 'update',
        table: 'users',
        writeOperation: 'UPDATE',
      })
      expect(steps[0]!.command).toBe('dbcli update users --set <set> --where <where> --dry-run')
      expect(steps[0]!.placeholders).toEqual(['<set>', '<where>'])
    })

    test('DELETE command embeds <where> placeholder and declares it', () => {
      const steps = stepsForCode('PERMISSION_DENIED', {
        operation: 'delete',
        table: 'users',
        writeOperation: 'DELETE',
      })
      expect(steps[0]!.command).toBe('dbcli delete users --where <where> --dry-run')
      expect(steps[0]!.placeholders).toEqual(['<where>'])
    })

    test('BLACKLIST_COLUMN_WRITE INSERT carries <table> + <data> when ctx.table missing', () => {
      const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
        operation: 'insert',
        writeOperation: 'INSERT',
      })
      expect(steps[0]!.command).toBe('dbcli insert <table> --data <data> --dry-run')
      expect(steps[0]!.placeholders).toEqual(['<table>', '<data>'])
    })

    test('BLACKLIST_COLUMN_WRITE UPDATE carries <table> + <set> + <where> when ctx.table missing', () => {
      const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
        operation: 'update',
        writeOperation: 'UPDATE',
      })
      expect(steps[0]!.command).toBe('dbcli update <table> --set <set> --where <where> --dry-run')
      expect(steps[0]!.placeholders).toEqual(['<table>', '<set>', '<where>'])
    })

    test('BLACKLIST_COLUMN_WRITE DELETE carries <table> + <where> when ctx.table missing', () => {
      const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
        operation: 'delete',
        writeOperation: 'DELETE',
      })
      expect(steps[0]!.command).toBe('dbcli delete <table> --where <where> --dry-run')
      expect(steps[0]!.placeholders).toEqual(['<table>', '<where>'])
    })
  })
})
