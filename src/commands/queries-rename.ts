import { rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadSnippets, resolveSnippetDirs, snippetKeyToFile } from '@/core/saved-queries'

export interface RenameOptions {
  cwd?: string
  force?: boolean
}

export async function queriesRename(
  oldName: string,
  newName: string,
  options: RenameOptions = {}
): Promise<void> {
  if (!oldName.startsWith('@') || !newName.startsWith('@')) {
    throw new Error(`Both names must start with '@'`)
  }
  const cwd = options.cwd ?? process.cwd()
  const dirs = resolveSnippetDirs(cwd)
  const map = await loadSnippets(dirs)
  const variants = map.get(oldName)
  if (!variants || variants.length === 0) throw new Error(`Snippet not found: ${oldName}`)
  const local = variants.filter((v) => v.query.source === 'local')
  if (local.length === 0) {
    throw new Error(`Refusing to rename: '${oldName}' has no local copy.`)
  }
  if (map.get(newName)?.some((v) => v.query.source === 'local')) {
    throw new Error(`Target already exists: ${newName}`)
  }

  for (const v of local) {
    const dst = snippetKeyToFile(cwd, newName, 'local')
    const dstWithSuffix = preserveEngineSuffix(v.query.file, dst)
    await mkdir(dirname(dstWithSuffix), { recursive: true })
    await rename(v.query.file, dstWithSuffix)
    await rewriteFrontmatterName(dstWithSuffix, newName.slice(1))
    console.log(`renamed ${v.query.file} → ${dstWithSuffix}`)
  }
}

function preserveEngineSuffix(srcFile: string, dstFile: string): string {
  const m = srcFile.match(/\.(postgres|mysql)\.sql$/)
  if (!m) return dstFile
  return dstFile.replace(/\.sql$/, `.${m[1]}.sql`)
}

async function rewriteFrontmatterName(file: string, newName: string): Promise<void> {
  const text = await Bun.file(file).text()
  const updated = text.replace(/^-- name:.*$/m, `-- name: ${newName}`)
  await Bun.write(file, updated)
}
