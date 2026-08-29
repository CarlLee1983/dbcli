/**
 * What an Elasticsearch request is allowed to destroy, and at which tier.
 *
 * The classifier matched paths without regard to method, which let three
 * different requests be judged as something milder than they are:
 *
 * - `DELETE /users` removes an entire index and was classified `DELETE`, the
 *   document-deletion tier — so data-admin could drop an index, while the SQL
 *   equivalent (`DROP TABLE`) has always required admin.
 * - `DELETE /users/_alias/a` matched the `_alias` read rule and was classified
 *   `SELECT`, so query-only could delete an alias.
 * - `PUT /users/_mapping` and `PUT /users/_settings` matched their read rules
 *   the same way, so query-only could change a mapping or a setting.
 *
 * The matrix below is the contract. Each case names the tier that may run it,
 * asserted through the enforcement path rather than the classifier alone,
 * because the tier is what a user actually experiences.
 */

import { describe, test, expect } from 'bun:test'
import {
  classifyElasticsearchRequest,
  enforceElasticsearchPermission,
} from '@/core/permission/elasticsearch'
import { PermissionError, type StatementType } from '@/core/permission-guard'
import type { Permission } from '@/types'

const CASES: Array<{
  method: string
  apiPath: string
  type: ReturnType<typeof classifyElasticsearchRequest>['type']
  lowest: Permission
  why: string
}> = [
  // Reads stay reads.
  { method: 'GET', apiPath: '/users/_search', type: 'SELECT', lowest: 'query-only', why: 'search' },
  {
    method: 'POST',
    apiPath: '/users/_search',
    type: 'SELECT',
    lowest: 'query-only',
    why: 'search with a body is a POST',
  },
  { method: 'GET', apiPath: '/users/_count', type: 'SELECT', lowest: 'query-only', why: 'count' },
  {
    method: 'GET',
    apiPath: '/users/_mapping',
    type: 'SELECT',
    lowest: 'query-only',
    why: 'reading a mapping',
  },
  {
    method: 'GET',
    apiPath: '/users/_doc/1',
    type: 'SELECT',
    lowest: 'query-only',
    why: 'reading one document',
  },

  // Document writes stay at the tier their SQL equivalent has.
  {
    method: 'PUT',
    apiPath: '/users/_doc/1',
    type: 'INSERT',
    lowest: 'read-write',
    why: 'indexing a document',
  },
  {
    method: 'POST',
    apiPath: '/users/_update/1',
    type: 'UPDATE',
    lowest: 'read-write',
    why: 'updating a document',
  },
  {
    method: 'DELETE',
    apiPath: '/users/_doc/1',
    type: 'DELETE',
    lowest: 'data-admin',
    why: 'deleting one document is the DELETE tier, as in SQL',
  },

  // Anything that removes or reshapes the container is admin.
  {
    method: 'DELETE',
    apiPath: '/users',
    type: 'DROP',
    lowest: 'admin',
    why: 'deleting an index is DROP TABLE, not DELETE FROM',
  },
  {
    method: 'DELETE',
    apiPath: '/logs-*',
    type: 'DROP',
    lowest: 'admin',
    why: 'a wildcard deletes every matching index at once',
  },
  {
    method: 'DELETE',
    apiPath: '/_all',
    type: 'DROP',
    lowest: 'admin',
    why: '_all is every index in the cluster',
  },
  {
    method: 'DELETE',
    apiPath: '/users,orders',
    type: 'DROP',
    lowest: 'admin',
    why: 'a comma-separated list is still whole indices',
  },
  {
    method: 'DELETE',
    apiPath: '/_index_template/t',
    type: 'DROP',
    lowest: 'admin',
    why: 'templates shape indices that do not exist yet',
  },
  {
    method: 'DELETE',
    apiPath: '/users/_alias/a',
    type: 'DROP',
    lowest: 'admin',
    why: 'matched the _alias read rule before, so query-only could delete it',
  },
  {
    method: 'PUT',
    apiPath: '/users/_mapping',
    type: 'DROP',
    lowest: 'admin',
    why: 'changing a mapping is a schema change',
  },
  {
    method: 'PUT',
    apiPath: '/users/_settings',
    type: 'DROP',
    lowest: 'admin',
    why: 'changing index settings is a schema change',
  },
  {
    method: 'PUT',
    apiPath: '/_cluster/settings',
    type: 'DROP',
    lowest: 'admin',
    why: 'cluster configuration',
  },
]

