import { describe, test, expect, beforeAll } from 'bun:test'
import { ElasticsearchAdapter } from '@/adapters/elasticsearch-adapter'
import { loadSnippets, resolveByName, resolveSnippetDirs } from '@/core/saved-queries'
import { prepareExecution } from '@/core/saved-queries/runner'
import type { ConnectionOptions } from '@/adapters/types'
import { ES_HOST, ES_PORT } from './helpers'

describe('q @diag/es-cluster-health (integration)', () => {
  const options: ConnectionOptions = {
    system: 'elasticsearch',
    host: ES_HOST,
    port: ES_PORT,
    user: '',
    password: '',
    database: '',
  }
  const adapter = new ElasticsearchAdapter(options)
  let available = false

  beforeAll(async () => {
    try {
      await adapter.connect()
      available = true
    } catch {
      console.warn('Skipping ES integration tests (container not running on port 9201)')
    }
  })

  test('builtin ES diag snippet runs end-to-end', async () => {
    if (!available) return

    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    const snippet = resolveByName(map, '@diag/es-cluster-health', 'elasticsearch')
    const prepared = prepareExecution(snippet, { engine: 'elasticsearch', noLimit: false }, {}, {})
    const result = await adapter.execute(
      prepared.driver.sql,
      prepared.execHints?.index ? [prepared.execHints.index] : []
    )
    expect(Array.isArray(result.rows)).toBe(true)
  })
})
