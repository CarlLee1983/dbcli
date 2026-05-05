import { Command } from 'commander'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { t } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import {
  loadSnippets,
  mapSystemToEngine,
  resolveByName,
  resolveSnippetDirs,
  snippetKeyToFile,
  parseSavedQuery,
  SavedQueryError,
  type EngineTag,
  type ResolvedSnippet,
  type SnippetSource,
} from '@/core/saved-queries'

async function deriveEngine(): Promise<EngineTag> {
  try {
    const cfg = await configModule.read(resolveConfigPath(undefined, {}))
    if (cfg.connection) {
      const engine = mapSystemToEngine(cfg.connection.system)
      if (engine !== 'mongodb') return engine
    }
  } catch {
    // best-effort: fall through to default
  }
  return 'postgres'
}

export interface ListOptions {
  format?: 'table' | 'json' | 'csv'
  tag?: string
  engine?: 'postgres' | 'mysql'
  source?: 'local' | 'shared'
}

export async function queriesList(options: ListOptions): Promise<void> {
  const map = await loadSnippets(resolveSnippetDirs(process.cwd()))
  const folded = [...map.entries()]
    .map(([key, variants]) => foldVariants(key, variants))
    .filter((r) => matchesFolded(r, options))

  if (options.format === 'json') {
    console.log(JSON.stringify(folded, null, 2))
    return
  }
  if (folded.length === 0) {
    console.log(t('queries.no_snippets'))
    return
  }
  const header = ['NAME', 'SOURCES', 'ENGINES', 'PARAMS', 'DESCRIPTION']
  const cells = folded.map((r) => [
    r.name + (r.hasLocalOverride ? '*' : ''),
    r.sources.join(','),
    r.engines.join(',') || '-',
    r.params.join(', ') || '-',
    r.description,
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] ?? '').length)))
  const fmt = (line: string[]) => line.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ')
  console.log(fmt(header))
  for (const c of cells) console.log(fmt(c))
}

interface FoldedRow {
  name: string
  sources: string[]
  engines: string[]
  params: string[]
  description: string
  tags: string[]
  hasLocalOverride: boolean
}

const FOLD_SOURCE_RANK = { builtin: 0, shared: 1, local: 2 } as const

function foldVariants(key: string, variants: ResolvedSnippet[]): FoldedRow {
  const sources = unique(variants.map((v) => v.query.source)).sort()
  const engines = unique(variants.flatMap((v) => v.query.meta.engine ?? [])).sort()
  const tags = unique(variants.flatMap((v) => v.query.meta.tags ?? []))
  const top = variants
    .slice()
    .sort((a, b) => FOLD_SOURCE_RANK[b.query.source] - FOLD_SOURCE_RANK[a.query.source])[0]!
  return {
    name: key,
    sources,
    engines,
    params: top.query.meta.params.map((p) => p.name),
    description: top.query.meta.description ?? '',
    tags,
    hasLocalOverride: variants.some((v) => v.hasLocalOverride),
  }
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

function snippetToJson(s: ResolvedSnippet): Record<string, unknown> {
  return {
    name: s.query.meta.key,
    source: s.query.source,
    engine: s.query.meta.engine?.length === 1 ? s.query.meta.engine[0] : s.query.meta.engine,
    description: s.query.meta.description,
    params: s.query.meta.params.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.required ? { required: true } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.enum ? { enum: p.enum } : {}),
    })),
    tags: s.query.meta.tags,
    file: s.query.file,
    hasLocalOverride: s.hasLocalOverride || undefined,
  }
}

function matchesFolded(r: FoldedRow, opts: ListOptions): boolean {
  if (opts.tag && !r.tags.includes(opts.tag)) return false
  if (opts.engine) {
    if (r.engines.length > 0 && !r.engines.includes(opts.engine)) return false
  }
  if (opts.source && !r.sources.includes(opts.source)) return false
  return true
}

