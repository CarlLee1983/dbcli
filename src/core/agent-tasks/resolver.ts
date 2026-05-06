import { levenshteinDistance } from '@/utils/levenshtein-distance'
import type { LoadedTask } from './loader'
import { AgentTaskError, type AgentTaskEngine, type AgentTaskSource } from './types'

export interface FilterOptions {
  tag?: string
  engine?: AgentTaskEngine
  source?: AgentTaskSource
}

export function filterTasks(map: Map<string, LoadedTask>, opts: FilterOptions): LoadedTask[] {
  return [...map.values()].filter((entry) => {
    const t = entry.task
    if (opts.tag && !t.tags.includes(opts.tag)) return false
    if (opts.engine) {
      const declared = t.engines
      if (declared && declared.length > 0 && !declared.includes(opts.engine)) return false
    }
    if (opts.source && t.source !== opts.source) return false
    return true
  })
}

export function resolveTaskByName(map: Map<string, LoadedTask>, name: string): LoadedTask {
  const direct = map.get(name)
  if (direct) return direct
  const suggestions = suggestSimilar([...map.keys()], name)
  const hint = suggestions.length > 0 ? `\n  Did you mean: ${suggestions.join(', ')}?` : ''
  throw new AgentTaskError(`Task not found: ${name}${hint}`, 'NOT_FOUND')
}

export function suggestSimilar(all: string[], name: string, limit = 5): string[] {
  return all
    .map((k) => ({ k, d: levenshteinDistance(k, name) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.k)
}
