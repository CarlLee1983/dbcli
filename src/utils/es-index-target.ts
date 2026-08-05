/**
 * Normalising Elasticsearch index targets.
 *
 * `--index` and the index segment of a shell path are *expressions*, not names.
 * Elasticsearch accepts a comma list, `*` / `?` wildcards, `_all`, an exclusion
 * prefix, percent-encoding, date math (`<logs-{now/d}>`), and a remote-cluster
 * qualifier (`cluster:index`). Every one of those spellings reached a
 * blacklisted index while matching no blacklist entry by equality.
 *
 * The rules live here rather than at the call sites because there are two
 * callers — the blacklist validator and the Elasticsearch shell — and a rule
 * fixed in one and not the other has already been this codebase's most repeated
 * class of defect.
 */

import { globToRegex } from './glob'

/** Percent-decoding and `.`/`..` resolution, applied until the path stops changing. */
const MAX_DECODE_PASSES = 4

/**
 * The path Elasticsearch will actually route.
 *
 * `/%5Fsearch` is `/_search`, `/secrets%2F_search` is `/secrets/_search`, and
 * `/_cat/../secrets/_search` resolves to `/secrets/_search` — each of which
 * reached documents while the raw text looked like something else.
 */
export function normalizeEsPath(path: string): string {
  let current = path
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    let decoded = current
    try {
      decoded = decodeURIComponent(current)
    } catch {
      // Not valid percent-encoding; what is there is what the server sees.
    }
    const segments: string[] = []
    for (const segment of decoded.split('/')) {
      if (segment === '.' || segment === '') continue
      if (segment === '..') {
        segments.pop()
        continue
      }
      segments.push(segment)
    }
    const resolved = `/${segments.join('/')}`
    if (resolved === current) return resolved
    current = resolved
  }
  return current
}

/** Percent-decoding and date-math unwrapping, applied until the text stops changing. */
function unwrap(target: string): string {
  let current = target
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    let next = current
    try {
      next = decodeURIComponent(next)
    } catch {
      // Not valid percent-encoding.
    }
    // Date math: `<logs-{now/d}>` resolves to a name only the server knows, so
    // the variable section becomes a wildcard.
    if (next.startsWith('<') && next.endsWith('>')) {
      next = next.slice(1, -1).replace(/\{[^}]*\}/g, '*')
    }
    if (next === current) return current
    current = next
  }
  return current
}

export interface EsIndexTargets {
  concrete: string[]
  wildcards: string[]
}

/**
 * Split an index expression into the names it states and the patterns it may
 * resolve to. Over-reporting is intended: an extra candidate refuses more.
 */
export function expandIndexTargets(target: string): EsIndexTargets {
  const concrete: string[] = []
  const wildcards: string[] = []

  const add = (candidate: string): void => {
    if (candidate.length === 0) return
    if (/[*?]/.test(candidate) || candidate.toLowerCase() === '_all') wildcards.push(candidate)
    else concrete.push(candidate)
  }

  for (const rawPart of unwrap(target).split(',')) {
    const part = unwrap(rawPart.trim()).trim().replace(/^[-+]/, '')
    if (part.length === 0) continue

    // `cluster:index`, and defensively `a:b:index`: every colon-separated
    // section is a candidate, since which half names the data depends on the
    // cluster configuration.
    add(part)
    if (part.includes(':')) for (const section of part.split(':')) add(section)
  }

  return { concrete, wildcards }
}

/** Whether an index pattern could resolve to `name`. Never throws on a hostile pattern. */
export function matchesIndexGlob(pattern: string, name: string): boolean {
  const normalized = pattern.toLowerCase() === '_all' ? '*' : pattern.toLowerCase()
  try {
    return globToRegex(normalized).test(name.toLowerCase())
  } catch {
    // An unparseable pattern is not a licence to allow it.
    return true
  }
}

/**
 * Concrete names that reach `entry` besides `entry` itself.
 *
 * A data stream's documents live in `.ds-<name>-<date>-<nnnnnn>`, and an ILM
 * rollover writes to `<name>-000001`. Those are different index names, so a
 * blacklist entry matched by equality does not cover them — reading the
 * protected data needs only the backing index's name.
 *
 * This is a naming convention, not a resolution: an **alias** pointing at a
 * blacklisted index is server-side knowledge dbcli does not have, and remains a
 * documented ceiling.
 */
function reachesByConvention(name: string, entry: string): boolean {
  const lower = name.toLowerCase()
  const target = entry.toLowerCase()
  return (
    new RegExp(`^\\.ds-${escapeRegExp(target)}-`).test(lower) ||
    new RegExp(`^${escapeRegExp(target)}-\\d+$`).test(lower)
  )
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether an index expression could reach any of `blacklisted`. */
export function indexExpressionReaches(expression: string, blacklisted: string[]): boolean {
  if (blacklisted.length === 0) return false
  const { concrete, wildcards } = expandIndexTargets(expression)
  return (
    concrete.some((name) =>
      blacklisted.some(
        (entry) => entry.toLowerCase() === name.toLowerCase() || reachesByConvention(name, entry)
      )
    ) || wildcards.some((pattern) => blacklisted.some((entry) => matchesIndexGlob(pattern, entry)))
  )
}
