import { globToRegex } from '@/utils/glob'

/**
 * Commands whose reply *is* a list of key names.
 *
 * `SCAN` returns `[cursor, keys[]]`; `KEYS` returns `keys[]`. Both enumerate
 * the keyspace, so both disclose the names of keys the blacklist protects —
 * `SCAN` at `query-only`, without naming anything the checks could match on.
 *
 * `HSCAN` / `SSCAN` / `ZSCAN` are deliberately absent: they return a hash's
 * fields, a set's members or a sorted set's members, which are values inside
 * one key, and that key is checked as a key. Adding them here would filter
 * ordinary data against key patterns.
 */
const RETURNS_KEY_NAMES = new Set(['SCAN', 'KEYS'])

export function returnsKeyNames(command: string): boolean {
  return RETURNS_KEY_NAMES.has(command.toUpperCase())
}

/**
 * Remove blacklisted key names from a reply that is a list of them.
 *
 * Filtering rather than refusing: a `SCAN` that does not name a protected key
 * is an ordinary orientation command, and taking it away from everyone who has
 * configured a blacklist would cost more than it protects. What it must not do
 * is answer with names the operator asked to protect — `listCollections` has
 * filtered its own scan this way since it was written; the operator-typed
 * command went straight through.
 *
 * The cursor is untouched: it is pagination, not a key, and rewriting it would
 * break the caller's loop.
 */
export function filterReturnedKeyNames(command: string, reply: unknown, rules: string[]): unknown {
  if (rules.length === 0) return reply
  if (!returnsKeyNames(command)) return reply

  const regexes = rules.map((pattern) => globToRegex(pattern))
  // A key that is not a string cannot be compared to a glob, so it is dropped
  // rather than kept. Same reason as the unrecognised-shape case below: the
  // question "is this protected" has no answer, and the reply is key names.
  const permitted = (key: unknown): boolean =>
    typeof key === 'string' && regexes.every((regex) => !regex.test(key))

  // `SCAN` — `[cursor, keys[]]`.
  if (Array.isArray(reply) && reply.length === 2 && Array.isArray(reply[1])) {
    return [reply[0], (reply[1] as unknown[]).filter(permitted)]
  }
  // `KEYS` — a bare array of names.
  if (Array.isArray(reply)) return reply.filter(permitted)

  // A shape this function does not recognise is not a shape it can filter, and
  // this command's reply is key names. Today the client answers `SCAN` with
  // `[cursor, string[]]` and this is unreachable; if that ever changes, the
  // default here is the same one `checkKeyArgs` takes when it has no spec.
  return []
}
