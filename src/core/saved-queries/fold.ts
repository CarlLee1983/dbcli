/**
 * Reduce a list of per-engine variants for the same snippet key into a single
 * row suitable for table / search / suggest output. Higher-priority sources
 * (local > shared > builtin) win on scalar fields like description and intent.
 */
import type { ResolvedSnippet, SnippetSource, EngineTag } from './types'

export interface FoldedRow {
  name: string
  sources: SnippetSource[]
  engines: EngineTag[]
  params: string[]
  description: string
  tags: string[]
  intent?: string
  hasLocalOverride: boolean
}

const SOURCE_RANK = { builtin: 0, shared: 1, local: 2 } as const

export function foldVariants(key: string, variants: ResolvedSnippet[]): FoldedRow {
  const sources = unique(variants.map((v) => v.query.source)).sort()
  const engines = unique(variants.flatMap((v) => v.query.meta.engine ?? [])).sort()
  const tags = unique(variants.flatMap((v) => v.query.meta.tags ?? []))
  const top = variants
    .slice()
    .sort((a, b) => SOURCE_RANK[b.query.source] - SOURCE_RANK[a.query.source])[0]!
  return {
    name: key,
    sources,
    engines,
    params: top.query.meta.params.map((p) => p.name),
    description: top.query.meta.description ?? '',
    tags,
    intent: top.query.meta.intent,
    hasLocalOverride: variants.some((v) => v.hasLocalOverride),
  }
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}
