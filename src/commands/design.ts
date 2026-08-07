import { Command } from 'commander'
import {
  compileDesignSchema,
  defaultDesignFile,
  DesignValidationError,
  loadDesignSpec,
  reviewDesign,
  type DesignDialect,
} from '@/core/design'
import { configModule } from '@/core/config'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import { compareNormalized } from '@/core/orm-drift/compare'
import { formatDrift, type DriftFormat } from '@/formatters/orm-drift'
import { resolveConfigPath } from '@/utils/config-path'
import { formatDesign, formatDesignReview } from '@/formatters/design'

const VALIDATE_FORMATS = ['json', 'markdown'] as const
const RENDER_FORMATS = ['json', 'markdown', 'mermaid'] as const
const DIFF_FORMATS = ['json', 'table', 'markdown'] as const

function defaultFile(file?: string): string {
  return file ?? defaultDesignFile(process.cwd())
}

function template(dialect: DesignDialect): string {
  return JSON.stringify(
    {
      version: 1,
      dialect,
      models: [],
      relationships: [],
      accessPatterns: [],
      decisions: [],
    },
    null,
    2
  ) + '\n'
}

function fail(error: unknown, format: 'json' | 'markdown'): never {
  if (error instanceof DesignValidationError) {
    const report = {
      findings: error.issues.map((issue) => ({ ...issue, code: 'INVALID_ARTIFACT', severity: 'error' as const })),
      summary: { errors: error.issues.length, warns: 0, infos: 0 },
    }
    console.log(formatDesignReview(report, format))
  } else {
    console.error((error as Error).message)
  }
  process.exit(1)
}

export const designCommand = new Command('design').description(
  'Validate, render, and safely review a version-controlled SQL database design'
)

designCommand
  .command('init')
  .description('Write an empty design artifact only to the explicitly supplied output path')
  .requiredOption('--output <path>', 'Path for the new design JSON artifact')
  .option('--dialect <dialect>', 'Target SQL dialect: postgresql, mysql, or mariadb', 'postgresql')
  .action(async (options: { output: string; dialect: string }) => {
    try {
      if (!['postgresql', 'mysql', 'mariadb'].includes(options.dialect)) {
        throw new Error('dialect must be postgresql, mysql, or mariadb')
      }
      const file = Bun.file(options.output)
      if (await file.exists()) throw new Error(`refusing to overwrite existing file: ${options.output}`)
      await Bun.write(options.output, template(options.dialect as DesignDialect))
      console.log(JSON.stringify({ status: 'created', path: options.output }, null, 2))
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

designCommand
  .command('diff')
  .description('Compare a valid design against the local SQL schema cache without connecting')
  .option('--file <path>', 'Design JSON file (default: dbcli.design.json)')
  .requiredOption('--against-cache', 'Compare against the configured local schema cache')
  .option('--format <format>', 'Output format: json, table, or markdown', 'json')
  .action(async (options: { file?: string; againstCache?: boolean; format?: string }, command: Command) => {
    const format = options.format
    if (!isFormat(format, DIFF_FORMATS)) throw new Error('format must be json, table, or markdown')
    try {
      const spec = await loadDesignSpec(defaultFile(options.file))
      const review = reviewDesign(spec)
      if (review.summary.errors > 0) {
        console.log(formatDesignReview(review, format === 'table' ? 'markdown' : format))
        process.exitCode = 1
        return
      }
      const config = await configModule.read(resolveConfigPath(command))
      const system = config.connection?.system
      if (!system || !['postgresql', 'mysql', 'mariadb'].includes(system)) {
        throw new Error('design diff --against-cache requires a configured PostgreSQL, MySQL, or MariaDB connection')
      }
      if (system !== spec.dialect) {
        throw new Error(`design dialect '${spec.dialect}' does not match configured connection '${system}'`)
      }
      if (Object.keys(config.schema ?? {}).length === 0) {
        throw new Error("Schema cache is empty. Run 'dbcli schema' first.")
      }
      const actual = normalizeDbSchema(config.schema!, system === 'postgresql' ? { defaultSchema: 'public' } : {})
      const report = compareNormalized(compileDesignSchema(spec), actual, { ignore: [] })
      console.log(formatDrift(report, format as DriftFormat))
      process.exitCode = report.summary.errors > 0 ? 1 : 0
    } catch (error) {
      fail(error, format === 'table' ? 'markdown' : format)
    }
  })

designCommand
  .command('validate')
  .description('Validate a local SQL design artifact without a database connection')
  .option('--file <path>', 'Design JSON file (default: dbcli.design.json)')
  .option('--format <format>', 'Output format: json or markdown', 'json')
  .action(async (options: { file?: string; format?: string }) => {
    const format = options.format
    if (!isFormat(format, VALIDATE_FORMATS)) throw new Error('format must be json or markdown')
    try {
      const review = reviewDesign(await loadDesignSpec(defaultFile(options.file)))
      console.log(formatDesignReview(review, format))
      process.exitCode = review.summary.errors > 0 ? 1 : 0
    } catch (error) {
      fail(error, format)
    }
  })

designCommand
  .command('render')
  .description('Render a valid local SQL design as JSON, Markdown, or Mermaid ERD')
  .option('--file <path>', 'Design JSON file (default: dbcli.design.json)')
  .option('--format <format>', 'Output format: json, markdown, or mermaid', 'markdown')
  .action(async (options: { file?: string; format?: string }) => {
    const format = options.format
    if (!isFormat(format, RENDER_FORMATS)) throw new Error('format must be json, markdown, or mermaid')
    try {
      const spec = await loadDesignSpec(defaultFile(options.file))
      const review = reviewDesign(spec)
      if (review.summary.errors > 0) {
        console.log(formatDesignReview(review, format === 'mermaid' ? 'markdown' : format))
        process.exitCode = 1
        return
      }
      console.log(formatDesign(spec, review, format))
    } catch (error) {
      fail(error, format === 'mermaid' ? 'markdown' : format)
    }
  })

function isFormat<T extends readonly string[]>(value: string | undefined, formats: T): value is T[number] {
  return value !== undefined && (formats as readonly string[]).includes(value)
}
