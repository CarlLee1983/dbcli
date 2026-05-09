import { describe, test, expect } from 'bun:test'
import { resolve } from 'node:path'
import { collectGuide } from '@/core/guide/collector'

const FIXTURE = resolve(import.meta.dir, '../../../fixtures/inspect/v1-postgres')
const NO_CONFIG = resolve(import.meta.dir, '../../../fixtures/inspect/no-config')

describe('collectGuide (cache-first)', () => {
  test('emits stable shape with anchor step for slow-query goal', async () => {
    const snap = await collectGuide({
      workspace: FIXTURE,
      configPath: resolve(FIXTURE, '.dbcli'),
      goal: 'slow-query',
    })
    expect(snap.schemaVersion).toBe(1)
    expect(typeof snap.generatedAt).toBe('string')
    expect(new Date(snap.generatedAt).toString()).not.toBe('Invalid Date')
    expect(snap.goal).toBe('slow-query')
    expect(snap.context.system).toBe('postgresql')
    expect(snap.steps.length).toBeGreaterThan(0)
    expect(snap.steps[0]!.command).toBe('dbcli inspect --for-agent')
    expect(snap.steps.every((s) => s.risk === 'readonly')).toBe(true)
  })

  test('no-config workspace returns the dbcli-init bootstrap plan', async () => {
    const snap = await collectGuide({
      workspace: NO_CONFIG,
      configPath: resolve(NO_CONFIG, '.dbcli'),
      goal: 'health',
    })
    expect(snap.context.system).toBeNull()
    expect(snap.steps.length).toBe(1)
    expect(snap.steps[0]!.command).toBe('dbcli init')
  })

  test('permissions goal emits the synthetic permissions plan', async () => {
    const snap = await collectGuide({
      workspace: FIXTURE,
      configPath: resolve(FIXTURE, '.dbcli'),
      goal: 'permissions',
    })
    expect(snap.steps.map((s) => s.command)).toContain('dbcli blacklist list --format json')
    expect(snap.steps.map((s) => s.command)).toContain('dbcli doctor --format json')
  })
})
