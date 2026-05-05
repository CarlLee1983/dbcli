import { stat, mkdir, copyFile } from 'node:fs/promises'
import { basename, join, extname } from 'node:path'
import { confirm } from '@inquirer/prompts'
import { parseSavedQuery } from '@/core/saved-queries'

export interface ImportOptions {
  cwd?: string
  force?: boolean
  /** Override snippet name (key); defaults to filename basename. */
  as?: string
}

export async function queriesImport(filePath: string, options: ImportOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  if (extname(filePath) !== '.sql') {
    throw new Error(`Expected .sql file, got ${filePath}`)
  }
  await stat(filePath) // throws if missing
  const text = await Bun.file(filePath).text()
  const baseName = options.as
    ? options.as.replace(/^@/, '')
    : basename(filePath, '.sql').replace(/\.(postgres|mysql)$/, '')
  const key = '@' + baseName
  // Validate by running parser — throws on invalid frontmatter / non-SELECT body.
  parseSavedQuery({ key, file: filePath, source: 'local', text })

  const targetDir = join(cwd, '.dbcli/queries')
  await mkdir(targetDir, { recursive: true })
  const target = join(targetDir, basename(filePath))
  if (await Bun.file(target).exists()) {
    if (!options.force) {
      const ok = await confirm({ message: `Overwrite ${target}?`, default: false })
      if (!ok) return
    }
  }
  await copyFile(filePath, target)
  console.log(`imported ${filePath} → ${target}`)
}
