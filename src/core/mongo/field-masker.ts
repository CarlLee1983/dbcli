import { BlacklistError, type BlacklistConfig } from '@/types/blacklist'
import { compilePatterns, matchAny, type MongoPathPattern } from './path-matcher'
import { foldFieldPath } from '@/core/blacklist-fold'
import { escapeGlob } from '@/utils/glob'
import { globMatches } from '@/utils/glob'
import type { MongoCollectionScope } from './collection-references'

const REDACTED = '[REDACTED]'

/**
 * Apply the rules of every collection a pipeline touches.
 *
 * A `$lookup` embeds documents from another collection under its `as` name, so
 * that collection's rules have to be matched at `<as>.<field>` as well as at
 * the top level — a rule written `secrets: ['token']` protects `sec.token` in
 * the joined result. Masking is immutable, so the rules are folded one scope at
 * a time.
 */
export function maskMongoRowsForCollections(
  rows: Record<string, unknown>[],
  collections: (string | MongoCollectionScope)[],
  blacklist: BlacklistConfig
): Record<string, unknown>[] {
  const columns = blacklist.columns ?? {}
  return collections.reduce((masked, entry) => {
    const scope: MongoCollectionScope = typeof entry === 'string' ? { collection: entry } : entry
    const atTopLevel = maskMongoRows(masked, scope.collection, blacklist)
    if (!scope.prefix) return atTopLevel

    const rules = columns[scope.collection] ?? findCaseInsensitive(columns, scope.collection)
    if (!rules || rules.length === 0) return atTopLevel

    // Same rules, re-anchored under the embedding path. The prefix is the
    // request's `as` name, not a pattern, so it is escaped before being spliced
    // into one — a `\` in it read as glob syntax and disabled the rule
    // (ADR-0019 Decision 5). Keyed by a name that cannot collide with a real
    // collection.
    const prefixKey = `\u0000${scope.collection}@${scope.prefix}`
    return maskMongoRows(atTopLevel, prefixKey, {
      ...blacklist,
      columns: {
        ...columns,
        [prefixKey]: rules.map((rule) => `${escapeGlob(scope.prefix as string)}.${rule}`),
      },
    })
  }, rows)
}

export function maskMongoRows(
  rows: Record<string, unknown>[],
  collection: string,
  blacklist: BlacklistConfig
): Record<string, unknown>[] {
  const columns = blacklist.columns ?? {}
  const raw = columns[collection] ?? findCaseInsensitive(columns, collection)
  if (!raw || raw.length === 0) return rows

  const { patterns, rejected } = compilePatterns(raw)
  // A rule the matcher cannot read is a rule that protects nothing, and the
  // caller prints "Some fields may have been redacted" either way — the notice
  // was the operator's only evidence the blacklist worked. ADR-0019 Decision 3.
  if (rejected.length > 0) {
    const detail = rejected.map((r) => `'${r.raw}' (${r.reason})`).join(', ')
    throw new BlacklistError(
      `blacklist.columns for '${collection}' has entries this matcher cannot read: ${detail}`,
      collection,
      'READ'
    )
  }
  if (patterns.length === 0) return rows

  // A segment is a glob since ADR-0019, so this asks whether the pattern
  // covers `_id` rather than comparing its text.
  const idAffected = patterns.some(
    (p) =>
      p.segments.length === 1 &&
      !p.wildcardTail &&
      globMatches(p.segments[0]!, '_id', { caseInsensitive: true })
  )
  if (idAffected) {
    console.error(
      `[blacklist] collection '${collection}' blacklists '_id'; read paths still expose _id to preserve document references.`
    )
  }

  return rows.map((row) => maskRecord(row, '', patterns))
}

function maskRecord(
  obj: Record<string, unknown>,
  prefix: string,
  patterns: ReadonlyArray<MongoPathPattern>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_id' && prefix === '') {
      out[key] = value
      continue
    }
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (matchAny(path, patterns)) {
      out[key] = REDACTED
      continue
    }
    out[key] = maskValue(value, path, patterns)
  }
  return out
}

function maskValue(
  value: unknown,
  path: string,
  patterns: ReadonlyArray<MongoPathPattern>
): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    // Through nested arrays too: an element that was itself an array used to be
    // returned untouched, so `{list: [[{ssn: …}]]}` kept its plaintext under a
    // rule `list.ss*` that the SQL read path masked. An array is a container,
    // not a path segment, at whatever depth it appears.
    return value.map((item) => maskValue(item, path, patterns))
  }
  if (typeof value === 'object') {
    return maskRecord(value as Record<string, unknown>, path, patterns)
  }
  return value
}

/**
 * 挑選規則也是一次名稱比對，所以走同一個折疊函式。
 *
 * 裸的 `toLowerCase` 曾與 `foldFieldPath` 一致——因為那時 `foldFieldPath` 就是
 * `toLowerCase`。ADR-0020 Decision 4 讓它不再是，於是設定在 `ασ` 底下的規則
 * 對 collection `ΑΣ` 查不到，而查不到的意思是「沒有規則」：明文原樣回傳。
 */
function findCaseInsensitive(
  columns: Record<string, string[]>,
  name: string
): string[] | undefined {
  const target = foldFieldPath(name)
  for (const [k, v] of Object.entries(columns)) {
    if (foldFieldPath(k) === target) return v
  }
  return undefined
}
