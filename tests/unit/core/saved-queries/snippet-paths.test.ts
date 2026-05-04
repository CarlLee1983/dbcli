import { describe, test, expect } from 'bun:test'
import { resolveSnippetDirs, snippetKeyToFile } from '@/core/saved-queries/snippet-paths'

describe('snippet-paths', () => {
  test('resolves shared & local under workspace root', () => {
    const out = resolveSnippetDirs('/tmp/proj')
    expect(out.sharedDir).toBe('/tmp/proj/.dbcli-shared/queries')
    expect(out.localDir).toBe('/tmp/proj/.dbcli/queries')
  })

  test('snippetKeyToFile maps subdirs', () => {
    expect(snippetKeyToFile('/tmp/proj', '@analytics/revenue', 'shared')).toBe(
      '/tmp/proj/.dbcli-shared/queries/analytics/revenue.sql'
    )
    expect(snippetKeyToFile('/tmp/proj', '@dau', 'local')).toBe('/tmp/proj/.dbcli/queries/dau.sql')
  })
})
