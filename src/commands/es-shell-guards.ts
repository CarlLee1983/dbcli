import { t, t_vars } from '@/i18n/message-loader'
import { indexExpressionReaches } from '@/utils/es-index-target'
import { routedPathname } from '@/core/permission/elasticsearch'
import { foldFieldPath } from '@/core/blacklist-fold'
import { normalizeBlacklistEntry } from '@/core/blacklist-manager'
import {
  contiguousRulesFor,
  reachesProtectedPath,
  reachesProtectedSegments,
  type ContiguousRules,
} from '@/core/mongo/path-matcher'

/**
 * The machine-readable half of a blacklist refusal.
 *
 * Untranslated on purpose: `BlacklistRejection:` is the prefix every engine's
 * refusal carries and the one the recovery path and several tests match on. The
 * sentence after it is for a person and is translated; this token is not.
 */
const BLACKLIST_REJECTION = 'BlacklistRejection: '

const ES_SHELL_SIZE_CAP = 1000

/**
 * The Elasticsearch shell's guards: the pure functions that decide what a
 * request *is* — which path the server would route it to, which indices and
 * fields it names, and what has to be withheld from the response.
 *
 * They live apart from `es-shell.ts` because they answer questions about a
 * request, not about a session: none of them reads configuration, opens a
 * connection, writes an audit row or talks to an adapter. That is also what
 * makes them cheap to attack in a test — every one of them is a value in and a
 * value out.
 *
 * Nine rounds of adversarial review landed on this file's comments. They record
 * why a check is shaped the way it is, and several of them exist because an
 * earlier, confident comment was wrong; do not compress them into a summary.
 */

/** Return the index segment of a path, or undefined for non-index paths (leading "_"). */
export function extractIndexFromPath(path: string): string | undefined {
  const seg = path.replace(/^\//, '').split('/')[0] ?? ''
  if (seg === '' || seg.startsWith('_')) return undefined
  return seg.split('?')[0]
}

/**
 * Paths that return cluster or index *metadata* and never document contents.
 * An allow-list, not a deny-list: a request that cannot be scoped to an index
 * is refused unless it is known to be harmless.
 *
 * `_ingest` and `_tasks` were here and are not any more: pipeline definitions
 * routinely embed credentials, and a detailed task listing carries the request
 * source of running searches, including searches over blacklisted indices.
 *
 * This list answers a different question from the permission classifier's read
 * set — scoping, not tier — so a path must satisfy both. They overlap by
 * construction, not by coincidence.
 */
const UNSCOPED_METADATA_PREFIXES = ['_cat', '_cluster', '_nodes', '_license']

/**
 * 子資源層級的例外：前綴放行、這些不放行。
 *
 * 只比對第一段時，這份白名單放行了它自己明文拒絕過的資料。`_ingest` 與
 * `_tasks` 被移出去的理由就在上面，而：
 *
 * - `_cluster/state` 的 `metadata.ingest.pipeline[]` 是同一份 pipeline 定義，
 *   `metadata.stored_scripts` 是同一批 script，`metadata.indices.<name>.mappings`
 *   則給出黑名單索引的完整欄位清單——而 `_cat/indices/secrets`（只有統計）
 *   是明確被拒絕的。
 * - `_cat/tasks` 的 description 帶著執行中查詢的 index 與 source，正是
 *   `_tasks` 被拿掉的那份資料。分類器的 `CAT_WITHHELD` 已經擋住它，但那是
 *   tier 的問題；這裡是 scoping 的問題，兩道各自要成立。
 * - `_nodes/stats` 逐 index 回報文件數與大小，`_nodes/settings` 與
 *   `_nodes/hot_threads` 帶得出路徑、設定值與執行中的查詢文字。
 *
 * 關掉一扇門，旁邊那扇通往同一個房間的門不能開著。
 */
const UNSCOPED_METADATA_WITHHELD: Record<string, ReadonlySet<string>> = {
  _cluster: new Set(['state']),
  _cat: new Set(['tasks']),
  _nodes: new Set(['stats', 'settings', 'hot_threads']),
}

export function isUnscopedMetadataPath(path: string): boolean {
  const segments = path.replace(/^\//, '').split('?')[0]?.split('/') ?? []
  const first = segments[0] ?? ''
  if (!UNSCOPED_METADATA_PREFIXES.includes(first)) return false
  const withheld = UNSCOPED_METADATA_WITHHELD[first]
  if (withheld === undefined) return true
  // `_nodes/<nodeId>/stats` 一樣要擋：被扣住的名稱出現在**任何**位置都算，
  // 因為 node id 是使用者可寫的一段。
  return !segments.slice(1).some((segment) => withheld.has(segment.toLowerCase()))
}

/**
 * Index names carried in a request *body*.
 *
 * `_mget` takes `docs[]._index`, a `terms` lookup takes `index`, and
 * `_reindex` takes `source.index`. Scanning for the key anywhere in the
 * document over-reports — an ordinary field called `index` becomes a candidate
 * — which refuses more rather than less.
 *
 * Objects and arrays only. A JSON *string* body is never walked, which is why
 * `runEsRequest` refuses one outright: `"{\"delete\":{\"_index\":\"secrets\"}}\n"`
 * is a legal JSON document that `parseEsRequest` turns into a JS string
 * carrying NDJSON, and it reached a blacklisted index from a path naming an
 * innocuous one. An earlier comment here claimed NDJSON bodies were
 * unreachable; they were not.
 */
export function findIndexNamesInBody(body: unknown): string[] {
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '_index' || key === 'index') {
        // The value may be an array — `_msearch` headers and `_reindex`'s
        // `source.index` both accept one, and a string never recurses.
        for (const candidate of Array.isArray(value) ? value : [value]) {
          if (typeof candidate === 'string' && candidate.length > 0) found.push(candidate)
        }
      }
      walk(value)
    }
  }
  walk(body)
  return found
}

