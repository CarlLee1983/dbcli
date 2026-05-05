import { describe, test, expect } from 'bun:test'
import { loadSnippets } from '@/core/saved-queries/loader'
import { join } from 'path'

const fixtures = join(import.meta.dir, '..', '..', '..', 'fixtures', 'saved-queries')
const NONE = join(fixtures, '__none__')

describe('loadSnippets', () => {
  test('walks shared and local roots', async () => {
    const map = await loadSnippets({
      builtinDir: NONE,
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    const keys = [...map.keys()].sort()
    expect(keys).toEqual(['@analytics/revenue', '@dau'])
  })

  test('local overrides shared and reports override', async () => {
    const map = await loadSnippets({
      builtinDir: NONE,
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    const dauVariants = map.get('@dau')!
    expect(dauVariants).toHaveLength(1)
    const dau = dauVariants[0]!
    expect(dau.query.source).toBe('local')
    expect(dau.hasLocalOverride).toBe(true)
  })

  test('skips files that do not end in .sql', async () => {
    const map = await loadSnippets({
      builtinDir: NONE,
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    expect(map.size).toBe(2)
  })

  test('ignores missing root directories silently', async () => {
    const map = await loadSnippets({
      builtinDir: NONE,
      sharedDir: join(fixtures, '__nope_shared__'),
      localDir: join(fixtures, 'local'),
    })
    expect([...map.keys()]).toEqual(['@dau'])
  })

  test('strips .{engine}.sql suffix and groups by logical key', async () => {
    const map = await loadSnippets({
      builtinDir: join(fixtures, 'builtin'),
      sharedDir: NONE,
      localDir: NONE,
    })
    const variants = map.get('@diag/sample')
    expect(variants).toBeDefined()
    expect(variants!.length).toBe(2)
    const engines = variants!.map((v) => v.query.meta.engine?.[0]).sort()
    expect(engines).toEqual(['mysql', 'postgres'])
  })
})
