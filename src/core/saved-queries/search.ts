/**
 * Pure-function snippet ranking by weighted substring hits.
 * No external dependency; deterministic output.
 *
 * Per-field weights (per-token): name=3, intent=2, tags=2, description=1.
 * A candidate qualifies only if EVERY token matches at least one field.
 * Score = sum(per-token max-field-weight) / (3 * tokenCount), so score ∈ [0, 1].
 * Ties broken by source rank (local=0 < shared=1 < builtin=2), then alphabetical name.
 */
import type { FoldedRow } from './fold'
import type { EngineTag, SnippetSource } from './types'

export interface SearchInput {
  query: string
  engineFilter?: EngineTag
  source?: SnippetSource | 'all'
  limit?: number
}

export interface SearchHit {
  name: string
  engine: EngineTag | null
  source: SnippetSource
  score: number
  matched: string[]
  description: string
  intent?: string
  tags: string[]
}

const WEIGHT_NAME = 3
const WEIGHT_INTENT = 2
const WEIGHT_TAGS = 2
const WEIGHT_DESCRIPTION = 1
const SOURCE_RANK: Record<SnippetSource, number> = { local: 0, shared: 1, builtin: 2 }

export function searchSnippets(folded: FoldedRow[], input: SearchInput): SearchHit[] {
  const tokens = input.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return []

  const scored: SearchHit[] = []
  for (const r of folded) {
    if (input.engineFilter && r.engines.length > 0 && !r.engines.includes(input.engineFilter)) {
      continue
    }
    if (input.source && input.source !== 'all' && !r.sources.includes(input.source)) {
      continue
    }
    const name = r.name.toLowerCase()
    const description = r.description.toLowerCase()
    const intent = (r.intent ?? '').toLowerCase()
    const tagsJoined = r.tags.join(' ').toLowerCase()

    const matched: string[] = []
    let totalWeight = 0
    let allHit = true
    for (const tok of tokens) {
      let bestForToken = 0
      if (name.includes(tok)) bestForToken = Math.max(bestForToken, WEIGHT_NAME)
      if (intent && intent.includes(tok)) bestForToken = Math.max(bestForToken, WEIGHT_INTENT)
      if (tagsJoined.includes(tok)) bestForToken = Math.max(bestForToken, WEIGHT_TAGS)
      if (description.includes(tok)) bestForToken = Math.max(bestForToken, WEIGHT_DESCRIPTION)
      if (bestForToken === 0) {
        allHit = false
        break
      }
      matched.push(tok)
      totalWeight += bestForToken
    }
    if (!allHit) continue
    const score = totalWeight / (WEIGHT_NAME * tokens.length)
    const source = pickTopSource(r.sources)
    scored.push({
      name: r.name,
      engine: r.engines[0] ?? null,
      source,
      score,
      matched,
      description: r.description,
      intent: r.intent,
      tags: r.tags,
    })
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const sa = SOURCE_RANK[a.source]
    const sb = SOURCE_RANK[b.source]
    if (sa !== sb) return sa - sb
    return a.name.localeCompare(b.name)
  })

  const limit = input.limit ?? 10
  return scored.slice(0, limit)
}

function pickTopSource(sources: SnippetSource[]): SnippetSource {
  let best: SnippetSource = 'builtin'
  let bestRank = SOURCE_RANK.builtin
  for (const s of sources) {
    if (SOURCE_RANK[s] < bestRank) {
      bestRank = SOURCE_RANK[s]
      best = s
    }
  }
  return best
}