/**
 * The request target as the transport will send it, or `null` when it cannot be
 * parsed at all.
 *
 * Path *and* query together. Byte-identity against `canonical` is what keeps
 * every check in this file reading the same string Elasticsearch will, and it
 * has to cover the query string because that is where a request body can hide.
 */
export function parseRequestTarget(rawPath: string): { url: URL; canonical: string } | null {
  try {
    const url = new URL(rawPath, ES_PATH_PARSE_BASE)
    return { url, canonical: `${url.pathname}${url.search}` }
  } catch {
    return null
  }
}

const ES_PATH_PARSE_BASE = 'http://dbcli.invalid'

/** Every string in a request body, at any depth, including object keys. */
export function findStrings(node: unknown): string[] {
  const found: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      found.push(value)
      // `doc['password'].value` and `params.field` name the field inside a
      // larger string, so the identifier-like pieces count too.
      for (const piece of value.split(/[^A-Za-z0-9_.]+/)) {
        if (piece.length > 0 && piece !== value) found.push(piece)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      found.push(key)
      walk(nested)
    }
  }
  walk(node)
  return found
}

/** Remove every occurrence of a protected field name, at any depth. */
/**
 * Whether a term names a protected field anywhere in a dotted path.
 *
 * Exact matching was not enough in either direction. `password.keyword` is the
 * multi-field the standard dynamic mapping creates for every `text` field, so
 * `?docvalue_fields=password.keyword` returned the value in full while the
 * plain spelling was refused; and `params._source.password`, which is how a
 * Painless script in `script_fields` or `runtime_mappings` reads a field, puts
 * the protected name at the *end* of a dotted term, where a prefix rule would
 * miss it.
 *
 * So every component counts. `password_hash.keyword` is untouched — it shares
 * no component with `password` — and the one over-refusal this admits, an
 * unrelated field called `x.password`, errs toward withholding.
 *
 * **Ceilings, which no term rule can close.** A mapping-level `alias` field
 * naming the protected field under a different word is server-side knowledge,
 * the same class as alias-to-index resolution. A script that assembles the name
 * (`doc['pass' + 'word']`) defeats any literal scan. And a wildcard field
 * expression is expanded after the request leaves: `?q=pass*:hunter*` is a
 * match oracle over a protected column, because hit counts answer the question
 * without the value ever appearing in a response key. Wildcards that *return*
 * values are still caught, but by `redactFields` on the way back rather than
 * here — that backstop is load-bearing, not incidental. Chasing the oracle with
 * glob matching would mean guessing Elasticsearch's wildcard semantics, which
 * is the approximate-the-parser mistake in a third field.
 */
