import { createInterface } from 'node:readline'
import pc from 'picocolors'
import { configModule } from '../core/config'
import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import { indexExpressionReaches, normalizeEsPath } from '@/utils/es-index-target'
import {
  classifyElasticsearchRequest,
  enforceElasticsearchPermission,
} from '@/core/permission/elasticsearch'
import type { Permission } from '@/types'
import { writeAuditEntry } from '@/core/audit/integration-helper'

export interface EsRequest {
  method: string
  path: string
  body?: unknown
}

/** Parse a Kibana Dev Tools block: first line "<METHOD> /<path>", remaining lines an optional JSON body. */
export function parseEsRequest(block: string): EsRequest {
  const lines = block.replace(/\r\n/g, '\n').split('\n')
  const firstIdx = lines.findIndex((l) => l.trim() !== '')
  if (firstIdx === -1) throw new Error('Empty request')

  const header = lines[firstIdx]!.trim()
  const spaceIdx = header.indexOf(' ')
  if (spaceIdx === -1) {
    throw new Error('Request requires a method and a path, e.g. "GET /index/_search"')
  }
  const method = header.slice(0, spaceIdx).toUpperCase()
  const path = header.slice(spaceIdx + 1).trim()
  if (!path) throw new Error('Request requires a path')

  const bodyText = lines
    .slice(firstIdx + 1)
    .join('\n')
    .trim()
  if (!bodyText) return { method, path }
  return { method, path, body: JSON.parse(bodyText) }
}

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
 */
const UNSCOPED_METADATA_PREFIXES = ['_cat', '_cluster', '_nodes', '_tasks', '_ingest', '_license']

