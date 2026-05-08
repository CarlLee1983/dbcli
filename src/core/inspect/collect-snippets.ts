import { loadSnippets, resolveSnippetDirs } from '@/core/saved-queries'
import { foldVariants } from '@/core/saved-queries/fold'
import type { SnippetsSection } from './types'

export interface CollectSnippetsOptions {
  workspace: string
  /** How many top-frequency intents to keep. Default 5. */
  topIntents?: number
}

export interface SnippetsCollectResult {
  section: SnippetsSection
  warnings: string[]
}

export async function collectSnippets(
  opts: CollectSnippetsOptions
): Promise<SnippetsCollectResult> {
  const warnings: string[] = []
  const top = opts.topIntents ?? 5
  try {
    const map = await loadSnippets(resolveSnippetDirs(opts.workspace))
    if (map.size === 0) {
      return { section: { count: 0, engines: [], intents: [] }, warnings }
    }
    const folded = [...map.entries()].map(([k, v]) => foldVariants(k, v))
    const engineSet = new Set<string>()
    const intentCounts = new Map<string, number>()
    for (const row of folded) {
      for (const e of row.engines) engineSet.add(e)
      if (row.intent) intentCounts.set(row.intent, (intentCounts.get(row.intent) ?? 0) + 1)
    }
    const intents = [...intentCounts.entries()]
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count || a.intent.localeCompare(b.intent))
      .slice(0, top)
    return {
      section: { count: folded.length, engines: [...engineSet].sort(), intents },
      warnings,
    }
  } catch (err) {
    warnings.push(`snippets: ${(err as Error).message}`)
    return { section: { count: 0, engines: [], intents: [] }, warnings }
  }
}
