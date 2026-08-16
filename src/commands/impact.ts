import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { Command } from 'commander'
import { configModule } from '@/core/config'
import {
  assessImpact,
  type ImpactEvidenceSource,
  type SafeVerificationMetadata,
} from '@/core/impact'
import { compileDesignSchema, loadDesignSpec, reviewDesign } from '@/core/design'
import {
  defaultSemanticContractsFile,
  loadSemanticContracts,
  type SemanticContract,
} from '@/core/contracts'
import {
  defaultDataAccessManifestFile,
  loadDataAccessManifest,
  type DataAccessOperation,
} from '@/core/data-access'
import {
  defaultSemanticFile,
  containsBlockedSemanticIdentifier,
  loadSemanticContext,
  semanticReferenceRegistry,
  type SemanticContext,
  type SemanticSchemaTable,
} from '@/core/semantic'
import { normalizeDbSchema } from '@/core/orm-drift/from-db'
import { normalizeProposedChanges, type NormalizedChangeScope } from '@/core/orm-drift/change-set'
import { loadOrmSchema, parseAgainstOrmValues } from '@/commands/diff'
import { listSnippetKeys } from '@/core/saved-queries/loader'
import { resolveSnippetDirs } from '@/core/saved-queries/snippet-paths'
import { readVerificationArtifacts } from '@/core/verification/reader'
import { loadWorkloadSource, type WorkloadSource } from '@/core/workload-impact'
import { formatImpact, type ImpactFormat } from '@/formatters/impact'
import { resolveConfigPath } from '@/utils/config-path'

type FailOn = 'error' | 'warn' | 'never'

