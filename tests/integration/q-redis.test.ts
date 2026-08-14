import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { RedisAdapter } from '@/adapters/redis-adapter'
import { loadSnippets, resolveByName, resolveSnippetDirs } from '@/core/saved-queries'
import { prepareExecution } from '@/core/saved-queries/runner'
import type { ConnectionOptions } from '@/adapters/types'
import { REDIS_HOST, REDIS_PORT } from './helpers'

describe('q @diag/redis-key-stats (integration)', () => {
  const options: ConnectionOptions = {
    system: 'redis',
    host: REDIS_HOST,
    port: REDIS_PORT,
    user: '',
    password: '',
    database: '0',
  }
  const adapter = new RedisAdapter(options)
  let available = false

  beforeAll(async () => {
    try {
      await adapter.connect()
      available = true
    } catch {
      console.warn('Skipping Redis integration tests (container not running)')
    }
  })

  afterAll(async () => {
    if (available) await adapter.disconnect()
  })

  test('builtin Redis diag snippet runs end-to-end', async () => {
    if (!available) return

    const dirs = resolveSnippetDirs(process.cwd())
    const map = await loadSnippets({
      builtinDir: dirs.builtinDir,
      sharedDir: '/__none__',
      localDir: '/__none__',
    })
    const snippet = resolveByName(map, '@diag/redis-key-stats', 'redis')
    const prepared = prepareExecution(
      snippet,
      { engine: 'redis', noLimit: false },
      { match: '*' },
      {}
    )
    const result = await adapter.execute(prepared.driver.sql)
    expect(Array.isArray(result.rows)).toBe(true)
  })
})
