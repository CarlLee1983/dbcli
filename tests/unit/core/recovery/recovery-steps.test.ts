import { describe, test, expect } from 'bun:test'
import { stepsForCode, MAX_RECOVERY_STEPS } from '@/core/recovery/recovery-steps'
import { RECOVERY_CODES } from '@/core/recovery/types'

describe('stepsForCode', () => {
  test('every recovery code returns at least one step', () => {
    for (const code of RECOVERY_CODES) {
      const steps = stepsForCode(code, { operation: 'query' })
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.length).toBeLessThanOrEqual(MAX_RECOVERY_STEPS)
      expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i + 1))
      for (const s of steps) {
        expect(typeof s.command).toBe('string')
        expect(s.command.length).toBeGreaterThan(0)
        expect(typeof s.rationale).toBe('string')
        expect(typeof s.expects).toBe('string')
        expect(['readonly', 'dry-run', 'write', 'unknown']).toContain(s.risk)
      }
    }
  })

  test('CONFIG_MISSING leads with `dbcli init` (write)', () => {
    const steps = stepsForCode('CONFIG_MISSING', { operation: 'query' })
    expect(steps[0]!.command).toBe('dbcli init')
    expect(steps[0]!.risk).toBe('write')
  })

  test('CONN_REFUSED leads with doctor (readonly) then inspect', () => {
    const steps = stepsForCode('CONN_REFUSED', { operation: 'query' })
    expect(steps[0]!.command).toBe('dbcli doctor --format json')
    expect(steps[0]!.risk).toBe('readonly')
    expect(steps[1]!.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('CONN_REFUSED with connectionName surfaces `dbcli use <name>`', () => {
    const steps = stepsForCode('CONN_REFUSED', {
      operation: 'query',
      connectionName: 'staging',
    })
    expect(steps.map((s) => s.command)).toContain('dbcli use staging')
  })

  test('CONN_REFUSED without connectionName omits the use step', () => {
    const steps = stepsForCode('CONN_REFUSED', { operation: 'query' })
    expect(steps.map((s) => s.command).some((c) => c.startsWith('dbcli use '))).toBe(false)
  })

  test('PERMISSION_DENIED includes a write-risk re-init step', () => {
    const steps = stepsForCode('PERMISSION_DENIED', { operation: 'query' })
    const writes = steps.filter((s) => s.risk === 'write')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes[0]!.command).toBe('dbcli init --force')
  })

  test('BLACKLIST_TABLE binds the table into the remove step', () => {
    const steps = stepsForCode('BLACKLIST_TABLE', { operation: 'query', table: 'users' })
    expect(steps.map((s) => s.command)).toContain('dbcli blacklist remove users')
    const removeStep = steps.find((s) => s.command === 'dbcli blacklist remove users')
    expect(removeStep?.risk).toBe('write')
  })

  test('BLACKLIST_TABLE without table leaves the placeholder', () => {
    const steps = stepsForCode('BLACKLIST_TABLE', { operation: 'query' })
    expect(steps.map((s) => s.command)).toContain('dbcli blacklist remove <table>')
  })

  test('SNIPPET_NOT_FOUND uses hint when present', () => {
    const steps = stepsForCode('SNIPPET_NOT_FOUND', {
      operation: 'q',
      hint: 'long-running',
    })
    expect(steps.map((s) => s.command)).toContain('dbcli queries search long-running')
  })

  test('SNIPPET_NOT_FOUND without hint preserves placeholder', () => {
    const steps = stepsForCode('SNIPPET_NOT_FOUND', { operation: 'q' })
    expect(steps.map((s) => s.command)).toContain('dbcli queries search <hint>')
  })

  test('SNIPPET_PARAM_MISSING binds paramName from hint', () => {
    const steps = stepsForCode('SNIPPET_PARAM_MISSING', {
      operation: 'q',
      snippet: '@diag/long-running',
      hint: 'min_seconds',
    })
    const drySteps = steps.filter((s) => s.risk === 'dry-run')
    expect(drySteps.length).toBeGreaterThan(0)
    expect(drySteps[0]!.command).toContain('@diag/long-running')
    expect(drySteps[0]!.command).toContain('min_seconds=<value>')
  })

  test('SCHEMA_CACHE_MISSING leads with schema --refresh', () => {
    const steps = stepsForCode('SCHEMA_CACHE_MISSING', { operation: 'query' })
    expect(steps[0]!.command).toBe('dbcli schema --refresh')
    expect(steps[0]!.risk).toBe('readonly')
  })
})
