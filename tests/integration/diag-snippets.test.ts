import { describe, test, expect } from 'bun:test'
import { loadSnippets, resolveByName, resolveSnippetDirs } from '@/core/saved-queries'

describe('builtin diag snippets', () => {
  test('@diag/connections resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    const pg = resolveByName(map, '@diag/connections', 'postgres')
    const my = resolveByName(map, '@diag/connections', 'mysql')
    expect(pg.query.sqlBody).toContain('pg_stat_activity')
    expect(my.query.sqlBody).toContain('processlist')
  })
})
