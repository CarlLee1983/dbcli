import type { BlacklistConfig } from '@/types/blacklist'
import { compilePatterns, matchAny, type MongoPathPattern } from './path-matcher'
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

    // Same rules, re-anchored under the embedding path. Keyed by a name that
    // cannot collide with a real collection.
    const prefixKey = `\u0000${scope.collection}@${scope.prefix}`
    return maskMongoRows(atTopLevel, prefixKey, {
      ...blacklist,
      columns: { ...columns, [prefixKey]: rules.map((rule) => `${scope.prefix}.${rule}`) },
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

  const { patterns } = compilePatterns(raw)
  if (patterns.length === 0) return rows

  const idAffected = patterns.some(
    (p) => p.segments.length === 1 && p.segments[0] === '_id' && !p.wildcardTail
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
    return value.map((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? maskRecord(item as Record<string, unknown>, path, patterns)
        : item
    )
  }
  if (typeof value === 'object') {
    return maskRecord(value as Record<string, unknown>, path, patterns)
  }
  return value
}

function findCaseInsensitive(
  columns: Record<string, string[]>,
  name: string
): string[] | undefined {
  const target = name.toLowerCase()
  for (const [k, v] of Object.entries(columns)) {
    if (k.toLowerCase() === target) return v
  }
  return undefined
}
