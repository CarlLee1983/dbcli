/**
 * MongoDB's field blacklist masked the keys a document came back under, and
 * an aggregation chooses those keys.
 *
 *   columns: { users: ['password'] }
 *   dbcli query '[{"$project":{"leak":"$password"}}]' --collection users
 *   → [{"_id":1,"leak":"p1"}]        the plaintext, at query-only
 *
 * `$addFields`, `$set` and `$group` do the same, and `$group` is worse than the
 * others: its output key is always `_id`, which the masker exempts
 * unconditionally so that document references survive. So even a masker that
 * followed a value to its source would hand `$group: {_id: "$password"}` back.
 *
 * The answer is the one the Elasticsearch branch reached in round seven, in a
 * file that had exactly this problem: a response-side filter cannot win against
 * a request that chooses the response's shape, so a request that *names* a
 * protected field is refused. Elasticsearch has `namesProtectedField`; MongoDB
 * had no request-side check at all.
 *
 * Like that one, this over-refuses — a string value that happens to equal a
 * protected field name is refused too — in the direction that withholds.
 */
import { test, expect } from 'bun:test'
import { findProtectedFieldReference } from '@/core/mongo/request-fields'

const PROTECTED = new Set(['password'])

test('a $project that renames a protected field is caught', () => {
  expect(findProtectedFieldReference([{ $project: { leak: '$password' } }], PROTECTED)).toBe(
    'password'
  )
})

test('$addFields and $set are caught the same way', () => {
  expect(findProtectedFieldReference([{ $addFields: { copy: '$password' } }], PROTECTED)).toBe(
    'password'
  )
  expect(findProtectedFieldReference([{ $set: { copy: '$password' } }], PROTECTED)).toBe('password')
})

test('$group by a protected field is caught, which is the _id exit', () => {
  expect(findProtectedFieldReference([{ $group: { _id: '$password' } }], PROTECTED)).toBe('password')
})

test('a protected field named as an object key is caught', () => {
  expect(findProtectedFieldReference({ password: { $exists: true } }, PROTECTED)).toBe('password')
})

test('a dotted path reaching a protected component is caught', () => {
  expect(findProtectedFieldReference([{ $project: { l: '$user.password' } }], PROTECTED)).toBe(
    'user.password'
  )
  expect(
    findProtectedFieldReference({ 'user.password': { $gt: '' } }, PROTECTED)
  ).toBe('user.password')
})

test('a field named through $getField, where it is not $-prefixed, is caught', () => {
  expect(
    findProtectedFieldReference([{ $project: { l: { $getField: 'password' } } }], PROTECTED)
  ).toBe('password')
})

test('a sort or an index hint naming it is caught', () => {
  expect(findProtectedFieldReference([{ $sort: { password: -1 } }], PROTECTED)).toBe('password')
})

test('an ordinary query naming nothing protected is left alone', () => {
  expect(findProtectedFieldReference([{ $match: { status: 'active' } }], PROTECTED)).toBeUndefined()
  expect(findProtectedFieldReference({ email: 'a@b.c' }, PROTECTED)).toBeUndefined()
})

test('a field whose name merely contains a protected name is not caught', () => {
  // `passwordless` is a different field. Matching is by dotted component, not
  // by substring — the same rule Elasticsearch settled on in round seven.
  expect(findProtectedFieldReference({ passwordless: true }, PROTECTED)).toBeUndefined()
})

test('no protected fields means nothing is refused', () => {
  expect(findProtectedFieldReference([{ $project: { l: '$password' } }], new Set())).toBeUndefined()
})