const FORMATS = ['json', 'markdown'] as const
const FAIL_ON = ['error', 'warn', 'never'] as const

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function parseIgnore(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function isFormat(value: string | undefined): value is ImpactFormat {
  return value === 'json' || value === 'markdown'
}

function isFailOn(value: string | undefined): value is FailOn {
  return value === 'error' || value === 'warn' || value === 'never'
}

export const impactCommand = new Command('impact').description(
  'Assess declared local dependencies for a proposed schema change without connecting'
)

impactCommand
  .command('assess')
  .description(
    'Write an offline impact assessment for a design against a local cache or ORM artifact'
  )
  .requiredOption('--design <path>', 'Design JSON file')
  .option('--against-cache', 'Compare against the configured local schema cache')
  .option(
    '--against-orm <paths>',
    'Compare against ORM definition(s), repeatable or comma-separated; DDL supports globs',
    collectOption,
    []
  )
  .option(
    '--orm-format <format>',
    'Force ORM input: prisma | ddl | json | drizzle | typeorm | sequelize'
  )
  .option('--ignore <globs>', 'Comma-separated table globs excluded from impact analysis')
  .option('--events <path>', 'Explicit proxy event file for advisory workload evidence')
  .requiredOption('--output <path>', 'Workspace-contained report output path')
  .option('--format <format>', `Output format: ${FORMATS.join(' or ')}`, 'json')
  .option('--fail-on <severity>', `Exit threshold: ${FAIL_ON.join(', ')}`, 'never')
  .action(async (options: Record<string, unknown>, command: Command) => {
    try {
      const format = options.format as string | undefined
      const failOn = options.failOn as string | undefined
      const againstOrm = (options.againstOrm as string[] | undefined) ?? []
      const againstCache = options.againstCache === true
      if (!isFormat(format)) throw new Error('format must be json or markdown')
      if (!isFailOn(failOn)) throw new Error('fail-on must be error, warn, or never')
      if (Number(againstCache) + Number(againstOrm.length > 0) !== 1) {
        throw new Error('Choose exactly one of --against-cache or --against-orm')
      }

      const workspaceRoot = await realpath(process.cwd())
      const spec = await loadDesignSpec(String(options.design))
      const review = reviewDesign(spec)
      if (review.summary.errors > 0) throw new Error('design contains validation errors')
      const config = await configModule.read(resolveConfigPath(command))
      const desired = compileDesignSchema(spec)
      const baseline = againstCache
        ? loadCacheBaseline(config, spec.dialect)
        : await loadOrmBaseline(againstOrm, options.ormFormat as string | undefined, spec.dialect)
      const blockedIdentifiers = [
        ...(config.blacklist?.tables ?? []),
        ...Object.values(config.blacklist?.columns ?? {}).flat(),
      ]
      const scope = changeScope(config, spec.dialect)
      const changes = normalizeProposedChanges({
        declared: desired,
        baseline,
        scope,
        origins: {
          declared: 'design-artifact',
          baseline: againstCache ? 'schema-cache' : 'orm-artifact',
        },
        ignore: parseIgnore(options.ignore as string | undefined),
      })
      const savedQueries = await loadSavedQueryKeys(workspaceRoot)
      const semantic = await loadSemanticEvidence(
        workspaceRoot,
        baseline,
        blockedIdentifiers,
        savedQueries
      )
      const contracts = await loadContractEvidence(
        workspaceRoot,
        semantic,
        baseline,
        savedQueries,
        blockedIdentifiers
      )
      const dataAccess = await loadDataAccessEvidence(
        workspaceRoot,
        semantic,
        baseline,
        savedQueries,
        blockedIdentifiers
      )
      const verifications = await loadVerificationEvidence(workspaceRoot, blockedIdentifiers)
      const observedWorkload = await loadObservedWorkloadSource(
        options.events as string | undefined,
        workspaceRoot,
        blockedIdentifiers
      )
      const report = assessImpact({
        changes,
        semantic,
        contracts,
        savedQueries,
        verifications,
        dataAccess,
        observedWorkload,
        blockedIdentifiers,
      })
      const rendered = formatImpact(report, format)
      const output = await resolveOutput(workspaceRoot, String(options.output))
      if (resolve(workspaceRoot, String(options.design)) === output) {
        throw new Error('design and output paths must differ')
      }
      await writeOutput(workspaceRoot, output, rendered)
      console.log(
        JSON.stringify(
          {
            path: relative(workspaceRoot, output),
            summary: report.summary,
            coverage: report.coverage.level,
          },
          null,
          2
        )
      )
      process.exitCode = shouldFail(report, failOn) ? 1 : 0
    } catch (error) {
      console.error(safeMessage(error))
      process.exitCode = 1
    }
  })

function loadCacheBaseline(
  config: Awaited<ReturnType<typeof configModule.read>>,
  dialect: 'postgresql' | 'mysql' | 'mariadb'
) {
  const system = config.connection?.system
  if (!system || !['postgresql', 'mysql', 'mariadb'].includes(system)) {
    throw new Error('impact assessment against cache requires a configured SQL connection')
  }
  if (system !== dialect) throw new Error('design dialect does not match the configured connection')
  if (Object.keys(config.schema ?? {}).length === 0) throw new Error('schema cache is empty')
  return normalizeDbSchema(
    config.schema!,
    system === 'postgresql' ? { defaultSchema: 'public' } : {}
  )
}

async function loadOrmBaseline(
  paths: string[],
  ormFormat: string | undefined,
  dialect: 'postgresql' | 'mysql' | 'mariadb'
) {
  const loaded = await loadOrmSchema(parseAgainstOrmValues(paths), {
    ...(ormFormat !== undefined && { ormFormat }),
    system: dialect,
  })
  return loaded.schema
}

function changeScope(
  config: Awaited<ReturnType<typeof configModule.read>>,
  system: 'postgresql' | 'mysql' | 'mariadb'
): NormalizedChangeScope {
  const connection = config.effectiveConnectionName
  const environment = config.effectiveEnvironment
  const catalog =
    typeof config.connection?.database === 'string' && config.connection.database.length > 0
      ? config.connection.database
      : undefined
  return {
    key: [environment ?? 'default', connection ?? 'default', system].join(':'),
    system,
    ...(connection !== undefined && { connection }),
    ...(environment !== undefined && { environment }),
    ...(catalog !== undefined && { catalog }),
  }
}

async function loadSavedQueryKeys(
  workspaceRoot: string
): Promise<ImpactEvidenceSource<readonly string[]>> {
  try {
    return {
      state: 'available',
      origin: 'saved-query-index',
      value: await listSnippetKeys(resolveSnippetDirs(workspaceRoot)),
    }
  } catch {
    return { state: 'unavailable', origin: 'saved-query-index', reason: 'unavailable' }
  }
}

async function loadSemanticEvidence(
  workspaceRoot: string,
  baseline: ReturnType<typeof compileDesignSchema>,
  blocked: readonly string[],
  savedQueries: ImpactEvidenceSource<readonly string[]>
): Promise<ImpactEvidenceSource<SemanticContext>> {
  if (!(await Bun.file(defaultSemanticFile(workspaceRoot)).exists())) {
    return { state: 'absent', origin: 'dbcli.semantic.json', reason: 'missing' }
  }
  const schema = semanticSchema(baseline, blocked)
  if (!schema) return { state: 'unavailable', origin: 'dbcli.semantic.json', reason: 'unavailable' }
  try {
    const context = await loadSemanticContext({
      workspaceRoot,
      schema,
      snippets: (savedQueries.state === 'available' ? savedQueries.value : []).map((key) => ({
        key,
      })),
      missingFile: 'error',
    })
    return context
      ? { state: 'available', origin: 'dbcli.semantic.json', value: context }
      : { state: 'absent', origin: 'dbcli.semantic.json', reason: 'missing' }
  } catch {
    return { state: 'invalid', origin: 'dbcli.semantic.json', reason: 'invalid' }
  }
}

async function loadContractEvidence(
  workspaceRoot: string,
  semantic: ImpactEvidenceSource<SemanticContext>,
  baseline: ReturnType<typeof compileDesignSchema>,
  savedQueries: ImpactEvidenceSource<readonly string[]>,
  blocked: readonly string[]
): Promise<ImpactEvidenceSource<readonly SemanticContract[]>> {
  if (!(await Bun.file(defaultSemanticContractsFile(workspaceRoot)).exists())) {
    return { state: 'absent', origin: 'dbcli.contracts.json', reason: 'missing' }
  }
  if (semantic.state !== 'available') {
    return { state: 'unavailable', origin: 'dbcli.contracts.json', reason: 'unavailable' }
  }
  const schema = semanticSchema(baseline, blocked)
  if (!schema)
    return { state: 'unavailable', origin: 'dbcli.contracts.json', reason: 'unavailable' }
  try {
    const references = semanticReferenceRegistry(
      semantic.value,
      schema,
      savedQueries.state === 'available' ? savedQueries.value : []
    )
    const contracts = await loadSemanticContracts({
      workspaceRoot,
      references,
      blockedTerms: blocked,
      missingFile: 'error',
    })
    return { state: 'available', origin: 'dbcli.contracts.json', value: contracts }
  } catch {
    return { state: 'invalid', origin: 'dbcli.contracts.json', reason: 'invalid' }
  }
}

async function loadDataAccessEvidence(
  workspaceRoot: string,
  semantic: ImpactEvidenceSource<SemanticContext>,
  baseline: ReturnType<typeof compileDesignSchema>,
  savedQueries: ImpactEvidenceSource<readonly string[]>,
  blocked: readonly string[]
): Promise<ImpactEvidenceSource<readonly DataAccessOperation[]>> {
  if (!(await Bun.file(defaultDataAccessManifestFile(workspaceRoot)).exists())) {
    return { state: 'absent', origin: 'dbcli.data-access.json', reason: 'missing' }
  }
  if (semantic.state !== 'available') {
    return { state: 'unavailable', origin: 'dbcli.data-access.json', reason: 'unavailable' }
  }
  const schema = semanticSchema(baseline, blocked)
  if (!schema)
    return { state: 'unavailable', origin: 'dbcli.data-access.json', reason: 'unavailable' }
  try {
    const references = semanticReferenceRegistry(
      semantic.value,
      schema,
      savedQueries.state === 'available' ? savedQueries.value : []
    )
    return {
      state: 'available',
      origin: 'dbcli.data-access.json',
      value: await loadDataAccessManifest({
        workspaceRoot,
        references,
        blockedTerms: blocked,
        missingFile: 'error',
      }),
    }
  } catch {
    return { state: 'invalid', origin: 'dbcli.data-access.json', reason: 'invalid' }
  }
}

async function loadVerificationEvidence(
  workspaceRoot: string,
  blocked: readonly string[]
): Promise<ImpactEvidenceSource<readonly SafeVerificationMetadata[]>> {
  try {
    const read = await readVerificationArtifacts(workspaceRoot)
    try {
      await lstat(read.storageDir)
    } catch {
      return { state: 'absent', origin: 'verification-artifacts', reason: 'missing' }
    }
    if (read.invalid.length > 0) {
      return { state: 'invalid', origin: 'verification-artifacts', reason: 'invalid' }
    }
    const safeArtifacts = read.artifacts.filter(
      (record) =>
        !containsBlockedSemanticIdentifier(record.artifact.id, blocked) &&
        (record.artifact.subject.name === undefined ||
          !containsBlockedSemanticIdentifier(record.artifact.subject.name, blocked))
    )
    return {
      state: 'available',
      origin: 'verification-artifacts',
      redacted: safeArtifacts.length !== read.artifacts.length,
      value: safeArtifacts.map((record) => ({
        id: record.artifact.id,
        createdAt: record.artifact.createdAt,
        status: record.artifact.status,
        subject: {
          kind: record.artifact.subject.kind,
          ...(record.artifact.subject.name !== undefined && { name: record.artifact.subject.name }),
        },
        location: `verification:${record.artifact.id}`,
      })),
    }
  } catch {
    return { state: 'unavailable', origin: 'verification-artifacts', reason: 'unavailable' }
  }
}

function semanticSchema(
  schema: ReturnType<typeof compileDesignSchema>,
  blocked: readonly string[]
): Record<string, SemanticSchemaTable> | undefined {
  const result: Record<string, SemanticSchemaTable> = {}
  for (const table of schema.tables) {
    if (containsBlockedSemanticIdentifier(table.identity.table, blocked)) continue
    if (result[table.identity.table]) return undefined
    result[table.identity.table] = {
      columns: table.columns
        .filter((column) => !containsBlockedSemanticIdentifier(column.name, blocked))
        .map((column) => ({ name: column.name })),
    }
  }
  return result
}

async function loadObservedWorkloadSource(
  path: string | undefined,
  workspaceRoot: string,
  blocked: readonly string[]
): Promise<WorkloadSource> {
  if (path === undefined) {
    return {
      state: 'absent',
      origin: 'proxy-workload',
      observations: [],
      malformedLines: 0,
      issues: [],
    }
  }
  return loadWorkloadSource({ path: resolve(workspaceRoot, path), blockedIdentifiers: blocked })
}

export function shouldFail(
  report: {
    summary: { errors: number }
    findings: { code: string; severity: string }[]
    coverage: { gaps: { code: string }[] }
  },
  failOn: FailOn
): boolean {
  if (failOn === 'never') return false
  if (failOn === 'error') return report.summary.errors > 0
  return (
    report.summary.errors > 0 ||
    report.findings.some(
      (finding) => finding.severity === 'warn' && finding.code !== 'AFFECTED_OBSERVED_WORKLOAD'
    ) ||
    report.coverage.gaps.some((gap) => !gap.code.startsWith('WORKLOAD_'))
  )
}

function safeMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'impact assessment failed'
  return /^(format must|fail-on must|Choose exactly|design and output paths must differ|output path must|impact assessment against|design dialect|schema cache is empty|design contains validation errors)/.test(
    error.message
  )
    ? error.message
    : 'impact assessment failed; inspect the supplied local artifacts'
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return (
    relativePath !== '' &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== '..' &&
    !relativePath.includes(`..${sep}`)
  )
}

