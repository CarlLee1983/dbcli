import { Command } from 'commander'
import { resolveConfigPath } from '@/utils/config-path'
import { configModule } from '@/core/config'
import { compactVisibleSchema } from '@/core/context/context'
import { loadSnippets } from '@/core/saved-queries/loader'
import { resolveSnippetDirs } from '@/core/saved-queries/snippet-paths'
import {
  defaultSemanticFile,
  loadSemanticContext,
  SemanticValidationError,
  type SemanticContext,
} from '@/core/semantic'

type SemanticFormat = 'json' | 'markdown'

async function collectSemanticContext(
  command: Command,
  filePath?: string,
  missingFile: 'allow' | 'error' = 'error'
): Promise<{ context: SemanticContext | null; filePath: string }> {
  const workspaceRoot = process.cwd()
  const config = await configModule.read(resolveConfigPath(command))
  const snippets = await loadSnippets(resolveSnippetDirs(workspaceRoot))
  const resolvedFile = filePath ?? defaultSemanticFile(workspaceRoot)
  return {
    filePath: resolvedFile,
    context: await loadSemanticContext({
      workspaceRoot,
      filePath: resolvedFile,
      schema: compactVisibleSchema(config),
      snippets: [...snippets.keys()].map((key) => ({ key })),
      missingFile,
    }),
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
  return lines.join('\n')
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
  .command('context')
  .description('Print validated semantic context without querying a database')
  .option('--file <path>', 'Semantic JSON file (default: dbcli.semantic.json)')
  .option('--format <format>', 'Output format: json or markdown', 'json')
  .action(async (options: { file?: string; format?: SemanticFormat }, command: Command) => {
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