const TIERS: Permission[] = ['query-only', 'read-write', 'data-admin', 'admin']
const rank = (permission: Permission): number => TIERS.indexOf(permission)

describe('elasticsearch request classification', () => {
  for (const { method, apiPath, type, why } of CASES) {
    test(`${method} ${apiPath} is ${type} — ${why}`, () => {
      expect(classifyElasticsearchRequest({ method, apiPath }).type).toBe(type)
    })
  }
})

describe('elasticsearch permission tiers', () => {
  for (const { method, apiPath, lowest } of CASES) {
    test(`${method} ${apiPath} needs ${lowest}`, () => {
      for (const permission of TIERS) {
        const run = () => enforceElasticsearchPermission({ method, apiPath }, permission)

        if (rank(permission) >= rank(lowest)) {
          expect(run).not.toThrow()
        } else {
          expect(run).toThrow(PermissionError)
        }
      }
    })
  }
})

/**
 * The read rule used to be an allowlist of paths — `_search`, `_count`,
 * `_mapping`, `_settings`, `_alias`, `_doc`, `_source` — and anything unlisted
 * fell through to the destructive default. That was invisible while only
 * `dbcli query` used this classifier, because that path can only synthesise a
 * search. The Elasticsearch shell sends whatever the operator types, so
 * `GET /_cat/indices` — the command the shell's own banner suggests — needed
 * admin.
 *
 * Every GET and HEAD is now a read. What may be read is a question for the
 * blacklist, not for this function.
 */
describe('read verbs are reads, whatever the path', () => {
  const READS: ReadonlyArray<[string, string]> = [
    ['GET', '/_cat/indices'],
    ['GET', '/_cluster/health'],
    ['GET', '/_nodes'],
    ['GET', '/users'],
    ['HEAD', '/users'],
    ['GET', '/users/_search'],
    ['GET', '/users/_mapping'],
    ['GET', '/users/_doc/1'],
  ]

  test.each(READS)('%s %s classifies as SELECT', (method, apiPath) => {
    expect(classifyElasticsearchRequest({ method, apiPath }).type).toBe('SELECT')
  })

  test.each(READS)('%s %s is permitted at query-only', (method, apiPath) => {
    expect(() => enforceElasticsearchPermission({ method, apiPath }, 'query-only')).not.toThrow()
  })
})

/**
 * The relaxation above moves GET and HEAD only. Nothing that writes is a GET in
 * the Elasticsearch REST API, so no mutation may have become permitted — and
 * the query path, which synthesises exactly one shape, must be untouched.
 */
describe('the read relaxation moved no write', () => {
  const WRITES: ReadonlyArray<[string, string, StatementType]> = [
    ['POST', '/users/_delete_by_query', 'DROP'],
    ['POST', '/_reindex', 'DROP'],
    ['POST', '/_aliases', 'DROP'],
    ['PUT', '/users/_mapping', 'DROP'],
    ['PUT', '/users/_settings', 'DROP'],
    ['DELETE', '/users', 'DROP'],
    ['DELETE', '/_all', 'DROP'],
    ['DELETE', '/users/_doc/1', 'DELETE'],
    ['PUT', '/users/_doc/1', 'INSERT'],
    ['POST', '/users/_update/1', 'UPDATE'],
  ]

  test.each(WRITES)('%s %s still classifies as %s', (method, apiPath, expected) => {
    expect(classifyElasticsearchRequest({ method, apiPath }).type).toBe(expected)
  })

  test.each(WRITES)('%s %s is still refused at query-only', (method, apiPath) => {
    expect(() => enforceElasticsearchPermission({ method, apiPath }, 'query-only')).toThrow(
      PermissionError
    )
  })

  // The shape `dbcli query` builds for Elasticsearch, unchanged by any of this.
  test('the query path still classifies its own request as a read', () => {
    expect(
      classifyElasticsearchRequest({ method: 'POST', apiPath: '/users/_search', body: '{}' }).type
    ).toBe('SELECT')
  })
})
