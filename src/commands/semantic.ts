import { Command } from 'commander'
import { resolveConfigPath } from '@/utils/config-path'
import { configModule } from '@/core/config'
import { compactVisibleSchema } from '@/core/context/context'
import { listSnippetKeys, loadSnippets } from '@/core/saved-queries/loader'
import { resolveSnippetDirs } from '@/core/saved-queries/snippet-paths'
import {
  defaultSemanticFile,
  inspectSemanticDrift,
  loadSemanticContext,
  migrateSemanticContext,
  queryDraftReportMetadata,
  searchSemanticContext,
  SemanticValidationError,
  validateQueryDraft,
  type SemanticDriftReport,
  type SemanticContext,
  type SemanticSearchKind,
  type SemanticSearchResult,
  type QueryDraftValidationReport,
} from '@/core/semantic'
import type { SqlDatabaseSystem } from '@/adapters/types'

type SemanticContextFormat = 'json' | 'markdown'
type SemanticDraftFormat = 'text' | 'json'

const MAX_DRAFT_BYTES = 256 * 1024

interface SemanticContextUnavailableReport {
  status: 'unavailable'
  draftHash: string
  questionHash: string | null
  canonicalReferences: []
  violations: [{ code: 'SEMANTIC_CONTEXT_UNAVAILABLE' }]
}

type SemanticDraftReport = QueryDraftValidationReport | SemanticContextUnavailableReport

async function collectSemanticContext(
  command: Command,
  filePath?: string,
  missingFile: 'allow' | 'error' = 'error'
): Promise<{ context: SemanticContext | null; filePath: string }> {
  const input = await collectSemanticInputs(command, filePath)
  return {
    filePath: input.filePath,
    context: await loadSemanticContext({
      ...input,
      missingFile,
    }),
  }
}

async function collectSemanticInputs(command: Command, filePath?: string) {
  const workspaceRoot = process.cwd()
  const config = await configModule.read(resolveConfigPath(command))
  const snippets = await loadSnippets(resolveSnippetDirs(workspaceRoot))
  const resolvedFile = filePath ?? defaultSemanticFile(workspaceRoot)
  return {
    workspaceRoot,
    filePath: resolvedFile,
    schema: compactVisibleSchema(config),
    snippets: [...snippets.keys()].map((key) => ({ key })),
    // An empty schema cache cannot establish whether local references drifted.
    schemaAvailable: Object.keys(config.schema ?? {}).length > 0,
  }
}

async function collectSearchContext(
  command: Command,
  filePath?: string
): Promise<{
  context: SemanticContext | null
  blockedTerms: string[]
}> {
  const workspaceRoot = process.cwd()
  const config = await configModule.read(resolveConfigPath(command))
  const snippetKeys = await listSnippetKeys(resolveSnippetDirs(workspaceRoot))
  const context = await loadSemanticContext({
    workspaceRoot,
    filePath: filePath ?? defaultSemanticFile(workspaceRoot),
    schema: compactVisibleSchema(config),
    snippets: snippetKeys.map((key) => ({ key })),
  })
  return {
    context,
    blockedTerms: [
      ...(config.blacklist?.tables ?? []),
      ...Object.values(config.blacklist?.columns ?? {}).flat(),
    ],
  }
}

async function collectDraftValidationContext(command: Command): Promise<{
  context: SemanticContext
  schema: ReturnType<typeof compactVisibleSchema>
  savedQueryNames: string[]
  system: SqlDatabaseSystem
  blockedTerms: string[]
}> {
  const workspaceRoot = process.cwd()
  const config = await configModule.read(resolveConfigPath(command))
  if (Object.keys(config.schema ?? {}).length === 0) throw new Error('cached schema is unavailable')
  if (!isSqlDatabaseSystem(config.connection.system)) throw new Error('SQL semantic validation is unavailable')

  const schema = compactVisibleSchema(config)
  const savedQueryNames = await listSnippetKeys(resolveSnippetDirs(workspaceRoot))
  const context = await loadSemanticContext({
    workspaceRoot,
    schema,
    snippets: savedQueryNames.map((key) => ({ key })),
  })
  if (!context) throw new Error('semantic context file not found')
  return {
    context,
    schema,
    savedQueryNames,
    system: config.connection.system,
    blockedTerms: [
      ...(config.blacklist?.tables ?? []),
      ...Object.values(config.blacklist?.columns ?? {}).flat(),
    ],
  }
}

function isSqlDatabaseSystem(system: string): system is SqlDatabaseSystem {
  return system === 'postgresql' || system === 'mysql' || system === 'mariadb'
}

