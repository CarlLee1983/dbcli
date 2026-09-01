export type FieldSelection =
  | { mode: 'include'; paths: readonly string[] }
  | { mode: 'exclude'; paths: readonly string[] }

const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function parseFieldSelection(raw: string | undefined): FieldSelection | undefined {
  if (raw === undefined) return undefined

  const tokens = raw.split(',').map((token) => token.trim())
  if (tokens.length === 0 || tokens.some((token) => token === '')) {
    throw new Error('--fields must not contain empty fields')
  }

  let mode: FieldSelection['mode'] | undefined
  const paths: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const tokenMode = token.startsWith('-') ? 'exclude' : 'include'
    const path = tokenMode === 'exclude' ? token.slice(1) : token
    if (path === '') throw new Error('--fields exclusion requires a field name after -')
    if (mode !== undefined && mode !== tokenMode) {
      throw new Error('--fields cannot mix included and excluded fields')
    }
    validatePath(path)
    if (seen.has(path)) throw new Error(`--fields contains duplicate field: ${path}`)
    mode = tokenMode
    seen.add(path)
    paths.push(path)
  }

  if (!mode || paths.length === 0) throw new Error('--fields must contain at least one field')
  return { mode, paths }
}

export function projectRows(
  rows: readonly Record<string, unknown>[],
  selection: FieldSelection
): { rows: Record<string, unknown>[]; columnNames: string[] } {
  if (selection.mode === 'include') {
    return {
      rows: rows.map((row) => {
        const projected: Record<string, unknown> = {}
        for (const path of selection.paths) {
          const result = readPath(row, path.split('.'))
          defineData(projected, path, result.found ? (result.value ?? null) : null)
        }
        return projected
      }),
      columnNames: [...selection.paths],
    }
  }

  const projectedRows = omitFieldPaths(rows, selection.paths)
  const columnNames = collectColumnNames(projectedRows)
  return { rows: normalizeRows(projectedRows, columnNames), columnNames }
}

// Takes pre-split segments rather than a dotted string so a caller probing many rows
// for the same path pays `split` once instead of once per row: the masker's fail-safe
// branch applies every rule in the config, so "many paths, almost no matches" is its
// normal shape, and the splitting alone measured a third of that branch's cost.
export function hasFieldPath(
  row: Record<string, unknown>,
  segments: readonly string[],
  options?: FieldPathOptions
): boolean {
  const caseInsensitive = options?.caseInsensitive === true
  // Folded once here rather than at every level of every row: the masker asks
  // this question once per dotted rule per row, so folding inside `readPath`
  // repeated the same `toLowerCase` tens of thousands of times.
  const folded =
    caseInsensitive && options?.alreadyFolded !== true
      ? segments.map((segment) => segment.toLowerCase())
      : segments
  return readPath(row, folded, caseInsensitive).found
}

/**
 * How a path is matched against a row's keys.
 *
 * `caseInsensitive` is what the blacklist masker passes and `--fields` does
 * not: a rule is compared to a name the request chose the case of, while a
 * `--fields` path is the operator naming keys of the document in front of them.
 * ADR-0020.
 */
export interface FieldPathOptions {
  readonly caseInsensitive?: boolean
  /**
   * The segments passed in are already folded. Lets a caller asking the same
   * rule of many rows fold it once instead of once per row.
   */
  readonly alreadyFolded?: boolean
}

