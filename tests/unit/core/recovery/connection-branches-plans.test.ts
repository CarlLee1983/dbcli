import { describe, test, expect } from 'bun:test'
import { buildConnectionBranches } from '@/core/recovery/connection-branches'

describe('buildConnectionBranches — shape', () => {
  test('returns 4 branches keyed by spec ids (v1 context, no connectionName)', () => {
    const { branches, branchFork } = buildConnectionBranches({ operation: 'query' })
    expect(Object.keys(branches).sort()).toEqual([
      'doctor-auth-error',
      'doctor-clean',
      'doctor-config-missing',
      'doctor-network-error',
    ])
    expect(branchFork.after).toBe(1)
    expect([...branchFork.branchIds].sort()).toEqual(Object.keys(branches).sort())
  })

  test('every branch has ≥1 step with 1-based order and matching branchId', () => {
    const { branches } = buildConnectionBranches({ operation: 'query' })
    for (const [id, plan] of Object.entries(branches)) {
      expect(plan.steps.length).toBeGreaterThanOrEqual(1)
      plan.steps.forEach((s, i) => {
        expect(s.order).toBe(i + 1)
        expect(s.branchId).toBe(id)
      })
    }
  })

  test('every branch description is non-empty', () => {
    const { branches } = buildConnectionBranches({ operation: 'query' })
    for (const plan of Object.values(branches)) {
      expect(plan.description.length).toBeGreaterThan(0)
    }
  })
})

describe('buildConnectionBranches — doctor-clean (§4.2)', () => {
  test('single step running inspect --for-agent', () => {
    const { branches } = buildConnectionBranches({ operation: 'query' })
    const plan = branches['doctor-clean']!
    expect(plan.steps.length).toBe(1)
    expect(plan.steps[0]!.command).toBe('dbcli inspect --for-agent')
    expect(plan.steps[0]!.risk).toBe('readonly')
  })
})

describe('buildConnectionBranches — doctor-config-missing (§4.3)', () => {
  test('init then inspect --no-connect', () => {
    const { branches } = buildConnectionBranches({ operation: 'query' })
    const plan = branches['doctor-config-missing']!
    expect(plan.steps.map((s) => s.command)).toEqual([
      'dbcli init',
      'dbcli inspect --no-connect --format json',
    ])
    expect(plan.steps[0]!.interactive).toBe(true)
    expect(plan.steps[0]!.risk).toBe('write')
  })
})

describe('buildConnectionBranches — doctor-auth-error (§4.4)', () => {
  test('init --force then inspect --no-connect', () => {
    const { branches } = buildConnectionBranches({ operation: 'query' })
    const plan = branches['doctor-auth-error']!
    expect(plan.steps.map((s) => s.command)).toEqual([
      'dbcli init --force',
      'dbcli inspect --no-connect --format json',
    ])
    expect(plan.steps[0]!.interactive).toBe(true)
  })
})

describe('buildConnectionBranches — doctor-network-error (§4.5)', () => {
  test('v1 context (no connectionName) → 2 steps: inspect, init --force', () => {
    const { branches } = buildConnectionBranches({ operation: 'query' })
    const plan = branches['doctor-network-error']!
    expect(plan.steps.map((s) => s.command)).toEqual([
      'dbcli inspect --no-connect --format json',
      'dbcli init --force',
    ])
    plan.steps.forEach((s, i) => expect(s.order).toBe(i + 1))
  })

  test('v2 context with connectionName → 3 steps incl. `dbcli use <name>`', () => {
    const { branches } = buildConnectionBranches({
      operation: 'query',
      connectionName: 'staging',
    })
    const plan = branches['doctor-network-error']!
    expect(plan.steps.map((s) => s.command)).toEqual([
      'dbcli inspect --no-connect --format json',
      'dbcli use staging',
      'dbcli init --force',
    ])
    expect(plan.steps[1]!.risk).toBe('write')
    expect(plan.steps[1]!.dbWrite).toBe(false)
    plan.steps.forEach((s, i) => expect(s.order).toBe(i + 1))
  })

  test('connectionName with shell metacharacters is quoted', () => {
    const { branches } = buildConnectionBranches({
      operation: 'query',
      connectionName: 'evil; rm -rf /',
    })
    const plan = branches['doctor-network-error']!
    expect(plan.steps[1]!.command).toBe(`dbcli use 'evil; rm -rf /'`)
  })
})

describe('buildConnectionBranches — schema parity', () => {
  test('emitted envelope fragment passes recoveryEnvelopeSchema', async () => {
    const { branches, branchFork } = buildConnectionBranches({
      operation: 'query',
      connectionName: 'staging',
    })
    const { parseRecoveryEnvelope } = await import('@/core/recovery/envelope-schema')
    const r = parseRecoveryEnvelope({
      schemaVersion: 1,
      generatedAt: '2026-05-18T00:00:00.000Z',
      ok: false,
      error: { code: 'CONN_REFUSED', category: 'connection', message: 'x' },
      recovery: [
        {
          order: 1,
          command: 'dbcli doctor --format json',
          rationale: 'r',
          risk: 'readonly',
          expects: 'e',
        },
      ],
      branches,
      branchFork,
    })
    expect(r.ok).toBe(true)
  })
})
