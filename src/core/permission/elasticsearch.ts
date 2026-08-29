import type { Permission } from '@/types'
import {
  PermissionError,
  minimumPermissionFor,
  permitsOperation,
  type StatementClassification,
  type StatementType,
} from '@/core/permission-guard'
import { t_vars } from '@/i18n/message-loader'

// ============================================================================
// ELASTICSEARCH CLASSIFICATION
// ============================================================================

export interface ElasticsearchRequest {
  method: string
  apiPath: string
  body?: string
}

/**
 * A path that names one document: `_doc/<id>`, or the `_source/<id>` spelling.
 *
 * The id has to be there. `DELETE /users/_doc` is not a valid document delete,
 * so treating it as one would be inventing a narrower reading than the request
 * supports.
 */
const ES_DOCUMENT_PATH = /\/(?:_doc|_source)\/[^/?]+/

/**
 * Classify an Elasticsearch REST request into a SQL-like statement type and risk.
 */
export function classifyElasticsearchRequest(
  request: ElasticsearchRequest
): StatementClassification {
  const method = request.method.toUpperCase()
  const path = request.apiPath.toLowerCase()

  // 1. Special case: _bulk NDJSON parsing
  if (path.includes('_bulk')) {
    return classifyElasticsearchBulk(request.body ?? '')
  }

  // 2. Read operations
  //
  // The method decides, not the path. `_mapping`, `_settings` and `_alias` name
  // a resource that can be read *or* rewritten, and matching the path on its own
  // classified `PUT /users/_mapping` — a schema change — as a read that
  // query-only could run.
  //
  // Every GET and HEAD is a read. Elasticsearch has no state-changing GET: the
  // REST API spends POST, PUT and DELETE on every mutation it offers, and the
  // read verbs are safe across the whole surface. This used to be an allowlist
  // of read paths, which was the same enumeration mistake in the other
  // direction — anything unlisted fell through to the destructive default, so
  // `GET /_cat/indices`, `GET /_cluster/health` and a bare `GET /<index>`
  // needed admin. That was invisible while only the query path used this
  // classifier, because that path can only ever produce a search.
  //
  // What may be *read* is not this function's question. The blacklist decides
  // which objects a caller may reach, and a request that cannot be attributed
  // to an index is refused before it gets here.
  //
  // `_search` and `_count` also accept POST, because that is how a query with a
  // body is sent.
  const readMethod = method === 'GET' || method === 'HEAD'
  const searchPath = path.includes('_search') || path.includes('_count')

  if (readMethod || (searchPath && method === 'POST')) {
    return {
      type: 'SELECT',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 3. Write operations
  if (path.includes('_update') || (method === 'POST' && path.includes('_doc'))) {
    return {
      type: 'UPDATE',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  if (method === 'PUT' && (path.includes('_doc') || path.includes('_create'))) {
    return {
      type: 'INSERT',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 4. Destructive operations
  //
  // Only a DELETE that names a document is the DELETE tier. `DELETE /users`
  // removes the whole index, `DELETE /logs-*` removes every index the pattern
  // matches, and `DELETE /_all` removes the cluster's contents — all of them
  // were the same `DELETE` as removing one document, so data-admin could drop
  // an index while the SQL equivalent, `DROP TABLE`, has always needed admin.
  // Anything this cannot prove is document-scoped falls through to DROP, which
  // is the fail-closed direction: the cost of being wrong is a refusal a user
  // can escalate, rather than an index nobody can get back.
  if (method === 'DELETE') {
    if (ES_DOCUMENT_PATH.test(path)) {
      return {
        type: 'DELETE',
        isDangerous: true,
        keywords: [method, path],
        isComposite: false,
        confidence: 'HIGH',
      }
    }

    return {
      type: 'DROP',
      isDangerous: true,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 5. Schema/Cluster operations (default to admin)
  return {
    type: 'DROP',
    isDangerous: true,
    keywords: [method, path],
    isComposite: false,
    confidence: 'LOW',
  }
}

/**
 * Parse Elasticsearch _bulk body (NDJSON) and find the highest required permission.
 */
function classifyElasticsearchBulk(body: string): StatementClassification {
  const lines = body.split('\n').filter((l) => l.trim().length > 0)
  let highestType: StatementType = 'SELECT'
  let isDangerous = false

  for (const line of lines) {
    try {
      const action = JSON.parse(line)
      const op = Object.keys(action)[0]

      if (op === 'delete') {
        highestType = 'DELETE'
        isDangerous = true
        break // DELETE is highest for DML
      }
      if (op === 'update' && highestType !== 'DELETE') {
        highestType = 'UPDATE'
      }
      if ((op === 'index' || op === 'create') && !['DELETE', 'UPDATE'].includes(highestType)) {
        highestType = 'INSERT'
      }
    } catch {
      // Ignore invalid JSON lines in bulk (usually data lines)
    }
  }

  return {
    type: highestType,
    isDangerous,
    keywords: ['BULK'],
    isComposite: true,
    confidence: 'HIGH',
  }
}

/**
 * Throw PermissionError if the Elasticsearch request is not allowed under the
 * given permission tier.
 */
export function enforceElasticsearchPermission(
  request: ElasticsearchRequest,
  permission: Permission
): StatementClassification {
  const classification = classifyElasticsearchRequest(request)

  const result = checkElasticsearchPermission(classification, permission)

  if (!result.allowed) {
    throw new PermissionError(result.reason, classification, result.requiredPermission ?? 'admin')
  }

  return classification
}

function checkElasticsearchPermission(
  classification: StatementClassification,
  permission: Permission
): { allowed: boolean; reason: string; requiredPermission?: Permission } {
  // The tiers are the SQL tiers. This used to restate them — a third copy of a
  // table that had already drifted twice — and the two agree on every type this
  // classifier can produce: SELECT, INSERT, UPDATE, DELETE and DROP. Reusing
  // the shared rule keeps them agreeing by construction rather than by luck.
  if (permitsOperation(classification.type, permission)) {
    return { allowed: true, reason: `${classification.type} allowed in ${permission} mode` }
  }

  const minimum = minimumPermissionFor(classification.type)
  return {
    allowed: false,
    // Names the level that would work. It used to say "requires higher
    // permission tier", which is true of every refusal and tells nobody what
    // to change.
    reason: t_vars('errors.elasticsearch_requires_level', {
      type: classification.type,
      minimum,
      permission,
    }),
    requiredPermission: minimum,
  }
}
