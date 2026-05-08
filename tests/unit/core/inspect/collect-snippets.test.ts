import { describe, test, expect } from 'bun:test'
import { resolve } from 'node:path'
import { collectSnippets } from '@/core/inspect/collect-snippets'

const FIXTURE = resolve(import.meta.dir, '../../../fixtures/saved-queries/discovery')

describe('collectSnippets', () => {
  test('emits count, engines, top intents from fixture workspace', async () => {
    const out = await collectSnippets({ workspace: FIXTURE, topIntents: 3 })
    expect(out.section.count).toBeGreaterThan(0)
    expect(Array.isArray(out.section.engines)).toBe(true)
    const counts = out.section.intents.map((b) => b.count)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
    expect(out.section.intents.length).toBeLessThanOrEqual(3)
    expect(out.warnings).toEqual([])
  })

  test('falls back to built-ins on workspace with no local snippets', async () => {
    const empty = resolve(import.meta.dir, '../../../fixtures/inspect/no-config')
    const out = await collectSnippets({ workspace: empty, topIntents: 5 })
    // built-in snippets always count; only local/shared dirs are missing here
    expect(out.section.count).toBeGreaterThan(0)
    expect(out.warnings).toEqual([])
  })
})