/**
 * 這個 term 有沒有指到受保護的欄位。
 *
 * 比對的是**連續的點分元件區段**，不是整串相等、也不是單一元件。舊版先比整串
 * 再把 term 拆成單一元件逐一比對，而拆出來的元件永遠不含 `.`——所以一個含 `.`
 * 的黑名單設定（`user.password`）永遠不可能被任何元件命中，整條檢查對它毫無
 * 作用。ES 的 object field 一律以點分名稱呈現，那是最自然的設定寫法。
 *
 * 區段比對同時涵蓋兩端的擴充：`user.password.keyword` 是 multi-field 子欄位，
 * `params._source.user.password` 是 Painless 的讀法，受保護的名稱可以落在點分
 * 路徑的任一段。代價是過度比對——回應裡任何以 `user.password` 結尾的路徑都會
 * 被遮——而那是withholding 的方向。
 */
export function namesProtectedField(term: string, protectedFields: ReadonlySet<string>): boolean {
  // Folded and glob-matched by the same functions the SQL, MongoDB and write
  // paths use. Byte-for-byte comparison made this the fifth matcher of one
  // config: `dbcli es` returned under a rule `Password` or `pass*` what
  // `dbcli query --index` masked. ADR-0020 Decision 1, ADR-0019 Decision 2.
  return reachesProtected(foldFieldPath(term), contiguousRulesFor(protectedFields))
}

/** The same question with the fold and the glob compilation already done. */
function reachesProtected(folded: string, rules: ContiguousRules): boolean {
  return reachesProtectedPath(folded, rules)
}

export function redactFields(node: unknown, fields: Set<string>, trail: string[] = []): unknown {
  // 與走訪時同一條規則：trail 的每一段也可能是點分的，展開成元件而不是當成一段。
  return redactWithGlobs(
    node,
    contiguousRulesFor(fields),
    trail.flatMap((entry) => foldFieldPath(entry).split('.'))
  )
}

/**
 * The recursion, with the trail carried already folded and the glob rules
 * compiled once for the whole response.
 *
 * A response is walked key by key, so folding the trail per key and recompiling
 * the rules per key measured 2.4x on 1000 hits x 20 fields.
 */
function redactWithGlobs(node: unknown, rules: ContiguousRules, trail: string[]): unknown {
  // 陣列不進 trail：`hits.hits[]` 的索引不是欄位路徑的一部分。
  if (Array.isArray(node)) return node.map((item) => redactWithGlobs(item, rules, trail))
  if (node === null || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // Same rule as the request-side check. A dotted response key is a field
    // path — a `fields`/`docvalue_fields` entry or an aggregation name — so
    // there is no shape where `password.<something>` is unrelated data.
    // `fields[password.keyword]` survived an exact-key match. This is also the
    // backstop for a wildcard field expression, which expands server-side and
    // comes back under the real field name.
    //
    // 帶著走過的鍵：ES 的 object field 在回應裡是**巢狀的**（`_source.user.password`），
    // 但在設定與 `fields` 裡是點分的（`user.password`）。只看單一個鍵的話，
    // 巢狀那一側的每一層都不等於任何黑名單項目，於是含 `.` 的設定對回應毫無
    // 作用。信封鍵（`hits`、`_source`）留在 trail 裡無妨——比對只看結尾的
    // 連續區段。
    // 鍵自己就可能是點分的（`fields` 的 `user.password.keyword`、一個聚合的
    // 名稱）。這裡展開成元件是為了**維持**先前的答案而不是改變它：舊版
    // `join('.')` 完馬上在比對裡 `split('.')` 回去，等於已經把這種鍵切開了。
    // 少了這一行，比對會把整個鍵當成一段，`user.password` 就構不到它。
    const path = [...trail, ...foldFieldPath(key).split('.')]
    if (reachesProtectedSegments(path, rules)) continue
    out[key] = redactWithGlobs(value, rules, path)
  }
  return out
}

/** The request as an operator typed it: a method, a raw path, an optional parsed body. */
export interface EsRequest {
  method: string
  path: string
  body?: unknown
}

/**
 * Refuse a path that is not, byte for byte, what the transport will send.
 *
 * `target` is `parseRequestTarget(req.path)`; `null` means it could not be
 * parsed at all, which is itself a refusal.
 */
