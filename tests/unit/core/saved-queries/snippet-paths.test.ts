import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { resolveSnippetDirs, snippetKeyToFile } from '@/core/saved-queries/snippet-paths'

const ROOT = '/tmp/proj'
const ROOT2 = '/tmp/workspace'

describe('snippet-paths', () => {
  test('resolves shared & local under workspace root', () => {
    const out = resolveSnippetDirs(ROOT)
    expect(out.sharedDir).toBe(join(ROOT, '.dbcli-shared', 'queries'))
    expect(out.localDir).toBe(join(ROOT, '.dbcli', 'queries'))
  })

  test('snippetKeyToFile maps subdirs', () => {
    expect(snippetKeyToFile(ROOT, '@analytics/revenue', 'shared')).toBe(
      join(ROOT, '.dbcli-shared', 'queries', 'analytics', 'revenue.sql')
    )
    expect(snippetKeyToFile(ROOT, '@dau', 'local')).toBe(join(ROOT, '.dbcli', 'queries', 'dau.sql'))
  })

  test('resolveSnippetDirs returns builtinDir from packaged assets', () => {
    const dirs = resolveSnippetDirs(ROOT2)
    expect(dirs.builtinDir.endsWith(join('assets', 'snippets'))).toBe(true)
    expect(dirs.sharedDir).toBe(join(ROOT2, '.dbcli-shared', 'queries'))
    expect(dirs.localDir).toBe(join(ROOT2, '.dbcli', 'queries'))
  })

  test('snippetKeyToFile supports builtin source', () => {
    const p = snippetKeyToFile(ROOT2, '@diag/connections', 'builtin')
    expect(p.endsWith(join('assets', 'snippets', 'diag', 'connections.sql'))).toBe(true)
  })
})
