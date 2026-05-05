import { rm } from 'node:fs/promises'
import { confirm } from '@inquirer/prompts'
import { loadSnippets, resolveSnippetDirs } from '@/core/saved-queries'

export interface DeleteOptions {
  force?: boolean
  cwd?: string
}

export async function queriesDelete(name: string, options: DeleteOptions = {}): Promise<void> {
  if (!name.startsWith('@')) {
    throw new Error(`Snippet name must start with '@' (got '${name}')`)
  }
  const cwd = options.cwd ?? process.cwd()
  const dirs = resolveSnippetDirs(cwd)
  const map = await loadSnippets(dirs)
  const variants = map.get(name)
  if (!variants || variants.length === 0) {
    throw new Error(`Snippet not found: ${name}`)
  }
  const localVariants = variants.filter((v) => v.query.source === 'local')
  if (localVariants.length === 0) {
    throw new Error(
      `Refusing to delete: '${name}' has no local copy. Only local snippets can be deleted.`
    )
  }
  if (!options.force) {
    const ok = await confirm({
      message: `Delete ${localVariants.length} local file(s) for ${name}?`,
      default: false,
    })
    if (!ok) return
  }
  for (const v of localVariants) {
    await rm(v.query.file, { force: true })
    console.log(`deleted ${v.query.file}`)
  }
}