function isUnscopedMetadataPath(path: string): boolean {
  const first = path.replace(/^\//, '').split('/')[0]?.split('?')[0] ?? ''
  return UNSCOPED_METADATA_PREFIXES.includes(first)
}

/**
 * Index names carried in a request *body*.
 *
 * `_mget` takes `docs[]._index`, a `terms` lookup takes `index`, and
 * `_reindex` takes `source.index`. Scanning for the key anywhere in the
 * document over-reports — an ordinary field called `index` becomes a candidate
 * — which refuses more rather than less.
 *
 * NDJSON bodies (`_bulk`, `_msearch`) are out of reach today: `parseEsRequest`
 * JSON-parses the whole body, so a multi-line request never gets this far. This
 * function already handles their shapes, so adding NDJSON support does not
 * reopen the hole — but until it does, the coverage here is untested against a
 * real bulk body.
 */
function findIndexNamesInBody(body: unknown): string[] {
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

interface EsRequestCapable {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

const ES_SHELL_SIZE_CAP = 1000

/**
 * The tier an Elasticsearch shell session runs under.
 *
 * Absent configuration means the most restrictive tier, not the most
 * permissive: a connection that never said what it may do has not said it may
 * write. Named and exported so the default is pinned by a test rather than
 * living as an inline `??` nobody asserts.
 */
export function resolveEsShellPermission(config: { permission?: Permission }): Permission {
  return config.permission ?? 'query-only'
}

/**
 * What the shell tells its caller about a request it handled.
 *
 * Passed in rather than written here so the audit trail is exercised at the
 * same seam as everything else in this function, and so this module keeps no
 * opinion about where an entry goes.
 */
export interface EsShellAuditSink {
  (record: {
    success: boolean
    error?: unknown
    target?: string
    /**
     * Set only when the request writes. The audit helper otherwise labels the
     * entry with the command's capability tier; this field overrides that for a
     * statement whose effect differs from its command's, which is why the same
     * destructive operation was once filed under three different tiers
     * depending on which command reached it.
     */
    tierOverride?: 'db-write'
  }): Promise<void | string | null>
}

export interface RunEsRequestOptions {
  /**
   * The configured tier. Required and undefaulted: a default here would be the
   * bypass this parameter exists to close, and it would be invisible at every
   * call site that forgot to pass one.
   */
  permission: Permission
  audit?: EsShellAuditSink
}

/**
 * Enforce the permission tier and the index blacklist, cap a search, then issue
 * the request.
 *
 * The permission check is new. `dbcli shell` forks to this module before
 * reaching the gate that covers its SQL and Redis branches, so a `query-only`
 * connection could delete every document in an index, drop the index, or
 * rewrite its mapping — each of them refused when the same request goes through
 * `dbcli query`. The classifier below is the one `query` uses; the shell hands
 * it the real method and path, where `query` can only synthesise a search.
 */
export async function runEsRequest(
  req: EsRequest,
  adapter: EsRequestCapable,
  blacklistTables: string[],
  blacklistColumns: Record<string, string[]> = {},
  options: RunEsRequestOptions
): Promise<unknown> {
  // Resolved first: `/%5Fsearch` is `/_search`, `/secrets%2F_search` is
  // `/secrets/_search`, and `/_cat/../secrets/_search` resolves to
  // `/secrets/_search`. Checking the raw text answers a question about a
  // request the server will never see.
  const rawPath = req.path.split('?')[0] ?? req.path
  const routedPath = normalizeEsPath(rawPath)
  const index = extractIndexFromPath(routedPath)

  // `_bulk` is classified from its NDJSON body, which arrives here already
  // parsed, so it goes back to text for the classifier rather than the
  // classifier growing a second input shape.
  const bodyText =
    req.body === undefined
      ? undefined
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)
  const esRequest = { method: req.method, apiPath: req.path, body: bodyText }

  // Classified once for the audit tier, which has to be recorded whether the
  // request is executed or refused. Recording the command's capability tier
  // instead — what the audit helper defaults to — files every shell entry under
  // one label and is a known defect: the same destructive operation ended up
  // audited as three different tiers depending on which command reached it.
  const classification = classifyElasticsearchRequest(esRequest)
  const tierOverride = classification.type === 'SELECT' ? undefined : ('db-write' as const)

  const audit = async (success: boolean, error?: unknown): Promise<void> => {
    if (!options.audit) return
    await options.audit({ success, error, target: index, tierOverride })
  }

  try {
    return await execute()
  } catch (error) {
    await audit(false, error)
    throw error
  }

  async function execute(): Promise<unknown> {
    // The tier gate, which this path did not have. It runs before the blacklist
    // because it is the coarser question: whether this caller may perform this
    // kind of operation at all, on any object.
    enforceElasticsearchPermission(esRequest, options.permission)

    // Conditional on a blacklist existing, deliberately. Every refusal in this
    // block answers a question about the blacklist — a path that cannot be
    // attributed to an index cannot be *checked against* one, and a path that
    // routes somewhere other than it spells evades that check. With nothing
    // configured there is no check to evade, so refusing `GET /_search` would
    // cost an ordinary query and protect nothing. The danger that made this
    // look unconditional — `DELETE /_all` at `query-only` — is refused by the
    // tier gate above, which is where it belongs.
    if (blacklistTables.length === 0) return send()

    // Refuse rather than silently check one string and send another: the HTTP
    // client resolves dot segments and percent-encoding itself, so a path whose
    // routing differs from its text is an obfuscated path, not a typo.
    const literalSegments = `/${rawPath.split('/').filter(Boolean).join('/')}`
    if (routedPath !== literalSegments) {
      throw new Error(
        `BlacklistRejection: '${req.path}' routes to '${routedPath}', which is not what it ` +
          `spells. Write the path the server will receive.`
      )
    }

    // Any segment naming a blacklisted index is refused, whatever the endpoint
    // — `/_cat/indices/secrets` reports on it without reading documents, and
    // the blacklist is about the object, not only its contents.
    const blacklistedSegment = routedPath
      .split('/')
      .find((segment) => segment.length > 0 && indexExpressionReaches(segment, blacklistTables))
    if (blacklistedSegment !== undefined) {
      throw new Error(`BlacklistRejection: index '${blacklistedSegment}' is blacklist-protected`)
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
          `BlacklistRejection: '${req.path}' names no index, so it cannot be checked against ` +
            `the blacklist. Scope the request to an index, e.g. GET /<index>/_search.`
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
      throw new Error(`BlacklistRejection: index '${inBody}' is blacklist-protected`)
    }

    return send()
  }

  async function send(): Promise<unknown> {
    // Removing protected keys from the response is not enough: Elasticsearch
    // returns a field's value under a key the *request* chooses — `sort`,
    // `aggs.*.field`, `script_fields`, `docvalue_fields`, a runtime field. So a
    // request that names a protected field anywhere is refused. Any string in the
    // body counts, which over-refuses (a document value that happens to equal a
    // protected field name is refused too) in the direction that withholds data.
    const protectedFields = new Set(Object.values(blacklistColumns).flat())
    if (protectedFields.size > 0) {
      const named = findStrings(req.body).find((text) => protectedFields.has(text))
      if (named !== undefined) {
        throw new Error(
          `BlacklistRejection: field '${named}' is blacklist-protected and cannot be named in a ` +
            `request — sorting, aggregating or scripting on it would return its values.`
        )
      }
    }

    let body = req.body
    if (
      req.path.includes('_search') &&
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      (body as { size?: number }).size === undefined
    ) {
      body = { ...(body as Record<string, unknown>), size: ES_SHELL_SIZE_CAP }
    }

    const response = await adapter.request(req.method, req.path, body)
    await audit(true)

    // `dbcli query --index users` hides these fields; the shell returned them in
    // full because it never consulted `blacklist.columns`. An Elasticsearch
    // response is an arbitrary document shape, so rather than model `hits.hits`
    // and every other envelope, any key matching a protected field name is
    // removed wherever it appears. That over-masks — a metadata key of the same
    // name goes too — which is the direction that does not disclose.
    return protectedFields.size === 0 ? response : redactFields(response, protectedFields)
  }
}

/** Every string in a request body, at any depth, including object keys. */
function findStrings(node: unknown): string[] {
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
function redactFields(node: unknown, fields: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => redactFields(item, fields))
  if (node === null || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (fields.has(key)) continue
    out[key] = redactFields(value, fields)
  }
  return out
}

export async function runEsShell(configPath: string): Promise<void> {
  const config = await configModule.read(configPath)
  const adapter = AdapterFactory.createElasticsearchAdapter(config.connection as ConnectionOptions)
  await adapter.connect()
  const blacklistTables = config.blacklist?.tables ?? []
  const blacklistColumns = config.blacklist?.columns ?? {}
  // `runShell` forks to this module before the branch that gates SQL and Redis,
  // so this is the only place the configured tier can enter the Elasticsearch
  // path.
  const permission = resolveEsShellPermission(config)

  console.error(pc.bold('Elasticsearch shell — Kibana Dev Tools syntax'))
  console.error(
    pc.dim(
      'Enter "<METHOD> /<path>" then an optional JSON body; submit with a blank line. Try: GET /_cat/indices'
    )
  )
  console.error(pc.dim('Ctrl+C cancels the current block; Ctrl+D or "exit" quits.'))
  console.error('')

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: pc.cyan('es> '),
    terminal: process.stdin.isTTY ?? false,
  })

  let blockLines: string[] = []
  const submit = async () => {
    const block = blockLines.join('\n').trim()
    blockLines = []
    rl.setPrompt(pc.cyan('es> '))
    if (block === '') return
    if (block === 'exit' || block === 'quit') {
      rl.close()
      return
    }
    try {
      const req = parseEsRequest(block)
      const res = await runEsRequest(
        req,
        adapter as never,
        blacklistTables,
        blacklistColumns as Record<string, string[]>,
        {
          permission,
          audit: (record) =>
            writeAuditEntry(
              config,
              'shell',
              { config: configPath },
              {
                success: record.success,
                error: record.error,
                target: record.target,
                sideEffectTier: record.tierOverride,
              }
            ),
        }
      )
      console.log(JSON.stringify(res, null, 2))
    } catch (error) {
      console.error(pc.red((error as Error).message))
    }
  }

  rl.prompt()
  rl.on('line', async (line: string) => {
    if (line.trim() === '') {
      await submit()
    } else {
      blockLines.push(line)
      rl.setPrompt(pc.dim('...  '))
    }
    rl.prompt()
  })
  rl.on('SIGINT', () => {
    blockLines = []
    rl.setPrompt(pc.cyan('es> '))
    console.error(pc.dim('(block cancelled)'))
    rl.prompt()
  })
  rl.on('close', async () => {
    await adapter.disconnect()
    console.error(pc.dim('Goodbye'))
    process.exit(0)
  })
}
