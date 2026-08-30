/**
 * Redis had two command tables that nobody had ever compared.
 *
 * `REDIS_COMMAND_PERMISSION` (`src/core/permission/redis.ts`) decides whether a
 * command may run at all. `REDIS_COMMAND_TABLE`
 * (`src/adapters/redis/command-metadata.ts`) says where its keys are, which is
 * what the blacklist needs in order to check them — and `checkKeyArgs` returned
 * `{ ok: true }` when it had no entry. So a command the permission map allowed
 * and the metadata table had never heard of reached the server with its keys
 * unchecked: `LPOP secrets:list` at `read-write` is a read *and* a destroy of a
 * blacklisted key, and `XRANGE secrets:stream - +` reads one at `query-only`.
 *
 * The tier the metadata table also carried is gone rather than corrected: it
 * was a second copy of an authority that nothing enforced, and it had drifted
 * on five commands. What is left is one direction — everything the permission
 * map allows has a spec here.
 *
 * This is ADR-0014's Decision 1 in another engine: a missing allow entry costs
 * the user an unnecessary refusal and they say so, a missing deny entry is a
 * bypass and nobody says anything.
 */
import { test, expect } from 'bun:test'
import { getCommandSpec } from '@/adapters/redis/command-metadata'
import { REDIS_COMMAND_PERMISSION } from '@/core/permission/redis'
import { checkKeyArgs } from '@/adapters/redis/blacklist-enforcer'

test('every command the permission map allows has a key-arity spec', () => {
  const missing = Object.keys(REDIS_COMMAND_PERMISSION).filter((c) => !getCommandSpec(c))
  expect(missing).toEqual([])
})

test('a command with no spec is refused rather than passed through', () => {
  // Fail-closed. The previous `return { ok: true }` is what turned every gap
  // between the two tables into a blacklist bypass.
  const result = checkKeyArgs('NOSUCHCOMMAND', ['secrets:api_key'], ['secrets:*'])
  expect(result.ok).toBe(false)
})

test.each([
  ['LPOP', ['secrets:list']],
  ['RPOP', ['secrets:list']],
  ['LSET', ['secrets:list', '0', 'x']],
  ['APPEND', ['secrets:api_key', 'x']],
  ['SETNX', ['secrets:api_key', 'x']],
  ['PSETEX', ['secrets:api_key', '1000', 'x']],
  ['INCR', ['secrets:counter']],
  ['INCRBY', ['secrets:counter', '1']],
  ['DECR', ['secrets:counter']],
  ['DECRBY', ['secrets:counter', '1']],
  ['HSETNX', ['secrets:hash', 'f', 'v']],
  ['HINCRBY', ['secrets:hash', 'f', '1']],
  ['XADD', ['secrets:stream', '*', 'f', 'v']],
  ['XDEL', ['secrets:stream', '1-1']],
  ['XRANGE', ['secrets:stream', '-', '+']],
  ['XREVRANGE', ['secrets:stream', '+', '-']],
  ['PTTL', ['secrets:api_key']],
  ['EXPIREAT', ['secrets:api_key', '99999']],
  ['PEXPIRE', ['secrets:api_key', '1000']],
])('%s on a blacklisted key is refused', (command, args) => {
  const result = checkKeyArgs(command, args, ['secrets:*'])
  expect({ command, ok: result.ok }).toEqual({ command, ok: false })
})

test('MSETNX is refused when any of its keys is blacklisted', () => {
  const result = checkKeyArgs('MSETNX', ['public:a', '1', 'secrets:b', '2'], ['secrets:*'])
  expect(result.ok).toBe(false)
})

test('XREAD is refused when a blacklisted stream is among its keys', () => {
  const result = checkKeyArgs('XREAD', ['COUNT', '10', 'STREAMS', 'secrets:s', '0'], ['secrets:*'])
  expect(result.ok).toBe(false)
})

test('a permitted command on a key the blacklist does not name still passes', () => {
  expect(checkKeyArgs('LPOP', ['public:list'], ['secrets:*']).ok).toBe(true)
  expect(checkKeyArgs('XRANGE', ['public:stream', '-', '+'], ['secrets:*']).ok).toBe(true)
})
