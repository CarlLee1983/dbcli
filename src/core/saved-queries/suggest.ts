/**
 * Pure-function intent-prefix filter for snippet discovery.
 * `intent: 'perf'` matches both `perf.slow-query` and `perf.cache-hit`
 * (prefix must end at a dot boundary or equal the full value);
 * does NOT match `performance.foo`.
 */
import type { FoldedRow } from './fold'
import type { EngineTag, SnippetSource } from './types'

export interface SuggestInput {
  intent: string
  engineFilter?: EngineTag
  source?: SnippetSource | 'all'
}

export interface SuggestHit {
  name: string
  engine: EngineTag | null
  source: SnippetSource
  intent: string
  description: string
  tags: string[]
}

const SOURCE_RANK: Record<SnippetSource, number> = { local: 0, shared: 1, builtin: 2 }

export function suggestSnippets(folded: FoldedRow[], input: SuggestInput): SuggestHit[] {
  const target = input.intent
  const out: SuggestHit[] = []
  for (const r of folded) {
    if (!r.intent) continue
    if (!matchesIntentPrefix(r.intent, target)) continue
    if (input.engineFilter && r.engines.length > 0 && !r.engines.includes(input.engineFilter)) {
      continue
    }
    if (input.source && input.source !== 'all' && !r.sources.includes(input.source)) {
      continue
    }
    out.push({
      name: r.name,
      engine: r.engines[0] ?? null,
      source: pickTopSource(r.sources),
      intent: r.intent,
      description: r.description,
      tags: r.tags,
    })
  }
  out.sort((a, b) => {
    if (a.intent !== b.intent) return a.intent.localeCompare(b.intent)
    const ea = a.engine ?? ''
    const eb = b.engine ?? ''
    if (ea !== eb) return ea.localeCompare(eb)
    return a.name.localeCompare(b.name)
  })
  return out
}

function matchesIntentPrefix(intent: string, target: string): boolean {
  if (intent === target) return true
  return intent.startsWith(target + '.')
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
