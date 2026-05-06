import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { parseAgentTask } from './parser'
import { AgentTaskError, type AgentTask, type AgentTaskSource } from './types'

export interface LoadOptions {
  builtinDir: string
  sharedDir: string
  localDir: string
}

export interface LoadFlags {
  collectErrors?: boolean
}

export interface LoadedTask {
  task: AgentTask
  hasOverride: boolean
}

export type LoadResult = Map<string, LoadedTask> & { errors: AgentTaskError[] }

export async function loadAgentTasks(opts: LoadOptions, flags?: LoadFlags): Promise<LoadResult> {
  const errors: AgentTaskError[] = []
  const builtin = await walkAndParse(opts.builtinDir, 'builtin', errors)
  const shared = await walkAndParse(opts.sharedDir, 'shared', errors)
  const local = await walkAndParse(opts.localDir, 'local', errors)

  const merged = new Map<string, LoadedTask>() as LoadResult
  for (const t of builtin) merged.set(t.name, { task: t, hasOverride: false })
  for (const t of shared) {
    const had = merged.has(t.name)
    merged.set(t.name, { task: t, hasOverride: had })
  }
  for (const t of local) {
    const had = merged.has(t.name)
    merged.set(t.name, { task: t, hasOverride: had })
  }
  Object.defineProperty(merged, 'errors', {
    value: flags?.collectErrors ? errors : [],
    enumerable: false,
    writable: false,
  })
  return merged
}

async function walkAndParse(
  root: string,
  source: AgentTaskSource,
  errors: AgentTaskError[]
): Promise<AgentTask[]> {
  const files = await safeCollectMd(root)
  const out: AgentTask[] = []
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/')
    if (!rel.endsWith('.md')) continue
    if (rel.toLowerCase() === 'readme.md') continue
    const name = rel.slice(0, -'.md'.length)
    try {
      const text = await Bun.file(file).text()
      const task = parseAgentTask({ name, file, source, text })
      out.push(task)
    } catch (e) {
      if (e instanceof AgentTaskError) errors.push(e)
      else errors.push(new AgentTaskError((e as Error).message, 'IO_ERROR', file))
    }
  }
  return out
}

async function safeCollectMd(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else out.push(full)
    }
  }
  await walk(root)
  return out
}