export function assertRequestTargetIsCanonical(
  req: EsRequest,
  target: { url: URL; canonical: string } | null
): void {
  // Byte-identity against the parser the request will actually go through.
  //
  // Comparing against a dbcli-owned normaliser is what let `#` through:
  // `POST /_reindex#/_count` read here as a two-segment count while `fetch`
  // sent `POST /_reindex`, and tab, LF, CR and `\` are the same shape of gap.
  // The rule is deliberately unforgiving — no resolution, no repair — because
  // any softening reintroduces a second path function, which is the class of
  // defect this removes. The canonical spelling is handed back so an operator
  // who wrote a legitimate path with a space or a non-ASCII document id can
  // copy the answer rather than guess at an encoding.
  // 位元組同一性擋得住字面的 `..`（`/_cat/../secrets/_search` 的 canonical
  // 不同），擋不住編碼的：`%2F` 原封不動留在 `url.pathname` 裡，所以
  // `/secrets%2F..%2Fpublic/_search` 通得過。但 `normalizeEsPath` 會先把
  // `%2F` 解碼成 `/` 再讓 `..` 刪掉前一段，於是 `secrets` 從路徑檢查、
  // index 抽取與 audit 三處同時消失，而伺服器收到的是一整段 index
  // expression。dbcli 分辨不出伺服器怎麼解讀它——所以拒絕，不正規化。
  // 這與上面那條是同一個原則：不近似傳輸層的行為。
  const decodedPath = ((): string => {
    try {
      return decodeURIComponent(target?.url.pathname ?? req.path)
    } catch {
      return target?.url.pathname ?? req.path
    }
  })()
  if (decodedPath.split('/').includes('..')) {
    throw new Error(t_vars('shell.es.refuse_dot_segment', { path: req.path }))
  }

  if (target === null || target.canonical !== req.path) {
    throw new Error(
      target === null
        ? t_vars('shell.es.refuse_unparseable', { path: req.path })
        : t_vars('shell.es.refuse_not_canonical', { path: req.path, canonical: target.canonical })
    )
  }
}

/**
 * Refuse the two ways a request body can arrive somewhere the body-side checks
 * do not look: the `source` query parameter, and a search template.
 */
export function assertNoSmuggledBody(
  req: EsRequest,
  query: URLSearchParams,
  routedPath: string
): void {
  // Elasticsearch accepts `source=<json>&source_content_type=...` in place of
  // a request body, and every body-side check here — protected fields, index
  // names, the size cap — reads `req.body`. Refusing the parameter restores
  // that invariant instead of teaching four checks about a second body.
  if (query.has('source')) {
    throw new Error(t('shell.es.refuse_source_param'))
  }

  // Search templates carry their body inside a string, or not at all.
  //
  // `{"source":"{\"query\":{\"terms\":{\"u\":{\"index\":\"secrets\"}}}}"}`
  // renders server-side into a full search body, and every body-side check
  // here walks objects — a string is never entered, so the index it names is
  // invisible. A stored template (`{"id":"t"}`) is worse: the content is not
  // in the request at all. Same rule as `wrapper` and as a quoted string body:
  // what dbcli cannot inspect, it does not forward.
  if (routedPath.split('/').some((segment) => segment.toLowerCase() === 'template')) {
    throw new Error(t_vars('shell.es.refuse_search_template', { path: req.path }))
  }

  // A JSON string body carries NDJSON past every check that walks objects.
  // Nothing legitimate produces one — `parseEsRequest` yields a string only
  // when the operator wrote a quoted literal — so it is refused rather than
  // parsed.
  if (typeof req.body === 'string') {
    throw new Error(t('shell.es.refuse_string_body'))
  }
}

/**
 * Whether the object-scoped checks have a subject at all.
 *
  // The rest of this block answers questions *about the blacklist* — a path
  // that cannot be attributed to an index cannot be checked against one — so
  // with nothing configured there is nothing to check and refusing would cost
  // an ordinary query while protecting nothing.
  //
  // "Nothing configured" means *neither* list. Keying this on `blacklistTables`
  // alone skipped the unscoped-path guard below for a columns-only blacklist,
  // and that guard is what holds `_sql`, `_mget` and `_search/scroll` shut —
  // `_sql` returns values in a `rows` array, so key-based redaction cannot
  // reach them at all.
 *
 * Recorded as ADR-0014 Decision 9: this is why US 14 and US 15 do not hold for
 * a connection with no blacklist. The tier gate above it is unconditional.
 */
export function blacklistIsConfigured(
  blacklistTables: string[],
  blacklistColumns: Record<string, string[]>
): boolean {
  const columnsConfigured = Object.values(blacklistColumns).some((fields) => fields.length > 0)
  return blacklistTables.length > 0 || columnsConfigured
}

