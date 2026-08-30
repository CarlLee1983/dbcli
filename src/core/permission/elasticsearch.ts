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
  /**
   * The path as written, query string and all.
   *
   * Normalised inside this module, not by the caller. It used to be named
   * `apiPath` and callers were trusted to pass something routable; the
   * Elasticsearch shell computed the routed path twelve lines above the call
   * and passed the raw text anyway, so every substring test below matched on
   * attacker-controlled query-parameter values. `?filter_path=_count` made a
   * `_delete_by_query` classify as a search. Nothing in the type system saw it,
   * because both values are strings.
   */
  rawPath: string
  body?: string
}

/** Endpoint segments that may follow an index name. The document id after one is opaque. */
const DOCUMENT_ENDPOINTS = new Set(['_doc', '_source', '_create'])

/**
 * `_cat` sub-resources withheld from the read set.
 *
 * A disclosure judgment, not a safety boundary — both are read-only. Aliases
 * resolve to indices, which `es-index-target.ts` documents as server-side
 * knowledge dbcli does not have, so `_cat/aliases` turns a documented ceiling
 * into a lookup; `_cat/tasks` carries running search request bodies. Do not
 * grow this into a general deny-set: the read rules below are an allowlist
 * precisely so that an omission denies rather than permits.
 */
const CAT_WITHHELD = new Set(['aliases', 'tasks'])

/**
 * The path Elasticsearch will route, taken from the parser the transport uses.
 *
 * `new URL` and not `normalizeEsPath`. dbcli had its own notion of a routed
 * path that *approximated* what `fetch` does, and an approximation is exactly
 * as good as its worst gap: `#` was one — `POST /_reindex#/_count` read as a
 * two-segment count here while `fetch` sent `POST /_reindex` — and tab, LF, CR
 * and `\` were three more. Enumerating them is how this keeps happening. This
 * asks the same parser the request will go through.
 *
 * `normalizeEsPath` is still right for the blacklist, which decodes an index
 * *name* because Elasticsearch decodes segments too. Two functions is not the
 * hazard; two functions answering the same question was. Routing and naming are
 * different questions, and `/orders/_doc/a%2Fb` is where they part company:
 * three segments to the server, four to a decoder.
 */
export function routedPathname(rawPath: string): string {
  try {
    return new URL(rawPath, PATH_PARSE_BASE).pathname
  } catch {
    // An input the URL parser rejects outright cannot be routed either.
    return ''
  }
}

const PATH_PARSE_BASE = 'http://dbcli.invalid'

function routedSegments(rawPath: string): string[] {
  return routedPathname(rawPath)
    .split('/')
    .filter((segment) => segment.length > 0)
}

/** An index expression, not an endpoint and not a multi-index spelling. */
function isBareIndexSegment(segment: string | undefined): boolean {
  // A leading underscore is how every single-segment endpoint Elasticsearch
  // routes is spelled, so excluding it covers `_search`, `_bulk`, `_msearch`,
  // `_refresh` and the rest without listing them. `*`, `?` and `,` are excluded
  // because `GET /*` returns every index's mappings and settings while the
  // identical `GET /_all` needs admin — two spellings of one request must not
  // land in two tiers.
  return (
    segment !== undefined &&
    segment.length > 0 &&
    !segment.startsWith('_') &&
    !/[*?,]/.test(segment)
  )
}

const READ: StatementClassification = {
  type: 'SELECT',
  isDangerous: false,
  keywords: [],
  isComposite: false,
  confidence: 'HIGH',
}

/**
 * Classify an Elasticsearch REST request into a SQL-like statement type and risk.
 *
 * **Reads are an allowlist and everything else is `DROP`.** An earlier revision
 * of this function inverted that — every GET and HEAD became a read, with a
 * deny-set for the dangerous ones — to stop `GET /_cat/indices` from requiring
 * admin. Both designs are enumerations and both drift, but they drift at
 * different rates: an allowlist drifts when Elasticsearch adds an endpoint a
 * user wants, and that user is blocked and says so; a deny-set drifts when
 * Elasticsearch adds an endpoint nobody thought about, and nobody finds out.
 * The set below is a floor, not a proof that everything absent from it is
 * dangerous. See ADR-0014.
 *
 * Matching is on routed segments and is position-aware. `_search` as a bare
 * substring matched `POST /orders/_doc/_search`, where `_search` is a document
 * id and the request writes.
 */
