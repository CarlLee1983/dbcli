/**
 * 從 builtin (assets/snippets) → .dbcli-shared/queries → .dbcli/queries 走訪
 * .sql 檔案，解析後合併成 Map<key, ResolvedSnippet[]>。每個 key 可能有多
 * 個 engine 變體。Override 是 per (key, engine)：較高層級的同 engine
 * 變體會蓋掉較低層級。
 */

import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { parseSavedQuery } from './parser'
import type { EngineTag, ResolvedSnippet, SavedQuery, SnippetSource } from './types'

export interface LoadOptions {
  builtinDir: string
  sharedDir: string
  localDir: string
  /**
   * Called for a snippet file that cannot be parsed. Loading continues either
   * way, so one bad file never hides the rest of the directory; commands that
   * must fail on a bad snippet (`queries check`) collect them here.
   */
  onError?: (failure: { file: string; key: string; error: Error }) => void
}

const ENGINE_SUFFIXES: ReadonlyArray<EngineTag> = [
  'postgres',
  'mysql',
  'elasticsearch',
  'redis',
  'mongodb',
]

/**
 * 回傳 Map<key, ResolvedSnippet[]> — 多個變體可能共用同一個 key
 * （例如同一個 snippet 為 postgres 與 mysql 各提供一份實作）。Resolver
 * 會根據目前連線的 engine 挑選對應變體。
 */
export async function loadSnippets(opts: LoadOptions): Promise<Map<string, ResolvedSnippet[]>> {
  const builtin = await walkAndParse(opts.builtinDir, 'builtin', opts.onError)
  const shared = await walkAndParse(opts.sharedDir, 'shared', opts.onError)
  const local = await walkAndParse(opts.localDir, 'local', opts.onError)

  const merged = new Map<string, ResolvedSnippet[]>()
  pushTier(merged, builtin)
  pushTier(merged, shared)
  pushTier(merged, local)
  return merged
}

function pushTier(out: Map<string, ResolvedSnippet[]>, tier: SavedQuery[]): void {
  for (const q of tier) {
    const list = out.get(q.meta.key) ?? []
    // Per-engine override: drop lower-tier variants whose engine signature matches.
    const keepers = list.filter((existing) => !sameEngineSet(existing.query, q))
    const replacedSomething = keepers.length < list.length
    keepers.push({ query: q, hasLocalOverride: q.source === 'local' && replacedSomething })
    out.set(q.meta.key, keepers)
  }
}

function sameEngineSet(a: SavedQuery, b: SavedQuery): boolean {
  const ae = (a.meta.engine ?? []).slice().sort().join(',')
  const be = (b.meta.engine ?? []).slice().sort().join(',')
  return ae === be
}

async function walkAndParse(
  root: string,
  source: SnippetSource,
  onError?: LoadOptions['onError']
): Promise<SavedQuery[]> {
  const out: SavedQuery[] = []
  let entries: string[]
  try {
    entries = await collectFiles(root)
  } catch {
    return out
  }
  for (const file of entries) {
    if (!file.endsWith('.sql')) continue
    const rel = relative(root, file).replace(new RegExp(`\\${sep}`, 'g'), '/')
    const { logicalKey, suffixEngine } = parseFilename(rel)
    const text = await Bun.file(file).text()
    // One unparseable file must not take the whole directory with it: a single
    // rejected snippet would otherwise break `q list`, every `q @name`, and
    // `report`, since they all load through here.
    try {
      const { query } = parseSavedQuery({ key: logicalKey, file, source, text })
      enforceSuffixEngineConsistency(query, suffixEngine)
      out.push(query)
    } catch (error) {
      if (onError) onError({ file, key: logicalKey, error: error as Error })
      else console.error(`⚠ Skipping snippet ${logicalKey}: ${(error as Error).message}`)
    }
  }
  return out
}

function parseFilename(rel: string): { logicalKey: string; suffixEngine: EngineTag | null } {
  const noExt = rel.slice(0, -'.sql'.length)
  for (const eng of ENGINE_SUFFIXES) {
    if (noExt.endsWith('.' + eng)) {
      return { logicalKey: '@' + noExt.slice(0, -('.' + eng).length), suffixEngine: eng }
    }
  }
  return { logicalKey: '@' + noExt, suffixEngine: null }
}

function enforceSuffixEngineConsistency(q: SavedQuery, suffixEngine: EngineTag | null): void {
  if (!suffixEngine) return
  const declared = q.meta.engine ?? []
  if (declared.length !== 1 || declared[0] !== suffixEngine) {
    // Filename suffix is the source of truth — overwrite frontmatter to match.
    q.meta.engine = [suffixEngine]
  }
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else out.push(full)
    }
  }
  await walk(root)
  return out
}