/** Refuse a request that names a blacklisted index — in its path, or in its body. */
export function assertNoBlacklistedIndexNamed(args: {
  req: EsRequest
  routedPath: string
  index: string | undefined
  blacklistTables: string[]
}): void {
  const { req, routedPath, index, blacklistTables } = args
  if (blacklistTables.length > 0) {
    // Any segment naming a blacklisted index is refused, whatever the endpoint
    // — `/_cat/indices/secrets` reports on it without reading documents, and
    // the blacklist is about the object, not only its contents.
    const blacklistedSegment = routedPath
      .split('/')
      .find((segment) => segment.length > 0 && indexExpressionReaches(segment, blacklistTables))
    if (blacklistedSegment !== undefined) {
      throw new Error(
        `${BLACKLIST_REJECTION}${t_vars('shell.es.blacklist_index', { index: blacklistedSegment })}`
      )
    }
  }

  if (index === undefined) {
    // The path names no index. `GET /_search`, `/_all/_search`, `/_msearch`,
    // `/_mget` and `/_sql` all read documents from every index, so a request
    // that cannot be scoped cannot be checked. Endpoints that return only
    // cluster metadata are listed rather than guessed at, because a deny-list
    // here would have to enumerate every document-returning endpoint that
    // exists now or later.
    if (!isUnscopedMetadataPath(routedPath)) {
      throw new Error(
        `${BLACKLIST_REJECTION}${t_vars('shell.es.blacklist_unscoped', { path: req.path })}`
      )
    }
  }

  // The body names indices too: `_mget`'s `docs[]._index`, `_bulk`'s action
  // `_index`, and a `terms` lookup's `index`. Scoping the *path* to a
  // harmless index is exactly what re-opened those endpoints.
  const inBody = findIndexNamesInBody(req.body).find((name) =>
    indexExpressionReaches(name, blacklistTables)
  )
  if (inBody !== undefined) {
    throw new Error(
      `${BLACKLIST_REJECTION}${t_vars('shell.es.blacklist_index', { index: inBody })}`
    )
  }
}

/**
  // Removing protected keys from the response is not enough: Elasticsearch
  // returns a field's value under a key the *request* chooses — `sort`,
  // `aggs.*.field`, `script_fields`, `docvalue_fields`, a runtime field. So a
  // request that names a protected field anywhere is refused. Any string in the
  // body counts, which over-refuses (a document value that happens to equal a
  // protected field name is refused too) in the direction that withholds data.
  // 正規化與設定載入器同一支 `normalizeBlacklistEntry`：`[" password "]` 與
  // `['"Token"']` 這種寫法保證是死設定——ES 的欄位名不能帶前後空白或引號——
  // 卻沒有任何提示。先前這裡只做 trim，於是引號那一種在 ES shell 上仍是死的，
  // 在其他引擎上卻有效。ADR-0020。
  const protectedFields = new Set(
    Object.values(blacklistColumns)
      .flat()
      .map(normalizeBlacklistEntry)
      .filter((field) => field.length > 0)
  )
 */
export function collectProtectedFields(blacklistColumns: Record<string, string[]>): Set<string> {
  // Normalised by the config loader's own function, so a quoted or padded entry
  // means here what it means everywhere else. Folding and glob compilation
  // happen in `contiguousRulesFor`, which keeps the two halves apart; a
  // pattern's text is never rewritten. ADR-0020.
  const fields = new Set(
    Object.values(blacklistColumns)
      .flat()
      .map(normalizeBlacklistEntry)
      .filter((field) => field.length > 0)
  )
  // Split and compiled here, before the request is sent, rather than on the
  // first key of the response: a rule the matcher cannot read has to refuse the
  // request, and refusing it on the way back means the cluster already acted on
  // it. Every other path in the blacklist rejects before it does any work —
  // ADR-0019 Decision 3.
  contiguousRulesFor(fields)
  return fields
}

/**
 * The terms in a query string that could be naming a field.
 *
 * Split two ways and unioned — see the comments below for why one splitter
 * alone has a half it cannot hold.
 */