async function realExistingAncestor(path: string): Promise<string> {
  let candidate = path
  while (true) {
    try {
      return await realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

async function resolveOutput(workspaceRoot: string, outputPath: string): Promise<string> {
  const workspace = await realpath(workspaceRoot)
  const target = resolve(workspace, outputPath)
  if (!isInside(workspace, target)) throw new Error('output path must stay inside the workspace')
  const parent = dirname(target)
  const existingAncestor = await realExistingAncestor(parent)
  if (!isInside(workspace, existingAncestor) && existingAncestor !== workspace)
    throw new Error('output path must stay inside the workspace')
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent)
  if (!isInside(workspace, realParent) && realParent !== workspace)
    throw new Error('output path must stay inside the workspace')
  return resolve(realParent, basename(target))
}

async function assertOutputParent(workspaceRoot: string, path: string): Promise<void> {
  const workspace = await realpath(workspaceRoot)
  const parent = await realpath(dirname(path))
  if (!isInside(workspace, parent) && parent !== workspace) {
    throw new Error('output path must stay inside the workspace')
  }
}

async function writeOutput(workspaceRoot: string, path: string, content: string): Promise<void> {
  await assertOutputParent(workspaceRoot, path)
  try {
    await lstat(path)
    throw new Error('impact output already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temp = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, 'utf8')
    await assertOutputParent(workspaceRoot, path)
    await link(temp, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('impact output already exists')
    throw error
  } finally {
    await unlink(temp).catch(() => {})
  }
}
