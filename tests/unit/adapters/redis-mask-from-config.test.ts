/**
 * `redis.mask` promised `[REDACTED]` in the user documentation and returned the
 * plaintext through `dbcli query`.
 *
 * The rules were an optional third argument to `AdapterFactory.createRedisAdapter`,
 * so every call site had to remember to pass them. Six of the eight did not:
 * `query`, `list`, `schema`, `insert`, `update` and `delete`. `export` and
 * `shell` did, which is why the gap was invisible — the feature demonstrably
 * worked, on two paths.
 *
 * This is the same shape as the Elasticsearch branch's round-five finding: a
 * control mounted at the call site is a control the next call site will not
 * have. The fix is to make the defect unrepresentable — the factory takes the
 * configuration, not a connection plus two things to remember — and this test
 * asserts the observable end of it: a masked key comes back redacted from an
 * adapter built the way a command builds one.
 */
import { test, expect } from 'bun:test'
import { AdapterFactory } from '@/adapters'
import type { RuntimeDbcliConfig } from '@/core/config'

function redisConfig(): RuntimeDbcliConfig {
  return {
    connection: { system: 'redis', host: 'localhost', port: 6379, database: '0' },
    permission: 'query-only',
    redis: { mask: [{ keyPattern: 'secret:*' }] },
  } as unknown as RuntimeDbcliConfig
}

/** A client that answers `GET` with a plaintext secret and records nothing else. */
function fakeClient(): unknown {
  return {
    connected: true,
    async connect() {},
    close() {},
    async send(cmd: string) {
      if (cmd.toUpperCase() === 'GET') return 'hunter2'
      return null
    },
  }
}

test('an adapter built from a config with redis.mask redacts a masked key', async () => {
  const adapter = AdapterFactory.createRedisAdapter(redisConfig())
  ;(adapter as unknown as { client: unknown }).client = fakeClient()

  const result = await adapter.execute<Record<string, unknown>>('GET secret:api_key')

  expect(result.rows[0]?.value).toBe('[REDACTED]')
})

test('a key the rules do not name is returned as it is', async () => {
  const adapter = AdapterFactory.createRedisAdapter(redisConfig())
  ;(adapter as unknown as { client: unknown }).client = fakeClient()

  const result = await adapter.execute<Record<string, unknown>>('GET public:motd')

  expect(result.rows[0]?.value).toBe('hunter2')
})