async function readDraftInput(input: string): Promise<unknown> {
  try {
    const file = input === '-' ? null : Bun.file(input)
    if (file && (!(await file.exists()) || file.size > MAX_DRAFT_BYTES)) return undefined
    const text = file ? await file.text() : await readBoundedStdin()
    if (text === undefined) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function readBoundedStdin(): Promise<string | undefined> {
  const reader = Bun.stdin.stream().getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_DRAFT_BYTES) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function renderDraftText(report: SemanticDraftReport): string {
  if (report.status === 'valid') return 'Query draft is valid.'
  if (report.status === 'unavailable') return 'Query draft validation is unavailable.'
  return `Query draft is invalid: ${report.violations.map((violation) => violation.code).join(', ')}`
}

function printDraftReport(report: SemanticDraftReport, format: SemanticDraftFormat): void {
  console.log(format === 'json' ? JSON.stringify(report, null, 2) : renderDraftText(report))
}

function unavailableDraftReport(draft: unknown): SemanticContextUnavailableReport {
  return {
    status: 'unavailable',
    ...queryDraftReportMetadata(draft),
    canonicalReferences: [],
    violations: [{ code: 'SEMANTIC_CONTEXT_UNAVAILABLE' }],
  }
}

function renderMarkdown(context: SemanticContext): string {
  const lines = ['# Semantic Context', '']
  if (context.models.length === 0) {
    lines.push('No semantic models defined.', '')
  } else {
    lines.push('## Models', '')
    for (const model of context.models) {
      lines.push(`### \`${model.name}\` → \`${model.table}\``)
      if (model.description) lines.push(model.description)
      if (model.aliases.length > 0)
        lines.push(`- Aliases: ${model.aliases.map((v) => `\`${v}\``).join(', ')}`)
      for (const field of model.fields) {
        const detail = field.description ? ` — ${field.description}` : ''
        const aliases =
          field.aliases.length > 0
            ? ` (aliases: ${field.aliases.map((v) => `\`${v}\``).join(', ')})`
            : ''
        lines.push(`- Field \`${field.column}\`${detail}${aliases}`)
      }
      lines.push('')
    }
  }
  if (context.metrics.length > 0) {
    lines.push('## Metrics', '')
    for (const metric of context.metrics) {
      const detail = metric.description ? ` — ${metric.description}` : ''
      lines.push(`- \`${metric.name}\` → \`${metric.query}\`${detail}`)
    }
    lines.push('')
  }
  if (context.relationships.length > 0) {
    lines.push('## Relationships', '')
    for (const relationship of context.relationships) {
      const detail = relationship.description ? ` — ${relationship.description}` : ''
      lines.push(
        `- \`${relationship.name}\`: \`${relationship.from.model}.${relationship.from.field}\` → \`${relationship.to.model}.${relationship.to.field}\` (${relationship.cardinality})${detail}`
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

function renderDriftText(report: SemanticDriftReport): string {
  if (report.issues.length === 0) return 'Semantic context is valid.'
  return [
    `Semantic context is ${report.status}.`,
    ...report.issues.map((issue) => `${issue.path}: ${issue.message}`),
  ].join('\n')
}

function renderSearchText(results: SemanticSearchResult[]): string {
  if (results.length === 0) return 'No matching semantic entities.'
  return results
    .map((result) => {
      const description = result.description ? ` — ${result.description}` : ''
      return `[${result.kind}] ${result.reference}${description}`
    })
    .join('\n')
}

function fail(error: unknown): never {
  if (error instanceof SemanticValidationError) {
    for (const issue of error.issues) console.error(`${issue.path}: ${issue.message}`)
  } else {
    console.error((error as Error).message)
  }
  process.exit(1)
}

export const semanticCommand = new Command()
  .name('semantic')
  .description('Validate and render local business semantic context without querying a database')

semanticCommand
  .command('validate')
  .description('Validate semantic models against the cached visible schema and saved-query names')
  .option('--file <path>', 'Semantic JSON file (default: dbcli.semantic.json)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (options: { file?: string; format?: string }, command: Command) => {
    try {
      if (options.format !== 'text' && options.format !== 'json') {
        throw new Error('Invalid format: supported formats are text, json')
      }
      const { context, filePath } = await collectSemanticContext(command, options.file)
      const payload = {
        valid: true,
        file: filePath,
        models: context?.models.length ?? 0,
        relationships: context?.relationships.length ?? 0,
        metrics: context?.metrics.length ?? 0,
      }
      console.log(
        options.format === 'json'
          ? JSON.stringify(payload, null, 2)
          : `Valid semantic context: ${filePath}`
      )
    } catch (error) {
      fail(error)
    }
  })

const semanticDraftCommand = semanticCommand
  .command('draft')
  .description('Validate an explicit untrusted query draft without executing it')

semanticDraftCommand
  .command('validate')
  .description('Validate a query draft from a file or stdin against local semantic evidence')
  .requiredOption('--input <file|->', 'Query draft JSON file, or - for stdin')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (options: { input?: string; format?: string }, command: Command) => {
    const format = options.format
    if (format !== 'text' && format !== 'json') {
      fail(new Error('Invalid format: supported formats are text, json'))
      return
    }

    const draft = await readDraftInput(options.input ?? '')
    let evidence: Awaited<ReturnType<typeof collectDraftValidationContext>>
    try {
      evidence = await collectDraftValidationContext(command)
    } catch {
      printDraftReport(unavailableDraftReport(draft), format)
      process.exit(2)
      return
    }

    try {
      const report = validateQueryDraft({ ...evidence, draft })
      printDraftReport(report, format)
      if (report.status !== 'valid') process.exit(1)
    } catch {
      const metadata = queryDraftReportMetadata(draft)
      printDraftReport(
        {
          status: 'invalid',
          ...metadata,
          canonicalReferences: [],
          violations: [{ code: 'INVALID_DRAFT' }],
        },
        format
      )
      process.exit(1)
    }
  })

semanticCommand
  .command('search [terms...]')
  .description(
    'Search validated semantic models, fields, relationships, and metrics without querying a database'
  )
  .option('--file <path>', 'Semantic JSON file (default: dbcli.semantic.json)')
  .option('--kind <kind>', 'Limit results to model, field, relationship, or metric')
  .option('--limit <count>', 'Maximum results (1-100)', '20')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(
    async (
      terms: string[],
      options: { file?: string; kind?: string; limit?: string; format?: string },
      command: Command
    ) => {
      try {
        if (options.format !== 'text' && options.format !== 'json') {
          throw new Error('Invalid format: supported formats are text, json')
        }
        if (!options.limit || !/^[1-9]\d*$/.test(options.limit)) {
          throw new Error('Invalid limit: expected an integer between 1 and 100')
        }
        const limit = Number(options.limit)
        const { context, blockedTerms } = await collectSearchContext(command, options.file)
        if (!context) throw new Error('Semantic context file not found')
        const results = searchSemanticContext(context, terms, {
          ...(options.kind ? { kind: options.kind as SemanticSearchKind } : {}),
          limit,
          blockedTerms,
        })
        console.log(
          options.format === 'json' ? JSON.stringify(results, null, 2) : renderSearchText(results)
        )
      } catch (error) {
        fail(error)
      }
    }
  )

semanticCommand
  .command('context')
  .description('Print validated semantic context without querying a database')
  .option('--file <path>', 'Semantic JSON file (default: dbcli.semantic.json)')
  .option('--format <format>', 'Output format: json or markdown', 'json')
  .action(async (options: { file?: string; format?: SemanticContextFormat }, command: Command) => {
    try {
      const format = options.format ?? 'json'
      if (format !== 'json' && format !== 'markdown') {
        throw new Error('Invalid format: supported formats are json, markdown')
      }
      const { context } = await collectSemanticContext(command, options.file)
      if (!context) throw new Error('Semantic context file not found')
      console.log(format === 'json' ? JSON.stringify(context, null, 2) : renderMarkdown(context))
    } catch (error) {
      fail(error)
    }
  })

semanticCommand
  .command('drift')
  .description(
    'Check whether a semantic context still matches the local cached schema and saved-query names'
  )
  .option('--file <path>', 'Semantic JSON file (default: dbcli.semantic.json)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (options: { file?: string; format?: string }, command: Command) => {
    try {
      if (options.format !== 'text' && options.format !== 'json') {
        throw new Error('Invalid format: supported formats are text, json')
      }
      const report = await inspectSemanticDrift(await collectSemanticInputs(command, options.file))
      console.log(
        options.format === 'json' ? JSON.stringify(report, null, 2) : renderDriftText(report)
      )
      if (report.status !== 'valid') process.exit(1)
    } catch (error) {
      fail(error)
    }
  })

semanticCommand
  .command('migrate')
  .description('Print a deterministic semantic context migration without writing a file')
  .requiredOption('--to <version>', 'Target semantic format version')
  .option('--file <path>', 'Semantic JSON file (default: dbcli.semantic.json)')
  .option('--format <format>', 'Output format: json', 'json')
  .action(async (options: { to?: string; file?: string; format?: string }, command: Command) => {
    try {
      if (options.to !== '2') throw new Error('Invalid --to value: supported target is 2')
      if (options.format !== 'json') throw new Error('Invalid format: supported format is json')
      const input = await collectSemanticInputs(command, options.file)
      const context = await migrateSemanticContext(input)
      console.log(JSON.stringify(context, null, 2))
    } catch (error) {
      fail(error)
    }
  })
