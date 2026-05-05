import { SavedQueryError, type EngineTag, type ResolvedSnippet } from './types'
import { levenshteinDistance } from '@/utils/levenshtein-distance'

const SOURCE_RANK: Record<ResolvedSnippet['query']['source'], number> = {
  builtin: 0,
  shared: 1,
  local: 2,
}

export function resolveByName(
  map: Map<string, ResolvedSnippet[]>,
  name: string,
  engine: EngineTag
): ResolvedSnippet {
  const variants = map.get(name)
  if (!variants || variants.length === 0) {
    const suggestions = suggestSimilar([...map.keys()], name)
    const hint = suggestions.length > 0 ? `\n  Did you mean: ${suggestions.join(', ')}?` : ''
    throw new SavedQueryError(`Snippet not found: ${name}${hint}`, 'NOT_FOUND')
  }

  const matches = variants.filter((v) => engineMatches(v.query.meta.engine, engine))
  if (matches.length === 0) {
    const declared = variants
      .map((v) => v.query.meta.engine?.join(',') ?? 'any')
      .join(' | ')
    throw new SavedQueryError(
      `Snippet '${name}' does not support engine '${engine}' (declared: ${declared})`,
      'ENGINE_MISMATCH'
    )
  }

  matches.sort((a, b) => SOURCE_RANK[b.query.source] - SOURCE_RANK[a.query.source])
  return matches[0]!
}

function engineMatches(declared: EngineTag[] | undefined, current: EngineTag): boolean {
  if (!declared || declared.length === 0) return true // engine-agnostic
  return declared.includes(current)
}

export function suggestSimilar(all: string[], name: string, limit = 5): string[] {
  return all
    .map((k) => ({ k, d: levenshteinDistance(k, name) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.k)
}
