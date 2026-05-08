import { describe, test, expect } from 'bun:test'
import { resolve } from 'node:path'
import { collectReport } from '@/core/report/collector'

const FIXTURE = resolve(import.meta.dir, '../../../fixtures/inspect/v1-postgres')

describe('collectReport (no-connect)', () => {
  test('emits stable shape with empty sections and a warning', async () => {
    const snap = await collectReport({
      workspace: FIXTURE,
      configPath: resolve(FIXTURE, '.dbcli'),
      noConnect: true,
      sections: ['health', 'capacity', 'perf'],
    })
    expect(snap.schemaVersion).toBe(1)
    expect(typeof snap.generatedAt).toBe('string')
    expect(new Date(snap.generatedAt).toString()).not.toBe('Invalid Date')
    expect(snap.context.system).toBe('postgresql')
    expect(snap.sections).toEqual([])
    expect(snap.warnings.some((w) => w.message.includes('no-connect'))).toBe(true)
    expect(Array.isArray(snap.suggestedCommands)).toBe(true)
  })

  test('respects requested section subset', async () => {
    const snap = await collectReport({
      workspace: FIXTURE,
      configPath: resolve(FIXTURE, '.dbcli'),
      noConnect: true,
      sections: ['capacity'],
    })
    expect(snap.sections).toEqual([])
  })

  test('no-config workspace returns context-only with warning', async () => {
    const empty = resolve(import.meta.dir, '../../../fixtures/inspect/no-config')
    const snap = await collectReport({
      workspace: empty,
      configPath: resolve(empty, '.dbcli'),
      noConnect: true,
      sections: ['health'],
    })
    expect(snap.context.system).toBeNull()
    expect(snap.sections).toEqual([])
    expect(snap.warnings.length).toBeGreaterThan(0)
  })
})
