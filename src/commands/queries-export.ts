import { writeFile } from 'node:fs/promises'
import { loadSnippets, resolveSnippetDirs, type EngineTag } from '@/core/saved-queries'

export interface ExportOptions {
  cwd?: string
  output?: string
  engine?: EngineTag
}

export async function queriesExport(name: string, options: ExportOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const dirs = resolveSnippetDirs(cwd)
  const map = await loadSnippets(dirs)
  const variants = map.get(name)
  if (!variants || variants.length === 0) throw new Error(`Snippet not found: ${name}`)

  let chosen = variants
  if (options.engine) {
    chosen = variants.filter((v) => (v.query.meta.engine ?? []).includes(options.engine!))
    if (chosen.length === 0) {
      throw new Error(`No variant of ${name} matches engine ${options.engine}`)
    }
  }
  if (chosen.length > 1) {
    const engines = chosen.flatMap((v) => v.query.meta.engine ?? []).join(', ')
    throw new Error(
      `Snippet ${name} has multiple engine variants (${engines}); pass --engine to pick one.`
    )
  }
  const text = await Bun.file(chosen[0]!.query.file).text()
  if (options.output) {
    await writeFile(options.output, text, 'utf8')
    console.log(`wrote ${options.output}`)
  } else {
    process.stdout.write(text)
  }
}
