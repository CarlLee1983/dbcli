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
import { PermissionError } from '@/core/permission-guard'
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