export function omitFieldPaths(
  rows: readonly Record<string, unknown>[],
  paths: readonly string[],
  options?: FieldPathOptions
): Record<string, unknown>[] {
  const caseInsensitive = options?.caseInsensitive === true
  // `omitPath` rebuilds the whole record, so running it once per path made this
  // O(rows × paths) full copies — 100 rows against a 50-column blacklist cost 5000
  // rebuilds and ~35ms, which is why the masking benchmark had never met its 5ms
  // budget. A path without a dot only ever deletes one top-level key, and a column
  // blacklist is overwhelmingly such names, so those are collected into one pass
  // and only genuinely nested paths still recurse. Same output, ~50x faster.
  //
  // A dotted path has two jobs: delete a literal key of that exact name, and walk
  // into a nested record of the same head. The first is what `omitPath`'s
  // `key === exactPath` branch does, and the skip-set does it just as well — so
  // every path joins the skip-set, and the expensive recursion is reserved for the
  // rows that actually hold an object at the head. That distinction matters because
  // the Elasticsearch adapter flattens `_source`: its rows are *all* dotted keys and
  // no nested records, so masking them used to pay a full rebuild per path for
  // traversal that could never match. Measured on 1000 flattened docs with 6
  // protected fields: 10.9ms with the recursion, 2.0ms without.
  //
  // The decision is per row, not per result set. A single document whose `profile`
  // is an array (Elasticsearch does not flatten arrays) would otherwise put all
  // thousand rows back on the slow path — measured at 8.4ms for one nested row in
  // a thousand, over the benchmark's budget, for traversal 999 rows cannot use.
  //
  // Ceiling: a genuinely nested row still costs one rebuild per path that reaches it.
  const fold = (value: string): string => (caseInsensitive ? value.toLowerCase() : value)
  const topLevel = new Set<string>(paths.map(fold))
  const dotted = paths
    .filter((path) => path.includes('.'))
    .map((path) => ({ head: fold(path.slice(0, path.indexOf('.'))), segments: path.split('.') }))

  const maskRecord = (row: Record<string, unknown>): Record<string, unknown> => {
    let projected: unknown = cloneRecord(row, topLevel, caseInsensitive)
    for (const { head, segments } of dotted) {
      const value = headValue(row, head, caseInsensitive)
      if (value !== null && typeof value === 'object') {
        projected = omitPath(projected, segments, caseInsensitive)
      }
    }
    return projected as Record<string, unknown>
  }

  return rows.map((row) => {
    // A null/non-record row carries no field to mask. Returning it untouched only
    // moved the throw downstream (`query-executor` indexes into every row), and the
    // declared return type says these are records — so it becomes an empty one. Row
    // count and ordering are preserved, which is what callers actually index by.
    if (row === null || typeof row !== 'object') return {}
    // An array row is not a record, but `cloneRecord` treated it as one: the indices
    // became keys and every protected field inside the elements survived, so a row
    // reported as masked was returned intact. `readPath` — which decides *whether* a
    // field is there — walks arrays transparently, so masking has to see through them
    // the same way or the two disagree in the fail-open direction. The record-of-
    // indices shape is the one this already produced; only the leak is fixed.
    if (Array.isArray(row)) return maskArrayRow(row, maskRecord)
    return maskRecord(row)
  })
}