export interface ShowOptions {
  format?: 'table' | 'json' | 'csv'
}

export async function queriesShow(name: string, options: ShowOptions): Promise<void> {
  const map = await loadSnippets(resolveSnippetDirs(process.cwd()))
  try {
    const engine = await deriveEngine()
    const snippet = resolveByName(map, name, engine)
    if (options.format === 'json') {
      console.log(
        JSON.stringify({ ...snippetToJson(snippet), sql: snippet.query.sqlBody.trim() }, null, 2)
      )
      return
    }
    console.log(`# ${snippet.query.meta.name}  (${snippet.query.source})`)
    if (snippet.query.meta.description) console.log(`# ${snippet.query.meta.description}`)
    if (snippet.query.meta.engine) console.log(`# engine: ${snippet.query.meta.engine.join(',')}`)
    if (snippet.query.meta.params.length > 0) {
      console.log('# params:')
      for (const p of snippet.query.meta.params) {
        const def = p.default !== undefined ? ` (default: ${p.default})` : ''
        const req = p.required ? ' (required)' : ''
        console.log(`#   ${p.name}: ${p.type}${req}${def}`)
      }
    }
    console.log('')
    console.log(snippet.query.sqlBody.trim())
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}

export interface NewOptions {
  local?: boolean
  edit?: boolean
}

export async function queriesNew(name: string, options: NewOptions): Promise<void> {
  if (!name.startsWith('@')) {
    console.error(`Snippet name must start with '@' (got '${name}')`)
    process.exit(1)
    return
  }
  const source: SnippetSource = options.local ? 'local' : 'shared'
  const file = snippetKeyToFile(process.cwd(), name, source)
  if (await Bun.file(file).exists()) {
    console.error(`Snippet already exists: ${file}`)
    process.exit(1)
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, scaffold(name), 'utf8')
  console.log(`Created ${file}`)
  if (source === 'shared') console.log(t('queries.first_run_hint'))
  if (options.edit) await openInEditor(file)
}

export interface EditOptions {
  shared?: boolean
}

export async function queriesEdit(name: string, options: EditOptions): Promise<void> {
  const candidates: string[] = options.shared
    ? [snippetKeyToFile(process.cwd(), name, 'shared')]
    : [
        snippetKeyToFile(process.cwd(), name, 'local'),
        snippetKeyToFile(process.cwd(), name, 'shared'),
      ]
  for (const f of candidates) {
    if (await Bun.file(f).exists()) {
      await openInEditor(f)
      return
    }
  }
  console.error(`Snippet not found locally or in shared: ${name}`)
  process.exit(1)
}

export interface CheckOptions {
  strict?: boolean
  format?: 'table' | 'json' | 'csv'
}

export async function queriesCheck(options: CheckOptions): Promise<void> {
  const dirs = resolveSnippetDirs(process.cwd())
  let failed = 0
  let total = 0
  try {
    const map = await loadSnippets(dirs)
    for (const variants of map.values()) {
      for (const snippet of variants) {
        total++
        try {
          const text = await Bun.file(snippet.query.file).text()
          const result = parseSavedQuery({
            key: snippet.query.meta.key,
            file: snippet.query.file,
            source: snippet.query.source,
            text,
          })
          if (options.strict && result.warnings.length > 0) {
            console.error(`✗ ${snippet.query.meta.key}: ${result.warnings.join('; ')}`)
            failed++
          }
        } catch (e) {
          const msg = e instanceof SavedQueryError ? e.message : (e as Error).message
          console.error(`✗ ${snippet.query.meta.key}: ${msg}`)
          failed++
        }
      }
    }
  } catch (e) {
    const msg = e instanceof SavedQueryError ? e.message : (e as Error).message
    console.error(`✗ ${msg}`)
    failed++
  }
  if (failed > 0) {
    console.error(`✗ ${failed} snippet(s) have errors`)
    process.exit(1)
  } else {
    console.log(`✓ ${total} snippets parsed successfully`)
  }
}

function scaffold(name: string): string {
  return [
    '-- ---',
    `-- name: ${name.replace(/^@/, '')}`,
    '-- description: TODO',
    '-- engine: postgres',
    '-- params: {}',
    '-- tags: []',
    '-- ---',
    '',
    'SELECT 1;',
    '',
  ].join('\n')
}

async function openInEditor(file: string): Promise<void> {
  const editor = process.env.EDITOR || 'vi'
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [file], { stdio: 'inherit' })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Editor exited with ${code}`))
    )
  })
}

export const queriesCommand = new Command('queries').description(t('queries.description'))

queriesCommand
  .command('list')
  .description(t('queries.list_description'))
  .option('--format <type>', 'Output format: table, json, csv', 'table')
  .option('--tag <tag>', 'Filter by tag')
  .option('--engine <engine>', 'Filter by engine: postgres | mysql')
  .option('--source <source>', 'Filter by source: local | shared')
  .action(async (options) => {
    await queriesList(options)
  })

queriesCommand
  .command('show <name>')
  .description(t('queries.show_description'))
  .option('--format <type>', 'Output format: table, json, csv', 'table')
  .action(async (name, options) => {
    await queriesShow(name, options)
  })

queriesCommand
  .command('new <name>')
  .description(t('queries.new_description'))
  .option('--local', 'Create under .dbcli/queries (gitignored) instead of .dbcli-shared/')
  .option('--edit', 'Open the created file in $EDITOR')
  .action(async (name, options) => {
    await queriesNew(name, options)
  })

queriesCommand
  .command('edit <name>')
  .description(t('queries.edit_description'))
  .option('--shared', 'Edit the shared file instead of local')
  .action(async (name, options) => {
    await queriesEdit(name, options)
  })

queriesCommand
  .command('check')
  .description(t('queries.check_description'))
  .option('--strict', 'Promote warnings to errors')
  .option('--format <type>', 'Output format: table, json, csv', 'table')
  .action(async (options) => {
    await queriesCheck(options)
  })

queriesCommand
  .command('delete <name>')
  .description(t('queries.delete_description'))
  .option('--force', 'Skip confirmation prompt')
  .action(async (name: string, options: { force?: boolean }) => {
    try {
      const { queriesDelete } = await import('@/commands/queries-delete')
      await queriesDelete(name, options)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
  })

queriesCommand
  .command('rename <old> <new>')
  .description(t('queries.rename_description'))
  .option('--force', 'Skip confirmation prompt')
  .action(async (oldName: string, newName: string, options: { force?: boolean }) => {
    try {
      const { queriesRename } = await import('@/commands/queries-rename')
      await queriesRename(oldName, newName, options)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
  })

queriesCommand
  .command('copy <src> <dst>')
  .description(t('queries.copy_description'))
  .action(async (src: string, dst: string) => {
    try {
      const { queriesCopy } = await import('@/commands/queries-copy')
      await queriesCopy(src, dst)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
  })

queriesCommand
  .command('import <path>')
  .description(t('queries.import_description'))
  .option('--force', 'Overwrite existing file without prompting')
  .option('--as <name>', 'Override snippet name (defaults to filename)')
  .action(async (path: string, options: { force?: boolean; as?: string }) => {
    try {
      const { queriesImport } = await import('@/commands/queries-import')
      await queriesImport(path, options)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
  })

queriesCommand
  .command('export <name>')
  .description(t('queries.export_description'))
  .option('--output <path>', 'Write to a file instead of stdout')
  .option('--engine <engine>', 'Pick a specific variant: postgres | mysql')
  .action(
    async (name: string, options: { output?: string; engine?: EngineTag }) => {
      try {
        const { queriesExport } = await import('@/commands/queries-export')
        await queriesExport(name, options)
      } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
      }
    }
  )