export function classifyElasticsearchRequest(
  request: ElasticsearchRequest
): StatementClassification {
  const method = request.method.toUpperCase()
  const segments = routedSegments(request.rawPath).map((segment) => segment.toLowerCase())
  const keywords = [method, `/${segments.join('/')}`]
  const at = (index: number): string | undefined => segments[index]
  const last = segments[segments.length - 1]
  const readMethod = method === 'GET' || method === 'HEAD'
  const classify = (
    type: StatementType,
    isDangerous: boolean,
    confidence: StatementClassification['confidence'] = 'HIGH'
  ): StatementClassification => ({ type, isDangerous, keywords, isComposite: false, confidence })

  // Ordered, first match wins. Precedence is the point: written as independent
  // clauses, a reader picks whichever they meet first and only one ordering
  // fails closed.

  // 1. Bulk, wherever it sits. Its own body decides, and an unreadable body is
  //    the destructive tier — this used to return SELECT for an empty or
  //    unparseable body, which made it a general-purpose downgrade oracle.
  if (segments.includes('_bulk')) {
    return { ...classifyElasticsearchBulk(request.body ?? ''), keywords }
  }

  // 2. Search and count, only where Elasticsearch routes them: unscoped, or
  //    directly after an index. A third segment means the match is a document
  //    id, not an endpoint.
  if (
    (last === '_search' || last === '_count') &&
    segments.length <= 2 &&
    (readMethod || method === 'POST')
  ) {
    return { ...READ, keywords }
  }

  // 3. Reading one document. The id is opaque and is never matched against
  //    anything.
  if (
    readMethod &&
    segments.length === 3 &&
    DOCUMENT_ENDPOINTS.has(at(1)!) &&
    isBareIndexSegment(at(0))
  ) {
    return { ...READ, keywords }
  }

  // 4. Reading an index's schema or aliases.
  if (
    readMethod &&
    segments.length >= 2 &&
    segments.length <= 3 &&
    ['_mapping', '_mappings', '_settings', '_alias', '_aliases'].includes(at(1) ?? '') &&
    isBareIndexSegment(at(0))
  ) {
    return { ...READ, keywords }
  }

  // 5. Cluster and index listings that carry no document content.
  if (readMethod && at(0) === '_cat' && !CAT_WITHHELD.has(at(1) ?? '')) {
    return { ...READ, keywords }
  }
  if (readMethod && at(0) === '_cluster' && at(1) === 'health' && segments.length <= 3) {
    return { ...READ, keywords }
  }

  // 6. A bare index: metadata and existence. This discloses field names,
  //    including blacklisted ones, and their aliases; values stay hidden and
  //    `dbcli schema` already exposes the same names, so it is accepted rather
  //    than overlooked.
  if (readMethod && segments.length === 1 && isBareIndexSegment(at(0))) {
    return { ...READ, keywords }
  }

  // 7. Writes to one document.
  // Each of these requires a concrete index in position 0, as the read rules
  // do. Elasticsearch forbids a leading `_`, `*`, `?` and `,` in an index name,
  // so nothing legitimate is rejected — and rules that differ for no reason are
  // how a gap gets built.
  const scoped = isBareIndexSegment(at(0))
  if (scoped && method === 'POST' && at(1) === '_update' && segments.length === 3) {
    return classify('UPDATE', false)
  }
  if (scoped && method === 'POST' && at(1) === '_doc' && segments.length <= 3) {
    return classify('UPDATE', false)
  }
  if (scoped && method === 'PUT' && segments.length === 3 && DOCUMENT_ENDPOINTS.has(at(1)!)) {
    return classify('INSERT', false)
  }
  if (scoped && method === 'DELETE' && segments.length === 3 && at(1) === '_doc') {
    return classify('DELETE', true)
  }

  // 8. Everything else. `DELETE /users` removes an index, `DELETE /logs-*`
  //    removes every index a pattern matches, `_delete_by_query` empties one,
  //    `PUT /users/_mapping` rewrites a schema — and an endpoint none of us has
  //    heard of lands here too, which is the direction this function is meant
  //    to fail in. A refusal can be escalated; an index cannot be recovered.
  return classify('DROP', true, method === 'DELETE' ? 'HIGH' : 'LOW')
}

/**
 * Parse Elasticsearch _bulk body (NDJSON) and find the highest required permission.
 */
function classifyElasticsearchBulk(body: string): StatementClassification {
  const lines = body.split('\n').filter((l) => l.trim().length > 0)
  // Nothing readable means nothing proven. This returned SELECT for an empty
  // body, an unparseable one, or any body whose first key was not a known op —
  // and because the bulk branch is selected by the path alone, that made it a
  // general-purpose downgrade: `DELETE /orders?filter_path=_bulk` classified as
  // a read.
  let highestType: StatementType = 'DROP'
  let isDangerous = true
  let recognised = false

  for (const line of lines) {
    try {
      const action = JSON.parse(line)
      const op = Object.keys(action)[0]

      if (op === 'delete') {
        recognised = true
        highestType = 'DELETE'
        isDangerous = true
        break // DELETE is highest for DML
      }
      if (op === 'update') {
        recognised = true
        if (highestType !== 'DELETE') {
          highestType = 'UPDATE'
          isDangerous = false
        }
      }
      if (op === 'index' || op === 'create') {
        recognised = true
        if (!['DELETE', 'UPDATE'].includes(highestType)) {
          highestType = 'INSERT'
          isDangerous = false
        }
      }
    } catch {
      // Ignore invalid JSON lines in bulk (usually data lines)
    }
  }

  return {
    type: recognised ? highestType : 'DROP',
    isDangerous: recognised ? isDangerous : true,
    keywords: ['BULK'],
    isComposite: true,
    confidence: recognised ? 'HIGH' : 'LOW',
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
