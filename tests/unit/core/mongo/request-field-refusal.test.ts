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
import { describe, test, expect } from 'bun:test'
import { findProtectedFieldReference, protectedFieldsForRequest } from '@/core/mongo/request-fields'

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
  expect(findProtectedFieldReference([{ $group: { _id: '$password' } }], PROTECTED)).toBe(
    'password'
  )
})

test('a protected field named as an object key is caught', () => {
  expect(findProtectedFieldReference({ password: { $exists: true } }, PROTECTED)).toBe('password')
})

test('a dotted path reaching a protected component is caught', () => {
  expect(findProtectedFieldReference([{ $project: { l: '$user.password' } }], PROTECTED)).toBe(
    'user.password'
  )
  expect(findProtectedFieldReference({ 'user.password': { $gt: '' } }, PROTECTED)).toBe(
    'user.password'
  )
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

/**
 * Round two on this file. The refusal above answers "does the request *name* a
 * protected field" — and MongoDB has expressions that move a protected field's
 * value without naming it, by moving the whole document.
 *
 * `{"$project":{"all":"$$ROOT"}}` returns every field of the document under a
 * key the request chose. Neither end saw it: the request names only `$$ROOT`
 * and `all`, and the mask compares the full path `all.password` against a rule
 * anchored as `password`. `$objectToArray` is worse — it turns the document
 * into `[{k:"password",v:"p1"}]`, where the protected name is a *value* and no
 * key-based mask can ever reach it.
 *
 * The first version of this file treated `$$ROOT` as a path prefix to strip, so
 * that `$$ROOT.password` would match. That was right for `$$ROOT.password` and
 * wrong for `$$ROOT` alone, which is not a path at all.
 */
describe('whole-document transfers', () => {
  test('$$ROOT on its own names every protected field', () => {
    expect(findProtectedFieldReference([{ $project: { all: '$$ROOT' } }], PROTECTED)).toBe(
      'password'
    )
  })

  test('$$CURRENT is the same document under another name', () => {
    expect(findProtectedFieldReference([{ $project: { all: '$$CURRENT' } }], PROTECTED)).toBe(
      'password'
    )
  })

  test('$$ROOT with a path still resolves through the path', () => {
    // The reported path is what the request wrote, minus the `$$`. It reaches
    // `password` by dotted component, which is what the refusal turns on.
    expect(findProtectedFieldReference([{ $project: { p: '$$ROOT.password' } }], PROTECTED)).toBe(
      'ROOT.password'
    )
  })

  test('$objectToArray turns field names into values, so it is refused', () => {
    expect(
      findProtectedFieldReference([{ $project: { kv: { $objectToArray: '$user' } } }], PROTECTED)
    ).toBeDefined()
  })

  test('$replaceWith and $replaceRoot are refused for the same reason', () => {
    expect(
      findProtectedFieldReference([{ $replaceWith: { w: '$$ROOT' } }], PROTECTED)
    ).toBeDefined()
    expect(
      findProtectedFieldReference([{ $replaceRoot: { newRoot: '$user' } }], PROTECTED)
    ).toBeDefined()
  })

  test('$getField with a computed field name is refused, since the name cannot be read', () => {
    // Whether the server accepts an expression here varies by version. dbcli
    // cannot tell what name this resolves to, so it does not forward it — the
    // same rule the Elasticsearch side applies to a body it cannot inspect.
    expect(
      findProtectedFieldReference(
        [{ $project: { x: { $getField: { field: { $concat: ['pass', 'word'] } } } } }],
        PROTECTED
      )
    ).toBeDefined()
  })

  test('none of this fires for a collection with no rules', () => {
    expect(
      findProtectedFieldReference([{ $project: { all: '$$ROOT' } }], new Set())
    ).toBeUndefined()
    expect(
      findProtectedFieldReference([{ $project: { kv: { $objectToArray: '$user' } } }], new Set())
    ).toBeUndefined()
  })

  test('an ordinary pipeline is still not refused', () => {
    expect(
      findProtectedFieldReference([{ $project: { name: 1, email: 1 } }], PROTECTED)
    ).toBeUndefined()
  })
})

describe('the collection a $lookup names is matched case-insensitively', () => {
  test('rules keyed with different casing than the request still apply', () => {
    const fields = protectedFieldsForRequest(
      [{ $lookup: { from: 'secrets', as: 's' } }],
      'orders',
      { Secrets: ['token'] }
    )
    expect([...fields]).toEqual(['token'])
  })
})

// ADR-0019 Decision 2: the request side reads a rule the same way the read
// mask does. Before this, `user.*` protected a read and named nothing here.
describe('a rule is a glob on the request side too', () => {
  test('a segment glob catches the field it names', () => {
    const rules = new Set(['pass*'])
    expect(findProtectedFieldReference([{ $project: { leak: '$password' } }], rules)).toBe(
      'password'
    )
    expect(findProtectedFieldReference([{ $project: { keep: '$name' } }], rules)).toBeUndefined()
  })

  test('a tail wildcard catches a field beneath it', () => {
    const rules = new Set(['user.*'])
    expect(findProtectedFieldReference([{ $project: { leak: '$user.password' } }], rules)).toBe(
      'user.password'
    )
    expect(
      findProtectedFieldReference([{ $project: { keep: '$username' } }], rules)
    ).toBeUndefined()
  })

  test('a literal rule still matches by dotted component, not substring', () => {
    const rules = new Set(['password'])
    expect(findProtectedFieldReference([{ $project: { leak: '$user.password' } }], rules)).toBe(
      'user.password'
    )
    expect(
      findProtectedFieldReference([{ $project: { keep: '$passwordless' } }], rules)
    ).toBeUndefined()
  })
})