function maskArrayRow(
  row: readonly unknown[],
  maskRecord: (record: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  row.forEach((item, index) => {
    const masked = Array.isArray(item)
      ? maskArrayRow(item, maskRecord)
      : item !== null && typeof item === 'object'
        ? maskRecord(item as Record<string, unknown>)
        : item
    defineData(out, String(index), masked)
  })
  return out
}

export function toMongoProjection(selection: FieldSelection): Record<string, 0 | 1> {
  const projection: Record<string, 0 | 1> = {}
  const value = selection.mode === 'include' ? 1 : 0
  for (const path of selection.paths) defineData(projection, path, value)
  if (selection.mode === 'include' && !selection.paths.includes('_id')) {
    defineData(projection, '_id', 0)
  }
  return projection
}

function validatePath(path: string): void {
  const segments = path.split('.')
  if (segments.some((segment) => segment === '')) {
    throw new Error(`--fields contains an invalid dotted path: ${path}`)
  }
  const unsafe = segments.find((segment) => UNSAFE_SEGMENTS.has(segment))
  if (unsafe) throw new Error(`--fields contains an unsafe field segment: ${unsafe}`)
}

/** The row's value at `head`, found case-insensitively when asked. */
function headValue(row: Record<string, unknown>, head: string, caseInsensitive: boolean): unknown {
  if (!caseInsensitive) return row[head]
  const key = foldedKeys(row).get(head)
  return key === undefined ? undefined : row[key]
}

/**
 * A record's own keys indexed by their folded form, built once per record.
 *
 * Scanning the keys per lookup made the masker's nested probe quadratic in a
 * row's width: it asks `readPath` once per dotted rule per row and `readPath`
 * asks twice per level, so 2000 rows x 81 columns x 40 missing rules measured
 * 45ms unfolded and 417ms folded. The index restores the constant-time lookup
 * `hasOwnProperty` gave.
 *
 * Keyed weakly on the record, which every caller here treats as immutable —
 * masking returns new objects rather than editing a row in place. A record
 * mutated after it was indexed would be matched against its former key names.
 */
const foldedKeyIndex = new WeakMap<object, Map<string, string>>()

function foldedKeys(value: Record<string, unknown>): Map<string, string> {
  const memo = foldedKeyIndex.get(value)
  if (memo !== undefined) return memo
  const index = new Map<string, string>()
  for (const key of Object.getOwnPropertyNames(value)) {
    const folded = key.toLowerCase()
    if (!index.has(folded)) index.set(folded, key)
  }
  foldedKeyIndex.set(value, index)
  return index
}

/** The record's own key equal to `name`, folded when asked, or `undefined`. */
function ownKey(
  value: Record<string, unknown>,
  name: string,
  caseInsensitive: boolean
): string | undefined {
  // The exact key first, in both modes: a rule whose case already matches the
  // data — the common shape — never builds an index. In the folded mode `name`
  // arrives lower-cased from `hasFieldPath`, so this compares folded to folded.
  if (Object.prototype.hasOwnProperty.call(value, name)) return name
  if (!caseInsensitive) return undefined
  return foldedKeys(value).get(name)
}

function readPath(
  value: unknown,
  segments: readonly string[],
  caseInsensitive = false
): { found: boolean; value?: unknown } {
  if (segments.length === 0) return { found: true, value }
  if (Array.isArray(value)) {
    const results = value.map((item) => readPath(item, segments, caseInsensitive))
    return {
      found: results.some((result) => result.found),
      value: results.map((result) => (result.found ? result.value : undefined)),
    }
  }
  if (!isRecord(value)) return { found: false }

  const exact = ownKey(value, segments.join('.'), caseInsensitive)
  if (exact !== undefined) return { found: true, value: value[exact] }
  const [head, ...tail] = segments
  const headKey = ownKey(value, head!, caseInsensitive)
  if (headKey === undefined) return { found: false }
  return readPath(value[headKey], tail, caseInsensitive)
}

function omitPath(value: unknown, segments: readonly string[], caseInsensitive: boolean): unknown {
  if (segments.length === 0) return value
  if (Array.isArray(value)) return value.map((item) => omitPath(item, segments, caseInsensitive))
  if (!isPlainRecord(value)) return value

  const fold = (name: string): string => (caseInsensitive ? name.toLowerCase() : name)
  const exactPath = fold(segments.join('.'))
  const head = fold(segments[0]!)
  const tail = segments.slice(1)
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const folded = fold(key)
    if (folded === exactPath) continue
    if (folded === head) {
      if (tail.length > 0) defineData(out, key, omitPath(child, tail, caseInsensitive))
      continue
    }
    defineData(out, key, child)
  }
  return out
}

// `omittedKeys` is required rather than optional: for a masking helper, the
// fail-open direction of a forgotten argument (keep every key) is the wrong default.
function cloneRecord(
  value: Record<string, unknown>,
  omittedKeys: ReadonlySet<string>,
  caseInsensitive = false
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (!omittedKeys.has(caseInsensitive ? key.toLowerCase() : key)) defineData(out, key, child)
  }
  return out
}

function collectColumnNames(rows: readonly Record<string, unknown>[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

function normalizeRows(
  rows: readonly Record<string, unknown>[],
  columnNames: readonly string[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const column of columnNames) {
      const value = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null
      defineData(normalized, column, value ?? null)
    }
    return normalized
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function defineData(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}
