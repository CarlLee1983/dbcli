import type { EngineTag, ResolvedSnippet } from '@/core/saved-queries'
import { intentsForSection } from './section-map'
import type { ReportSectionId } from './types'

const SOURCE_RANK: Record<'builtin' | 'shared' | 'local', number> = {
  builtin: 0,
  shared: 1,
  local: 2,
}

export interface SelectSnippetsInput {
  map: Map<string, ResolvedSnippet[]>
  engine: EngineTag
  sections: readonly ReportSectionId[]
}

/**
 * Pure selection: walks each requested section's intent list in order, finds
 * matching variants for the active engine, prefers higher-priority sources
 * (local > shared > builtin), and drops snippets whose required params have
 * no default (cannot run safely without user input).
 */
export function selectSnippets(input: SelectSnippetsInput): ResolvedSnippet[] {
  const wantIntents: string[] = []
  for (const s of input.sections) wantIntents.push(...intentsForSection(s))

  const byIntent = new Map<string, ResolvedSnippet[]>()
  for (const variants of input.map.values()) {
    for (const v of variants) {
      const intent = v.query.meta.intent
      if (!intent || !wantIntents.includes(intent)) continue
      if (!engineMatches(v.query.meta.engine, input.engine)) continue
      if (hasUnboundRequiredParam(v)) continue
      const arr = byIntent.get(intent) ?? []
      arr.push(v)
      byIntent.set(intent, arr)
    }
  }

  const out: ResolvedSnippet[] = []
  const seenKeys = new Set<string>()
  for (const intent of wantIntents) {
    const variants = byIntent.get(intent) ?? []
    const byKey = new Map<string, ResolvedSnippet>()
    for (const v of variants) {
      const k = v.query.meta.key
      const cur = byKey.get(k)
      if (!cur || SOURCE_RANK[v.query.source] > SOURCE_RANK[cur.query.source]) {
        byKey.set(k, v)
      }
    }
    const keys = [...byKey.keys()].sort()
    for (const k of keys) {
      if (seenKeys.has(k)) continue
      seenKeys.add(k)
      out.push(byKey.get(k)!)
    }
  }
  return out
}

function engineMatches(declared: EngineTag[] | undefined, current: EngineTag): boolean {
  if (!declared || declared.length === 0) return true
  return declared.includes(current)
}

function hasUnboundRequiredParam(v: ResolvedSnippet): boolean {
  for (const p of v.query.meta.params) {
    if (p.required && (p.default === undefined || p.default === null)) return true
  }
  return false
}