function queryStringFieldTerms(query: URLSearchParams): string[] {
  // The URI-search form names fields in the query string rather than the
  // body — `?q=password:*`, `?sort=password:asc`, `?docvalue_fields=`,
  // `?_source_includes=` — and each returns the value under a key the
  // request chose, which is the same disclosure the body check exists to
  // stop. Values are split on the separators Elasticsearch accepts inside
  // them so a field named among several is still seen.
  // 兩套切法都跑，取聯集。
  //
  // Lucene 會把運算子貼在欄位名上（`+password`、`password*`、`!password`），
  // 所以要有一套把那些字元當分隔符的切法；但 Elasticsearch 的欄位名**本身**
  // 就允許 `-`、`*`、`|`、`/` 這些字元，`user-password` 是常見命名，只用
  // 加寬的那套會把它切成 `user` 與 `password`——兩者都不在黑名單裡，於是
  // 一個原本擋得住的欄位變成擋不住。
  //
  // 單獨任一套都有它擋不住的一半，而這裡的錯誤方向只有一種是可接受的：
  // 多切一次只會多幾個不命中的 term，少切一次會漏掉一個受保護的欄位。
  const CONSERVATIVE = /[\s,:()"'[\]{}]+/
  const LUCENE_OPERATORS = /[\s,:()"'[\]{}+\-*!^~|;/\\]+/
  // `routing` / `scroll` / `preference` / `filter_path` 的值不含欄位名，
  // 而加寬的切法會把 `?routing=abc-name-1` 切出 `name`——黑名單欄位叫
  // `name` 時那是純誤擋，路徑上沒有任何欄位名語意可言。
  const NON_FIELD_PARAMS = new Set([
    'routing',
    'scroll',
    'scroll_id',
    'preference',
    'filter_path',
    'pipeline',
    'refresh',
    'timeout',
    'wait_for_completion',
  ])
  const queryTerms = [...query.entries()]
    .filter(([name]) => !NON_FIELD_PARAMS.has(name.toLowerCase()))
    .flatMap(([, value]) =>
      [value, ...value.split(CONSERVATIVE), ...value.split(LUCENE_OPERATORS)].filter(
        (term) => term.length > 0
      )
    )
  return queryTerms
}

/** Refuse a request that names a protected field anywhere — body or query string. */
export function assertNoProtectedFieldNamed(
  req: EsRequest,
  query: URLSearchParams,
  protectedFields: ReadonlySet<string>
): void {
  if (protectedFields.size === 0) return
  const named = [...findStrings(req.body), ...queryStringFieldTerms(query)].find((text) =>
    namesProtectedField(text, protectedFields)
  )
  if (named !== undefined) {
    throw new Error(`${BLACKLIST_REJECTION}${t_vars('shell.es.blacklist_field', { field: named })}`)
  }
}

/** The body to send: `req.body` with the shell's search size cap injected when it applies. */
export function capSearchSize(req: EsRequest): unknown {
  // A convenience default, not a control. `{"size": 100000}` is honoured
  // because the cap is only injected when `size` is absent, and `from`,
  // `search_after` and `scroll` are not bounded at all. What bounds disclosure
  // on this path is the blacklist and the permission tier; this only stops an
  // unqualified `_search` from filling a terminal.
  //
  // Read from the routed path, not a substring of the raw one: `PUT
  // /orders/_doc/_search` is a write whose *id* is `_search`, and
  // `?routing=_search` is not a path at all. Both used to be treated as
  // searches here and had `size` written into the document — a check reading
  // one set of bytes while another goes out, which is the shape of the two
  // earlier CRITICALs. This was the last raw-path substring test in the file.
  // 讀的是與 `classifyElasticsearchRequest` **同一個**路徑函式
  // （`routedPathname`，不解碼），method 條件也與規則 2 相同。先前這裡讀
  // `normalizeEsPath`（會解碼）又不看 method，於是 `PUT /orders/_search` 與
  // `POST /orders/%5Fsearch` 上兩者給出不同答案。
  //
  // 刻意**不**完全等同規則 2：規則 2 也涵蓋 `_count`，而 `_count` 不吃 `size`，
  // 注進去只會讓 Elasticsearch 回錯誤。差異寫在這裡，不寫成「一致」——上一輪
  // 這句註解就是宣稱一致而實際不是，而錯的那一半沒人去查。
  const searchSegments = routedPathname(req.path)
    .split('/')
    .filter((segment) => segment.length > 0)
  const searchMethod = ['GET', 'HEAD', 'POST'].includes(req.method.toUpperCase())
  const searchesDocuments =
    searchMethod &&
    searchSegments[searchSegments.length - 1]?.toLowerCase() === '_search' &&
    searchSegments.length <= 2
  let body = req.body
  if (
    searchesDocuments &&
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as { size?: number }).size === undefined
  ) {
    body = { ...(body as Record<string, unknown>), size: ES_SHELL_SIZE_CAP }
  }
  return body
}
