/**
 * `SCAN` enumerated blacklisted key names, and its `MATCH` pattern was never
 * checked.
 *
 * The direction was the wrong way round in a way worth naming: `KEYS secrets:*`
 * required `admin` *and* was refused by the pattern-overlap check, while
 * `SCAN 0 MATCH secrets:*` needed only `query-only` and was checked by nothing
 * — `SCAN`'s key arity was `no-key`, and its `MATCH` argument has no fixed
 * position, so nothing looked for it. The low-privilege path was the open one.
 *
 * Dropping the `MATCH` argument was also a bypass of any fix that only looked
 * at `MATCH`: a bare `SCAN 0` returns every key name in the keyspace. So both
 * ends are closed here — an explicit ask for protected keys is refused and says
 * why, and an enumeration that does not name them gets a reply with them
 * removed. `listCollections` already filtered its own scan this way; the
 * operator-typed command did not.
 */
import { test, expect } from 'bun:test'
import { RedisAdapter } from '@/adapters/redis-adapter'
import { BlacklistRejection } from '@/adapters/redis/types'
import type { ConnectionOptions } from '@/adapters/types'

const options = {
  system: 'redis',
  host: 'localhost',
  port: 6379,
  database: '0',
} as unknown as ConnectionOptions

function adapterReturning(keys: string[]): RedisAdapter {
  const adapter = new RedisAdapter(options)
  ;(adapter as unknown as { client: unknown }).client = {
    send: async () => ['0', keys],
    close: () => {},
  }
  adapter.setBlacklistRules(['secrets:*'])
  return adapter
}

test('SCAN with a MATCH that overlaps the blacklist is refused', async () => {
  const adapter = adapterReturning([])
  await expect(adapter.execute('SCAN 0 MATCH secrets:*')).rejects.toBeInstanceOf(BlacklistRejection)
})

test('the MATCH argument is found wherever it sits', async () => {
  const adapter = adapterReturning([])
  await expect(
    adapter.execute('SCAN 0 COUNT 100 MATCH secrets:* TYPE string')
  ).rejects.toBeInstanceOf(BlacklistRejection)
})

test('MATCH is matched case-insensitively, as Redis does', async () => {
  const adapter = adapterReturning([])
  await expect(adapter.execute('SCAN 0 match secrets:*')).rejects.toBeInstanceOf(BlacklistRejection)
})

test('a bare SCAN does not return blacklisted key names', async () => {
  const adapter = adapterReturning(['user:1', 'secrets:k', 'user:2'])
  const result = await adapter.execute<Record<string, unknown>>('SCAN 0')
  const returned = result.rows.map((r) => String(r.value)).join(' ')
  expect(returned).not.toContain('secrets:k')
  expect(returned).toContain('user:1')
  expect(returned).toContain('user:2')
})

test('a SCAN whose MATCH does not overlap still runs, and is still filtered', async () => {
  const adapter = adapterReturning(['user:1', 'secrets:k'])
  const result = await adapter.execute<Record<string, unknown>>('SCAN 0 MATCH user:*')
  const returned = result.rows.map((r) => String(r.value)).join(' ')
  expect(returned).toContain('user:1')
  expect(returned).not.toContain('secrets:k')
})

test('with no blacklist configured SCAN is untouched', async () => {
  const adapter = new RedisAdapter(options)
  ;(adapter as unknown as { client: unknown }).client = {
    send: async () => ['0', ['user:1', 'secrets:k']],
    close: () => {},
  }
  const result = await adapter.execute<Record<string, unknown>>('SCAN 0 MATCH secrets:*')
  const returned = result.rows.map((r) => String(r.value)).join(' ')
  expect(returned).toContain('secrets:k')
})
