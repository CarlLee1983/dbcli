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
  rawPath: string
  type: ReturnType<typeof classifyElasticsearchRequest>['type']
  lowest: Permission
  why: string
}> = [
  // Reads stay reads.
  { method: 'GET', rawPath: '/users/_search', type: 'SELECT', lowest: 'query-only', why: 'search' },
  {
    method: 'POST',
    rawPath: '/users/_search',
    type: 'SELECT',
    lowest: 'query-only',
    why: 'search with a body is a POST',
  },
  { method: 'GET', rawPath: '/users/_count', type: 'SELECT', lowest: 'query-only', why: 'count' },
  {
    method: 'GET',
    rawPath: '/users/_mapping',
    type: 'SELECT',
    lowest: 'query-only',
    why: 'reading a mapping',
  },
  {
    method: 'GET',
    rawPath: '/users/_doc/1',
    type: 'SELECT',
    lowest: 'query-only',
    why: 'reading one document',
  },

  // Document writes stay at the tier their SQL equivalent has.
  {
    method: 'PUT',
    rawPath: '/users/_doc/1',
    type: 'INSERT',
    lowest: 'read-write',
    why: 'indexing a document',
  },
  {
    method: 'POST',
    rawPath: '/users/_update/1',
    type: 'UPDATE',
    lowest: 'read-write',
    why: 'updating a document',
  },
  {
    method: 'DELETE',
    rawPath: '/users/_doc/1',
    type: 'DELETE',
    lowest: 'data-admin',
    why: 'deleting one document is the DELETE tier, as in SQL',
  },

  // Anything that removes or reshapes the container is admin.
  {
    method: 'DELETE',
    rawPath: '/users',
    type: 'DROP',
    lowest: 'admin',
    why: 'deleting an index is DROP TABLE, not DELETE FROM',
  },
  {
    method: 'DELETE',
    rawPath: '/logs-*',
    type: 'DROP',
    lowest: 'admin',
    why: 'a wildcard deletes every matching index at once',
  },
  {
    method: 'DELETE',
    rawPath: '/_all',
    type: 'DROP',
    lowest: 'admin',
    why: '_all is every index in the cluster',
  },
  {
    method: 'DELETE',
    rawPath: '/users,orders',
    type: 'DROP',
    lowest: 'admin',
    why: 'a comma-separated list is still whole indices',
  },
  {
    method: 'DELETE',
    rawPath: '/_index_template/t',
    type: 'DROP',
    lowest: 'admin',
    why: 'templates shape indices that do not exist yet',
  },
  {
    method: 'DELETE',
    rawPath: '/users/_alias/a',
    type: 'DROP',
    lowest: 'admin',
    why: 'matched the _alias read rule before, so query-only could delete it',
  },
  {
    method: 'PUT',
    rawPath: '/users/_mapping',
    type: 'DROP',
    lowest: 'admin',
    why: 'changing a mapping is a schema change',
  },
  {
    method: 'PUT',
    rawPath: '/users/_settings',
    type: 'DROP',
    lowest: 'admin',
    why: 'changing index settings is a schema change',
  },
  {
    method: 'PUT',
    rawPath: '/_cluster/settings',
    type: 'DROP',
    lowest: 'admin',
    why: 'cluster configuration',
  },
]

const TIERS: Permission[] = ['query-only', 'read-write', 'data-admin', 'admin']
const rank = (permission: Permission): number => TIERS.indexOf(permission)

describe('elasticsearch request classification', () => {
  for (const { method, rawPath, type, why } of CASES) {
    test(`${method} ${rawPath} is ${type} — ${why}`, () => {
      expect(classifyElasticsearchRequest({ method, rawPath }).type).toBe(type)
    })
  }
})

