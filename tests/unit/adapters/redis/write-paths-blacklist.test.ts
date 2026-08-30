/**
 * `dbcli insert`, `update` and `delete` reached a blacklisted Redis key.
 *
 * Those three go through `BlacklistValidator.checkTableBlacklist`, whose test
 * is `this.state.tables.has(name.toLowerCase())` — literal equality, no globs.
 * `RedisAdapter.insert/update/delete` then called the client directly, without
 * a single `checkKeyArgs`. So `dbcli blacklist table add 'secrets:*'` followed
 * by `dbcli delete secrets:api_key` deleted the key, and `'secrets:*'` is the
 * spelling the user documentation teaches — only a full literal key name ever
 * protected anything, which is not how anyone configures Redis.
 *
 * The fix is where the Elasticsearch branch put its equivalent: at the
 * adapter's own boundary, so that a path that reaches Redis at all is a path
 * that has been checked. Mounting it in the three commands would leave the
 * fourth caller uncovered — which is precisely the history being corrected.
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

function adapter(rules: string[] = ['secrets:*']): { adapter: RedisAdapter; sent: string[] } {
  const sent: string[] = []
  const a = new RedisAdapter(options)
  ;(a as unknown as { client: unknown }).client = {
    async send(cmd: string) {
      sent.push(cmd)
      return cmd === 'TYPE' ? 'string' : 1
    },
    async set(...args: unknown[]) {
      sent.push('SET')
      void args
      return 'OK'
    },
    async hmset() {
      sent.push('HMSET')
      return 'OK'
    },
    async del() {
      sent.push('DEL')
      return 1
    },
    async expire() {
      sent.push('EXPIRE')
      return 1
    },
    close: () => {},
  }
  a.setBlacklistRules(rules)
  return { adapter: a, sent }
}

test('delete on a key matched by a glob rule is refused, and nothing is sent', async () => {
  const { adapter: a, sent } = adapter()
  await expect(a.delete('secrets:api_key', {})).rejects.toBeInstanceOf(BlacklistRejection)
  expect(sent).toEqual([])
})

test('insert on a key matched by a glob rule is refused, and nothing is sent', async () => {
  const { adapter: a, sent } = adapter()
  await expect(a.insert('secrets:api_key', { value: 'x' })).rejects.toBeInstanceOf(
    BlacklistRejection
  )
  expect(sent).toEqual([])
})

test('update on a key matched by a glob rule is refused, and nothing is sent', async () => {
  const { adapter: a, sent } = adapter()
  await expect(a.update('secrets:api_key', { value: 'x' }, {})).rejects.toBeInstanceOf(
    BlacklistRejection
  )
  expect(sent).toEqual([])
})

test('a literal rule still protects the key it names', async () => {
  const { adapter: a } = adapter(['secrets:api_key'])
  await expect(a.delete('secrets:api_key', {})).rejects.toBeInstanceOf(BlacklistRejection)
})

test('a key the rules do not reach is written normally', async () => {
  const { adapter: a, sent } = adapter()
  await a.insert('public:motd', { value: 'hello' })
  expect(sent.length).toBeGreaterThan(0)
})
