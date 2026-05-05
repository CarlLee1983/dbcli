import { mkdir, copyFile } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { loadSnippets, resolveSnippetDirs, snippetKeyToFile } from '@/core/saved-queries'

export interface CopyOptions {
  cwd?: string
  /** Test-only: override the builtinDir resolved from the dbcli installation. */
  builtinDirOverride?: string
}

export async function queriesCopy(
  src: string,
  dst: string,
  options: CopyOptions = {}
): Promise<void> {
  if (!src.startsWith('@') || !dst.startsWith('@')) {
    throw new Error(`Both names must start with '@'`)
  }
  const cwd = options.cwd ?? process.cwd()
  const dirs = resolveSnippetDirs(cwd)
  if (options.builtinDirOverride) dirs.builtinDir = options.builtinDirOverride
  const map = await loadSnippets(dirs)
  const variants = map.get(src)
  if (!variants || variants.length === 0) throw new Error(`Snippet not found: ${src}`)
  if (map.get(dst)?.some((v) => v.query.source === 'local')) {
    throw new Error(`Target already exists: ${dst}`)
  }

  for (const v of variants) {
    const dstFile = mapEngineSuffix(v.query.file, snippetKeyToFile(cwd, dst, 'local'))
    await mkdir(dirname(dstFile), { recursive: true })
    await copyFile(v.query.file, dstFile)
    console.log(`copied ${v.query.file} → ${dstFile}`)
  }
}

function mapEngineSuffix(srcFile: string, baseDst: string): string {
  const m = basename(srcFile).match(/\.(postgres|mysql)\.sql$/)
  return m ? baseDst.replace(/\.sql$/, `.${m[1]}.sql`) : baseDst
}
