/**
 * 從 .dbcli-shared/queries 與 .dbcli/queries 走訪 .sql 檔案，
 * 解析後合併成 Map<key, ResolvedSnippet>，local 蓋過 shared。
 */

import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { parseSavedQuery } from './parser'
import type { ResolvedSnippet, SavedQuery, SnippetSource } from './types'

export interface LoadOptions {
  sharedDir: string
  localDir: string
}

export async function loadSnippets(opts: LoadOptions): Promise<Map<string, ResolvedSnippet>> {
  const shared = await walkAndParse(opts.sharedDir, 'shared')
  const local = await walkAndParse(opts.localDir, 'local')

  const merged = new Map<string, ResolvedSnippet>()
  for (const [key, snippet] of shared) {
    merged.set(key, { query: snippet, hasLocalOverride: false })
  }
  for (const [key, snippet] of local) {
    merged.set(key, { query: snippet, hasLocalOverride: shared.has(key) })
  }
  return merged
}

async function walkAndParse(
  root: string,
  source: SnippetSource
): Promise<Map<string, SavedQuery>> {
  const out = new Map<string, SavedQuery>()
  let entries: string[]
  try {
    entries = await collectFiles(root)
  } catch {
    return out
  }
  for (const file of entries) {
    if (!file.endsWith('.sql')) continue
    const rel = relative(root, file).replace(new RegExp(`\\${sep}`, 'g'), '/')
    const key = '@' + rel.slice(0, -'.sql'.length)
    const text = await Bun.file(file).text()
    const { query } = parseSavedQuery({ key, file, source, text })
    out.set(key, query)
  }
  return out
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
