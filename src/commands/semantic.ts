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
  searchSemanticContext,
  SemanticValidationError,
  type SemanticDriftReport,
  type SemanticContext,
  type SemanticSearchKind,
  type SemanticSearchResult,
} from '@/core/semantic'

type SemanticContextFormat = 'json' | 'markdown'

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
