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

  test('@diag/long-running declares min_seconds param', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    const pg = resolveByName(map, '@diag/long-running', 'postgres')
    expect(pg.query.meta.params[0]?.name).toBe('min_seconds')
    expect(pg.query.meta.params[0]?.default).toBe(30)
  })

  test('@diag/table-sizes resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    expect(resolveByName(map, '@diag/table-sizes', 'postgres').query.sqlBody).toContain(
      'pg_stat_user_tables'
    )
    expect(resolveByName(map, '@diag/table-sizes', 'mysql').query.sqlBody).toContain(
      'information_schema.tables'
    )
  })

  test('@diag/index-usage resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    expect(resolveByName(map, '@diag/index-usage', 'postgres').query.sqlBody).toContain(
      'pg_stat_user_indexes'
    )
    expect(resolveByName(map, '@diag/index-usage', 'mysql').query.sqlBody).toContain(
      'table_io_waits_summary_by_index_usage'
    )
  })

  test('@diag/missing-indexes resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    expect(resolveByName(map, '@diag/missing-indexes', 'postgres').query.sqlBody).toContain(
      'seq_scan'
    )
    expect(resolveByName(map, '@diag/missing-indexes', 'mysql').query.sqlBody).toContain(
      'index_name IS NULL'
    )
  })

  test('@diag/locks resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    expect(resolveByName(map, '@diag/locks', 'postgres').query.sqlBody).toContain(
      'pg_blocking_pids'
    )
    expect(resolveByName(map, '@diag/locks', 'mysql').query.sqlBody).toContain(
      'data_lock_waits'
    )
  })

  test('@diag/db-size resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    expect(resolveByName(map, '@diag/db-size', 'postgres').query.sqlBody).toContain(
      'pg_database_size'
    )
    expect(resolveByName(map, '@diag/db-size', 'mysql').query.sqlBody).toContain(
      'information_schema.tables'
    )
  })

  test('@diag/cache-hit resolves for both engines', async () => {
    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    expect(resolveByName(map, '@diag/cache-hit', 'postgres').query.sqlBody).toContain(
      'pg_statio_user_tables'
    )
    expect(resolveByName(map, '@diag/cache-hit', 'mysql').query.sqlBody).toContain(
      'Innodb_buffer_pool'
    )
  })
})
