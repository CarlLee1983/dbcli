import { Command } from 'commander'
import { resolveConfigPath } from '@/utils/config-path'
import { configModule } from '@/core/config'
import { compactVisibleSchema } from '@/core/context/context'
import { listSnippetKeys } from '@/core/saved-queries/loader'
import { resolveSnippetDirs } from '@/core/saved-queries/snippet-paths'
import {
  defaultSemanticContractsFile,
  filterApprovedSemanticContracts,
  inspectSemanticContractDrift,
  loadSemanticContracts,
  renderSemanticContractsMarkdown,
  SemanticContractValidationError,
  type SemanticContract,
} from '@/core/contracts'
import {
  loadSemanticContext,
  semanticReferenceRegistry,
  type SemanticContext,
} from '@/core/semantic'

type ContractFormat = 'text' | 'json' | 'markdown'

interface ContractEvidence {
  workspaceRoot: string
  filePath: string
  references: Set<string>
  referencesAvailable: boolean
  blockedTerms: string[]
}

async function collectContractEvidence(
  command: Command,
  filePath?: string
): Promise<ContractEvidence> {
  const workspaceRoot = process.cwd()
  const config = await configModule.read(resolveConfigPath(command))
  const schema = compactVisibleSchema(config)
  // Keys only: `loadSnippets` would read and parse every saved-query SQL body
  // and print parse diagnostics, neither of which a contract command may do.
  const snippetKeys = await listSnippetKeys(resolveSnippetDirs(workspaceRoot))
  const blockedTerms = [
    ...(config.blacklist?.tables ?? []),
    ...Object.values(config.blacklist?.columns ?? {}).flat(),
  ]
  let context: SemanticContext | null = null
  try {
    context = await loadSemanticContext({
      workspaceRoot,
      schema,
      snippets: snippetKeys.map((key) => ({ key })),
      missingFile: 'allow',
    })
  } catch {
    // Drift reports unavailable semantic evidence without leaking local details.
  }

  return {
    workspaceRoot,
    filePath: filePath ?? defaultSemanticContractsFile(workspaceRoot),
    references: context ? semanticReferenceRegistry(context, schema, snippetKeys) : new Set(),
    referencesAvailable: context !== null,
    blockedTerms,
  }
}

async function loadContractsForInspection(
  command: Command,
  filePath?: string
): Promise<{ contracts: SemanticContract[]; filePath: string }> {
  const evidence = await collectContractEvidence(command, filePath)
  if (!evidence.referencesAvailable) throw new Error('semantic context is unavailable')
  return {
    filePath: evidence.filePath,
    contracts: await loadSemanticContracts({
      ...evidence,
      missingFile: 'error',
    }),
  }
}

function assertFormat(
  format: string | undefined,
  supported: readonly ContractFormat[]
): ContractFormat {
  if (!format || !supported.includes(format as ContractFormat)) {
    throw new Error(`Invalid format: supported formats are ${supported.join(', ')}`)
  }
  return format as ContractFormat
}

function renderSearchText(contracts: readonly SemanticContract[]): string {
  if (contracts.length === 0) return 'No matching approved semantic contracts.'
  return contracts
    .map((contract) => `[contract] ${contract.name} — ${contract.description}`)
    .join('\n')
}

function searchContracts(
  contracts: readonly SemanticContract[],
  terms: readonly string[]
): SemanticContract[] {
  const normalizedTerms = [
    ...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean)),
  ]
  return contracts.filter((contract) => {
    const searchable = [
      contract.name,
      contract.description,
      contract.owner,
      contract.evidencePolicy,
      ...contract.aliases,
      ...contract.subjects,
    ]
      .join(' ')
      .toLowerCase()
    return normalizedTerms.every((term) => searchable.includes(term))
  })
}

/**
 * Only messages this command composed itself, matched exactly. A prefix test
 * would keep passing once a literal grows an interpolated suffix, and config,
 * snippet, and filesystem errors carry absolute local paths.
 */
const SAFE_MESSAGES = new Set([
  'Invalid format: supported formats are text, json',
  'Invalid format: supported formats are json, markdown',
  'semantic context is unavailable',
])

function safeMessage(error: unknown): string {
  if (error instanceof SemanticContractValidationError) return error.message
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) return error.message
  return 'contract command failed; inspect the local contract and semantic artifacts'
}

function fail(error: unknown): never {
  console.error(safeMessage(error))
  process.exit(1)
}

export const contractCommand = new Command()
  .name('contract')
  .description('Validate and inspect local semantic contracts without querying a database')

contractCommand
  .command('validate')
  .description('Validate semantic contracts against the cached visible semantic registry')
  .option('--file <path>', 'Contract JSON file (default: dbcli.contracts.json)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (options: { file?: string; format?: string }, command: Command) => {
    try {
      const format = assertFormat(options.format, ['text', 'json'])
      const { contracts, filePath } = await loadContractsForInspection(command, options.file)
      const counts = contracts.reduce<Record<string, number>>((result, contract) => {
        result[contract.status] = (result[contract.status] ?? 0) + 1
        return result
      }, {})
      const payload = {
        valid: true,
        file: filePath,
        contracts: contracts.length,
        approved: counts.approved ?? 0,
        draft: counts.draft ?? 0,
        deprecated: counts.deprecated ?? 0,
      }
      console.log(
        format === 'json'
          ? JSON.stringify(payload, null, 2)
          : `Valid semantic contracts: ${filePath}`
      )
    } catch (error) {
      fail(error)
    }
  })

contractCommand
  .command('context')
  .description('Print approved semantic contracts suitable for ordinary agent context')
  .option('--file <path>', 'Contract JSON file (default: dbcli.contracts.json)')
  .option('--format <format>', 'Output format: json or markdown', 'json')
  .action(async (options: { file?: string; format?: string }, command: Command) => {
    try {
      const format = assertFormat(options.format, ['json', 'markdown'])
      const { contracts } = await loadContractsForInspection(command, options.file)
      const approved = filterApprovedSemanticContracts(contracts)
      console.log(
        format === 'json'
          ? JSON.stringify(approved, null, 2)
          : renderSemanticContractsMarkdown(approved)
      )
    } catch (error) {
      fail(error)
    }
  })

contractCommand
  .command('search [terms...]')
  .description('Search approved semantic contracts without querying a database')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (terms: string[], options: { format?: string }, command: Command) => {
    try {
      const format = assertFormat(options.format, ['text', 'json'])
      const { contracts } = await loadContractsForInspection(command)
      const results = searchContracts(filterApprovedSemanticContracts(contracts), terms)
      console.log(format === 'json' ? JSON.stringify(results, null, 2) : renderSearchText(results))
    } catch (error) {
      fail(error)
    }
  })

contractCommand
  .command('drift')
  .description('Check whether semantic contracts still match local semantic evidence')
  .option('--file <path>', 'Contract JSON file (default: dbcli.contracts.json)')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(async (options: { file?: string; format?: string }, command: Command) => {
    try {
      const format = assertFormat(options.format, ['text', 'json'])
      const evidence = await collectContractEvidence(command, options.file)
      const report = await inspectSemanticContractDrift({ ...evidence, missingFile: 'allow' })
      console.log(
        format === 'json'
          ? JSON.stringify(report, null, 2)
          : report.issues.length === 0
            ? 'Semantic contracts are valid.'
            : `Semantic contracts are ${report.status}.`
      )
      if (report.status !== 'valid') process.exit(1)
    } catch (error) {
      fail(error)
    }
  })
