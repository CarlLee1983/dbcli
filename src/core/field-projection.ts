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

export function hasFieldPath(row: Record<string, unknown>, path: string): boolean {
  return readPath(row, path.split('.')).found
}

export function omitFieldPaths(
  rows: readonly Record<string, unknown>[],
  paths: readonly string[]
): Record<string, unknown>[] {
  // `omitPath` rebuilds the whole record, so running it once per path made this
  // O(rows × paths) full copies — 100 rows against a 50-column blacklist cost 5000
  // rebuilds and ~35ms, which is why the masking benchmark had never met its 5ms
  // budget. A path without a dot only ever deletes one top-level key, and a column
  // blacklist is overwhelmingly such names, so those are collected into one pass
  // and only genuinely nested paths still recurse. Same output, ~50x faster.
  //
  // Ceiling: dotted paths keep the old cost. A blacklist of N dotted JSON paths is
  // still N rebuilds per row — measured at 2.6ms for 5 paths over 100 rows, and it
  // grows linearly in N. `blacklist-validator.ts` admits dotted paths deliberately,
  // so if a config ever carries dozens of them, this branch is what to optimise next.
  const topLevel = new Set<string>()
  const nested: string[] = []
  for (const path of paths) {
    if (path.includes('.')) nested.push(path)
    else topLevel.add(path)
  }

  return rows.map((row) => {
    let projected: unknown = cloneRecord(row, topLevel)
    for (const path of nested) projected = omitPath(projected, path.split('.'))
    return projected as Record<string, unknown>
  })
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

function readPath(
  value: unknown,
  segments: readonly string[]
): { found: boolean; value?: unknown } {
  if (segments.length === 0) return { found: true, value }
  if (Array.isArray(value)) {
    const results = value.map((item) => readPath(item, segments))
    return {
      found: results.some((result) => result.found),
      value: results.map((result) => (result.found ? result.value : undefined)),
    }
  }
  if (!isRecord(value)) return { found: false }

  const exactPath = segments.join('.')
  if (Object.prototype.hasOwnProperty.call(value, exactPath)) {
    return { found: true, value: value[exactPath] }
  }
  const [head, ...tail] = segments
  if (!Object.prototype.hasOwnProperty.call(value, head!)) return { found: false }
  return readPath(value[head!], tail)
}

function omitPath(value: unknown, segments: readonly string[]): unknown {
  if (segments.length === 0) return value
  if (Array.isArray(value)) return value.map((item) => omitPath(item, segments))
  if (!isPlainRecord(value)) return value

  const exactPath = segments.join('.')
  const [head, ...tail] = segments
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === exactPath) continue
    if (key === head) {
      if (tail.length > 0) defineData(out, key, omitPath(child, tail))
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
  omittedKeys: ReadonlySet<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (!omittedKeys.has(key)) defineData(out, key, child)
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
