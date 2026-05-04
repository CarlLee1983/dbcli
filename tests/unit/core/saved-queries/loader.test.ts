import { describe, test, expect } from 'bun:test'
import { loadSnippets } from '@/core/saved-queries/loader'
import { join } from 'path'

const fixtures = join(import.meta.dir, '..', '..', '..', 'fixtures', 'saved-queries')

describe('loadSnippets', () => {
  test('walks shared and local roots', async () => {
    const map = await loadSnippets({
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    const keys = [...map.keys()].sort()
    expect(keys).toEqual(['@analytics/revenue', '@dau'])
  })

  test('local overrides shared and reports override', async () => {
    const map = await loadSnippets({
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    const dau = map.get('@dau')!
    expect(dau.query.source).toBe('local')
    expect(dau.hasLocalOverride).toBe(true)
  })

  test('skips files that do not end in .sql', async () => {
    const map = await loadSnippets({
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    expect(map.size).toBe(2)
  })

  test('ignores missing root directories silently', async () => {
    const map = await loadSnippets({
      sharedDir: join(fixtures, '__nope_shared__'),
      localDir: join(fixtures, 'local'),
    })
    expect([...map.keys()]).toEqual(['@dau'])
  })
})
