import { SavedQueryError, type ResolvedSnippet } from './types'
import { levenshteinDistance } from '@/utils/levenshtein-distance'

export function resolveByName(map: Map<string, ResolvedSnippet>, name: string): ResolvedSnippet {
  const hit = map.get(name)
  if (hit) return hit
  const suggestions = suggestSimilar([...map.keys()], name)
  const hint = suggestions.length > 0 ? `\n  Did you mean: ${suggestions.join(', ')}?` : ''
  throw new SavedQueryError(`Snippet not found: ${name}${hint}`, 'NOT_FOUND')
}

export function suggestSimilar(all: string[], name: string, limit = 5): string[] {
  return all
    .map((k) => ({ k, d: levenshteinDistance(k, name) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.k)
}
