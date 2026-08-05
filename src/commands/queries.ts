import { Command } from 'commander'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { t, t_vars } from '@/i18n/message-loader'
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
import { foldVariants, type FoldedRow } from '@/core/saved-queries/fold'
import { searchSnippets, type SearchInput, type SearchHit } from '@/core/saved-queries/search'
import { suggestSnippets, type SuggestInput, type SuggestHit } from '@/core/saved-queries/suggest'

async function deriveEngine(command?: Command): Promise<EngineTag> {
  try {
    const cfg = await configModule.read(resolveConfigPath(command))
    if (cfg.connection) {
      return mapSystemToEngine(cfg.connection.system)
    }
  } catch {
    // best-effort: fall through to default
  }
  return 'postgres'
}

export function listSnippetsForEngine(
  all: Map<string, ResolvedSnippet[]>,
  engine: EngineTag
): ResolvedSnippet[] {
  const out: ResolvedSnippet[] = []
  for (const variants of all.values()) {
    for (const v of variants) {
      const declared = v.query.meta.engine ?? []
      if (declared.length === 0 || declared.includes(engine)) {
        out.push(v)
      }
    }
  }
  return out
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

export async function queriesShow(
  name: string,
  options: ShowOptions,
  command?: Command
): Promise<void> {
  const map = await loadSnippets(resolveSnippetDirs(process.cwd()))
  try {
    const engine = await deriveEngine(command)
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
    // A file that fails to parse is skipped by the loader so it cannot break
    // every other command; `check` exists to report exactly those.
    const map = await loadSnippets({
      ...dirs,
      onError: ({ key, error }) => {
        total++
        failed++
        console.error(`✗ ${key}: ${error.message}`)
      },
    })
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

export interface SearchOptions {
  format?: 'table' | 'json'
  engine?: string
  source?: 'local' | 'shared' | 'builtin' | 'all'
  limit?: string
  includeInternal?: boolean
}

export async function queriesSearch(
  keywords: string[],
  options: SearchOptions,
  command?: Command
): Promise<void> {
  const query = keywords.join(' ').trim()
  if (!query) {
    console.error(t('queries.search_no_keywords'))
    process.exit(2)
    return
  }
  const allowed = ['postgres', 'mysql', 'redis', 'elasticsearch', 'mongodb', 'all'] as const
  if (options.engine && !allowed.includes(options.engine as (typeof allowed)[number])) {
    console.error(`Unknown engine '${options.engine}'. Allowed: ${allowed.join(', ')}.`)
    process.exit(2)
    return
  }
  const limit = options.limit !== undefined ? Number(options.limit) : 10
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error(`--limit must be a positive integer (got '${options.limit}')`)
    process.exit(2)
    return
  }

  const map = await loadSnippets(resolveSnippetDirs(process.cwd()))
  const folded = [...map.entries()].map(([key, variants]) => foldVariants(key, variants))

  let engineFilter: EngineTag | undefined
  if (options.engine && options.engine !== 'all') {
    engineFilter = options.engine as EngineTag
  } else if (!options.engine) {
    const inferred = await deriveEngineOrNull(command)
    if (inferred) engineFilter = inferred
    else console.error(t('queries.no_active_connection_hint'))
  }

  const input: SearchInput = {
    query,
    engineFilter,
    source: options.source,
    limit,
  }
  const hits = searchSnippets(folded, input)

  if (options.format === 'json') {
    console.log(JSON.stringify(hits.map(toSearchJson), null, 2))
    return
  }
  if (hits.length === 0) {
    console.log(t('queries.search_no_results'))
    return
  }
  renderSearchTable(hits, options.includeInternal === true)
}

async function deriveEngineOrNull(command?: Command): Promise<EngineTag | null> {
  try {
    const cfg = await configModule.read(resolveConfigPath(command))
    if (cfg.connection) {
      return mapSystemToEngine(cfg.connection.system)
    }
  } catch {
    // ignored
  }
  return null
}

function toSearchJson(h: SearchHit): Record<string, unknown> {
  return {
    name: h.name,
    engine: h.engine,
    source: h.source,
    intent: h.intent ?? null,
    description: h.description,
    tags: h.tags,
    score: h.score,
  }
}

function renderSearchTable(hits: SearchHit[], includeScore: boolean): void {
  const header = includeScore
    ? ['NAME', 'ENGINE', 'SOURCE', 'INTENT', 'SCORE', 'DESCRIPTION']
    : ['NAME', 'ENGINE', 'SOURCE', 'INTENT', 'DESCRIPTION']
  const rows = hits.map((h) => {
    const base = [h.name, h.engine ?? '-', h.source, h.intent ?? '-']
    if (includeScore) base.push(h.score.toFixed(3))
    base.push(h.description)
    return base
  })
  const widths = header.map((c, i) => Math.max(c.length, ...rows.map((r) => (r[i] ?? '').length)))
  const fmt = (line: string[]) => line.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ')
  console.log(fmt(header))
  for (const r of rows) console.log(fmt(r))
}

const INTENT_RE_CLI = /^[a-z][a-z0-9.-]*$/

export interface SuggestOptions {
  format?: 'table' | 'json'
  engine?: string
  source?: 'local' | 'shared' | 'builtin' | 'all'
}

export async function queriesSuggest(
  intent: string | undefined,
  options: SuggestOptions,
  command?: Command
): Promise<void> {
  const map = await loadSnippets(resolveSnippetDirs(process.cwd()))
  const folded = [...map.entries()].map(([key, variants]) => foldVariants(key, variants))
  const availableIntents = collectIntentPrefixes(folded)

  if (!intent) {
    console.error(
      t_vars('queries.suggest_missing_intent', {
        available: availableIntents.slice(0, 10).join(', '),
      })
    )
    process.exit(2)
    return
  }
  if (!INTENT_RE_CLI.test(intent)) {
    console.error(t_vars('queries.suggest_invalid_intent', { value: intent }))
    process.exit(2)
    return
  }
  const allowed = ['postgres', 'mysql', 'redis', 'elasticsearch', 'mongodb', 'all'] as const
  if (options.engine && !allowed.includes(options.engine as (typeof allowed)[number])) {
    console.error(`Unknown engine '${options.engine}'. Allowed: ${allowed.join(', ')}.`)
    process.exit(2)
    return
  }

  let engineFilter: EngineTag | undefined
  if (options.engine && options.engine !== 'all') {
    engineFilter = options.engine as EngineTag
  } else if (!options.engine) {
    const inferred = await deriveEngineOrNull(command)
    if (inferred) engineFilter = inferred
    else console.error(t('queries.no_active_connection_hint'))
  }

  const input: SuggestInput = { intent, engineFilter, source: options.source }
  const hits = suggestSnippets(folded, input)

  if (options.format === 'json') {
    console.log(JSON.stringify(hits.map(toSuggestJson), null, 2))
    return
  }
  if (hits.length === 0) {
    console.log(
      t_vars('queries.suggest_no_results', {
        intent,
        available: availableIntents.slice(0, 5).join(', '),
      })
    )
    return
  }
  renderSuggestTable(hits)
}

function collectIntentPrefixes(folded: FoldedRow[]): string[] {
  const seen = new Set<string>()
  for (const r of folded) {
    if (!r.intent) continue
    seen.add(r.intent)
    const dot = r.intent.indexOf('.')
    if (dot > 0) seen.add(r.intent.slice(0, dot))
  }
  return [...seen].sort()
}

function toSuggestJson(h: SuggestHit): Record<string, unknown> {
  return {
    name: h.name,
    engine: h.engine,
    source: h.source,
    intent: h.intent,
    description: h.description,
    tags: h.tags,
  }
}

function renderSuggestTable(hits: SuggestHit[]): void {
  const header = ['INTENT', 'NAME', 'ENGINE', 'SOURCE', 'DESCRIPTION']
  const rows = hits.map((h) => [h.intent, h.name, h.engine ?? '-', h.source, h.description])
  const widths = header.map((c, i) => Math.max(c.length, ...rows.map((r) => (r[i] ?? '').length)))
  const fmt = (line: string[]) => line.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ')
  console.log(fmt(header))
  for (const r of rows) console.log(fmt(r))
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
  .action(async (name, options, command) => {
    await queriesShow(name, options, command)
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
  .action(async (name: string, options: { output?: string; engine?: EngineTag }) => {
    try {
      const { queriesExport } = await import('@/commands/queries-export')
      await queriesExport(name, options)
    } catch (e) {
      console.error((e as Error).message)
      process.exit(1)
    }
  })

queriesCommand
  .command('search [keywords...]')
  .description(t('queries.search_description'))
  .option('--format <type>', 'Output format: table, json', 'table')
  .option('--engine <engine>', 'Filter: postgres | mysql | redis | elasticsearch | all')
  .option('--source <source>', 'Filter: local | shared | builtin | all')
  .option('--limit <n>', 'Max results (default 10)')
  .option('--include-internal', 'Show ranking score')
  .action(async (keywords: string[], options: SearchOptions, command) => {
    await queriesSearch(keywords, options, command)
  })

queriesCommand
  .command('suggest [intent]')
  .description(t('queries.suggest_description'))
  .option('--format <type>', 'Output format: table, json', 'table')
  .option('--engine <engine>', 'Filter: postgres | mysql | redis | elasticsearch | all')
  .option('--source <source>', 'Filter: local | shared | builtin | all')
  .action(async (intent: string | undefined, options: SuggestOptions, command) => {
    await queriesSuggest(intent, options, command)
  })