describe('elasticsearch permission tiers', () => {
  for (const { method, rawPath, lowest } of CASES) {
    test(`${method} ${rawPath} needs ${lowest}`, () => {
      for (const permission of TIERS) {
        const run = () => enforceElasticsearchPermission({ method, rawPath }, permission)

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
 * Reads are an allowlist and everything else needs admin.
 *
 * A revision made inside this same change inverted that — every GET and HEAD
 * became a read, with a deny-set for the dangerous ones — because
 * `GET /_cat/indices`, the command the Elasticsearch shell's own banner
 * suggests, otherwise required admin. The inversion was withdrawn: both designs
 * are enumerations, but a gap in an allowlist costs a user an unnecessary admin
 * requirement, and a gap in a deny-set costs them a bypass. See ADR-0014.
 */
describe('the read set is an allowlist', () => {
  const READS: ReadonlyArray<[string, string]> = [
    ['GET', '/users/_search'],
    ['POST', '/users/_search'],
    ['GET', '/users/_count'],
    ['GET', '/users/_doc/1'],
    ['GET', '/users/_source/1'],
    ['GET', '/users/_mapping'],
    ['GET', '/users/_settings'],
    ['GET', '/users/_alias'],
    ['GET', '/_cat/indices'],
    ['GET', '/_cat/health'],
    ['GET', '/_cluster/health'],
    ['GET', '/users'],
    ['HEAD', '/users'],
  ]

  test.each(READS)('%s %s is a read at query-only', (method, rawPath) => {
    expect(classifyElasticsearchRequest({ method, rawPath }).type).toBe('SELECT')
    expect(() => enforceElasticsearchPermission({ method, rawPath }, 'query-only')).not.toThrow()
  })
})

describe('anything the read set does not name needs admin', () => {
  // The property the whole design rests on. It is what disappears silently if
  // anyone reintroduces a substring test, and it is the only assertion here
  // still meaningful after Elasticsearch ships an endpoint none of us has heard
  // of.
  test('an endpoint nobody has enumerated needs admin', () => {
    const invented = { method: 'GET', rawPath: '/_something_that_does_not_exist' }
    expect(classifyElasticsearchRequest(invented).type).toBe('DROP')
    expect(() => enforceElasticsearchPermission(invented, 'query-only')).toThrow(PermissionError)
    expect(() => enforceElasticsearchPermission(invented, 'data-admin')).toThrow(PermissionError)
  })

  const WITHHELD: ReadonlyArray<[string, string, string]> = [
    ['GET', '/_security/user', 'credentials and roles'],
    ['GET', '/_security/api_key', 'API keys'],
    ['GET', '/_snapshot/_all', 'repository configuration, buckets and regions'],
    ['GET', '/_watcher/watch/w', 'watch definitions'],
    ['GET', '/_ilm/policy', 'lifecycle policy'],
    ['GET', '/_ml/anomaly_detectors', 'model configuration'],
    ['GET', '/_transform', 'transform configuration'],
    ['GET', '/_sql', 'executes SQL and opens a cursor'],
    ['GET', '/_scripts/painless/_execute', 'executes Painless'],
    ['GET', '/_render/template', 'renders a stored template'],
    ['GET', '/_async_search/id', 'results of a search scoped by someone else'],
    ['GET', '/_nodes', 'node paths, plugins, JVM arguments, published addresses'],
    ['GET', '/_cluster/state', 'every index name and mapping'],
    ['GET', '/_search/scroll', 'allocates and consumes a server-side scroll context'],
    ['GET', '/_refresh', 'state-changing, GET-registered in 7.x'],
    ['GET', '/_cache/clear', 'state-changing, GET-registered in 7.x'],
    // Read-only, withheld as a disclosure judgment rather than a safety one:
    // aliases resolve to indices, which the blacklist cannot follow.
    ['GET', '/_cat/aliases', 'resolves aliases to the indices behind them'],
    ['GET', '/_cat/tasks', 'carries the request source of running searches'],
    // Two spellings of one request must not land in two tiers.
    ['GET', '/*', 'every index mapping and setting, same as /_all'],
    ['GET', '/_all', 'every index mapping and setting'],
    ['GET', '/logs-*', 'a multi-index expression is not a bare index'],
    ['GET', '/a,b', 'a comma list is not a bare index'],
  ]

  test.each(WITHHELD)('%s %s needs admin — %s', (method, rawPath) => {
    expect(() => enforceElasticsearchPermission({ method, rawPath }, 'query-only')).toThrow(
      PermissionError
    )
    expect(() => enforceElasticsearchPermission({ method, rawPath }, 'data-admin')).toThrow(
      PermissionError
    )
  })
})

describe('matching is position-aware and reads the routed path', () => {
  // `_search`, `_count` and `_bulk` are legal document ids, so an exact segment
  // match still matches a segment the attacker planted.
  const FORGED: ReadonlyArray<[string, string]> = [
    ['POST', '/orders/_doc/_search'],
    ['POST', '/orders/_doc/_count'],
    ['PUT', '/orders/_doc/_search'],
    ['POST', '/orders/_update/_search'],
  ]

  test.each(FORGED)('%s %s is not a read', (method, rawPath) => {
    expect(classifyElasticsearchRequest({ method, rawPath }).type).not.toBe('SELECT')
    expect(() => enforceElasticsearchPermission({ method, rawPath }, 'query-only')).toThrow(
      PermissionError
    )
  })

  // `filter_path` is accepted by every Elasticsearch endpoint and takes an
  // arbitrary string, so a classifier reading the raw path matched on its
  // value. This is the bypass that made `POST /orders/_delete_by_query`
  // classify as a search and execute at query-only.
  const SMUGGLED: ReadonlyArray<[string, string]> = [
    ['POST', '/orders/_delete_by_query?filter_path=_count'],
    ['POST', '/orders/_delete_by_query?filter_path=_search'],
    ['DELETE', '/orders?filter_path=_bulk'],
    ['PUT', '/orders/_mapping?filter_path=_bulk'],
    ['POST', '/orders/_close?routing=_bulk'],
    ['DELETE', '/orders?pretty&filter_path=_doc'],
  ]

  test.each(SMUGGLED)('%s %s cannot be downgraded by its query string', (method, rawPath) => {
    expect(() => enforceElasticsearchPermission({ method, rawPath }, 'query-only')).toThrow(
      PermissionError
    )
  })

  test('a dot segment cannot spell a read that routes to a write', () => {
    expect(
      classifyElasticsearchRequest({
        method: 'POST',
        rawPath: '/orders/_search/../_delete_by_query',
      }).type
    ).toBe('DROP')
  })
})

describe('an unreadable bulk body is the destructive tier', () => {
  // Selected by the path alone, this returned SELECT for an empty, unparseable
  // or unrecognised body — a general-purpose downgrade oracle.
  const BODIES: ReadonlyArray<[string, string]> = [
    ['empty', ''],
    ['unparseable', 'not json at all'],
    ['no recognised operation', '{"properties":{"a":{"type":"text"}}}'],
    ['half parseable', '{"nope":1}\n{"also":2}'],
  ]

  test.each(BODIES)('a %s bulk body needs admin', (_name, body) => {
    const request = { method: 'POST', rawPath: '/orders/_bulk', body }
    expect(classifyElasticsearchRequest(request).type).toBe('DROP')
    expect(() => enforceElasticsearchPermission(request, 'query-only')).toThrow(PermissionError)
  })

  test('a recognised bulk body still classifies by its highest operation', () => {
    expect(
      classifyElasticsearchRequest({
        method: 'POST',
        rawPath: '/orders/_bulk',
        body: '{"delete":{"_index":"orders","_id":"1"}}',
      }).type
    ).toBe('DELETE')
  })
})

describe('the query path is unaffected', () => {
  // `dbcli query` synthesises exactly one shape. None of the above may move it.
  test('the shape dbcli query builds is still a read', () => {
    const request = { method: 'POST', rawPath: '/users/_search', body: '{}' }
    expect(classifyElasticsearchRequest(request).type).toBe('SELECT')
    expect(() => enforceElasticsearchPermission(request, 'query-only')).not.toThrow()
  })

  test('a comma list or wildcard index still classifies its search as a read', () => {
    for (const index of ['a,b', 'logs-*']) {
      expect(
        classifyElasticsearchRequest({ method: 'POST', rawPath: `/${index}/_search` }).type
      ).toBe('SELECT')
    }
  })
})

/**
 * 第八輪 HIGH：index 位置的百分號編碼讓兩種拼法落在兩個 tier。
 *
 * `routedPathname` 用 `new URL().pathname`，它**不解**百分號編碼，而
 * Elasticsearch 對 `{index}` 這種路徑參數會解碼。於是 `%2A`→`*`、
 * `%5Fall`→`_all`、`%2C`→`,`：`GET /%2A` 在這裡是 SELECT（query-only 可讀
 * 全叢集的 mapping／settings，包含黑名單索引的欄位名），而拼成 `GET /*` 的
 * 同一個請求需要 admin。
 *
 * `isBareIndexSegment` 的註解自己寫了「兩種拼法不可以落在兩個 tier」——
 * 這正是那句話所禁止的情形。
 */
describe('index 位置的百分號編碼不改變分級', () => {
  test.each([
    ['/%2A', '/*'],
    ['/%5Fall', '/_all'],
    ['/%2A/_mapping', '/*/_mapping'],
    ['/%5Fall/_settings', '/_all/_settings'],
    ['/a%2Cb', '/a,b'],
  ])('%s 與 %s 分到同一級', (encoded, plain) => {
    const a = classifyElasticsearchRequest({ method: 'GET', rawPath: encoded })
    const b = classifyElasticsearchRequest({ method: 'GET', rawPath: plain })
    expect(a.type).toBe(b.type)
    expect(a.isDangerous).toBe(b.isDangerous)
  })

  test('一般索引名的編碼不受影響——仍然是讀取', () => {
    const encoded = classifyElasticsearchRequest({ method: 'GET', rawPath: '/ord%65rs' })
    expect(encoded.type).toBe('SELECT')
  })

  test('編碼的端點名稱與未編碼的分到同一級', () => {
    const encoded = classifyElasticsearchRequest({ method: 'GET', rawPath: '/%5Fsearch' })
    const plain = classifyElasticsearchRequest({ method: 'GET', rawPath: '/_search' })
    expect(encoded.type).toBe(plain.type)
  })
})
