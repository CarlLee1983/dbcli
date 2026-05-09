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
    expect(steps[0]!.command).toContain('dbcli insert users --dry-run')
    expect(steps.length).toBeLessThanOrEqual(MAX_RECOVERY_STEPS)
  })

  test('BLACKLIST_COLUMN_WRITE with writeOperation=UPDATE prepends a dry-run step', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
      ...baseCtx,
      operation: 'update',
      writeOperation: 'UPDATE',
    })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toContain('dbcli update users --dry-run')
  })

  test('BLACKLIST_COLUMN_WRITE with writeOperation=DELETE prepends a dry-run step', () => {
    const steps = stepsForCode('BLACKLIST_COLUMN_WRITE', {
      ...baseCtx,
      operation: 'delete',
      writeOperation: 'DELETE',
    })
    expect(steps[0]!.risk).toBe('dry-run')
    expect(steps[0]!.command).toContain('dbcli delete users --dry-run')
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
    expect(steps[0]!.command).toContain('dbcli insert orders --dry-run')
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
    expect(steps[0]!.command).toContain('dbcli update users --dry-run')
  })
})
