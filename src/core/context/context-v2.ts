import { lstat, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { TableSchema } from '@/adapters/types'
import {
  getEngineCapabilities,
  type CapabilityStatus,
  type SideEffectTier,
} from '@/adapters/capabilities'
import { BlacklistManager } from '@/core/blacklist-manager'
import { configModule } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import {
  filterApprovedSemanticContracts,
  hasSemanticContractReferenceIssue,
  loadSemanticContracts,
  SemanticContractValidationError,
  type SemanticContract,
} from '@/core/contracts'
import {
  defaultDataAccessManifestFile,
  hasDataAccessReferenceIssue,
  loadDataAccessManifest,
  DataAccessManifestValidationError,
  type DataAccessOperation,
} from '@/core/data-access'
import { loadSnippets } from '@/core/saved-queries/loader'
import { mapSystemToEngine } from '@/core/saved-queries/engine-map'
import { resolveSnippetDirs } from '@/core/saved-queries/snippet-paths'
import type { ResolvedSnippet } from '@/core/saved-queries/types'
import {
  containsBlockedSemanticIdentifier,
  hasSemanticReferenceIssue,
  loadSemanticContext,
  semanticReferenceRegistry,
  SemanticValidationError,
  type SemanticContext,
} from '@/core/semantic'
import { globMatches, globsOverlap, isGlobPattern } from '@/utils/glob'

const RESOURCE_LIMIT = 500
const FIELD_LIMIT = 5_000
const SNIPPET_LIMIT = 500
const DECLARATION_LIMIT = 500
const REDIS_CONTEXT_BYTES = 512 * 1024
const SUPPORTED_SYSTEMS = new Set(['postgresql', 'mysql', 'mariadb', 'elasticsearch', 'redis'])
const KNOWN_SYSTEMS = new Set([...SUPPORTED_SYSTEMS, 'mongodb'])
const CAPABILITY_COMMANDS = ['schema', 'query', 'q', 'queries', 'export', 'shell'] as const

export type ContextV2ErrorCode =
  | 'UNSUPPORTED_CONTEXT_ENGINE'
  | 'INVALID_SCHEMA_CACHE'
  | 'INVALID_SEMANTIC_CONTEXT'
  | 'INVALID_SAVED_QUERY'
  | 'INVALID_DATA_ACCESS_MANIFEST'
  | 'INVALID_REDIS_CONTEXT'
  | 'INVALID_RESOURCE_REFERENCE'

export class ContextV2Error extends Error {
  constructor(readonly code: ContextV2ErrorCode) {
    super(code)
    this.name = 'ContextV2Error'
  }
}

export interface ContextGap {
  code:
    | 'SQL_SCHEMA_UNAVAILABLE'
    | 'ELASTICSEARCH_MAPPING_UNAVAILABLE'
    | 'REDIS_KEY_FAMILIES_UNAVAILABLE'
    | 'SEMANTIC_CONTEXT_UNAVAILABLE'
    | 'SAVED_QUERIES_UNAVAILABLE'
    | 'DATA_ACCESS_UNAVAILABLE'
    | 'ALL_RESOURCES_FILTERED'
    | 'CONTEXT_TRUNCATED'
  scope: 'resources' | 'semantic' | 'snippets' | 'dataAccess' | 'context'
}

export interface ContextCount {
  emitted: number
  omitted: number
}

export interface ContextV2Payload {
  contextVersion: 2
  version: string
  system: string
  permission: string
  blacklist: { tables: string[]; columns: Record<string, string[]> }
  capabilities: Array<{
    command: string
    status: CapabilityStatus
    sideEffectTier: SideEffectTier
  }>
  resources: SqlResources | ElasticsearchResources | RedisResources
  snippets: ContextSnippet[]
  dataAccess: ContextDataAccess[]
  semantic?: ContextSemantic
  contracts?: ContextContract[]
  gaps: ContextGap[]
  truncation: {
    resources: ContextCount
    fields: ContextCount
    snippets: ContextCount
    declarations: ContextCount
  }
}

export interface SqlColumn {
  id: string
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

export interface SqlTable {
  id: string
  name: string
  columns: SqlColumn[]
  relationships: Array<{
    columns: string[]
    referencedColumns: string[]
    referencedTableId: string
  }>
}

export interface SqlResources {
  kind: 'sql'
  tables: SqlTable[]
}

export interface ElasticsearchResources {
  kind: 'elasticsearch'
  indices: Array<{
    id: string
    name: string
    fields: Array<{ id: string; path: string; type: string }>
  }>
}

export interface RedisField {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'json' | 'timestamp' | 'binary'
  description?: string
  aliases?: string[]
}

export interface RedisFamily {
  id: string
  name: string
  pattern: string
  type: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream'
  description?: string
  aliases?: string[]
  fields: RedisField[]
}

export interface RedisResources {
  kind: 'redis'
  keyFamilies: RedisFamily[]
}

export interface ContextSnippet {
  key: string
  description?: string
  intent?: string
  engines?: string[]
  parameters: Array<{ name: string; type: string; required: boolean }>
}

export interface ContextSemantic {
  version: 1 | 2
  models: Array<{
    reference: string
    name: string
    tableId: string
    description?: string
    aliases: string[]
    fields: Array<{
      reference: string
      name: string
      fieldId: string
      description?: string
      aliases: string[]
    }>
  }>
  relationships: Array<{
    reference: string
    name: string
    from: string
    to: string
    cardinality: string
    description?: string
  }>
  metrics: Array<{ reference: string; name: string; query: string; description?: string }>
}

export interface ContextContract {
  name: string
  description: string
  subjects: string[]
  owner: string
  aliases: string[]
  evidencePolicy: string
}

export interface ContextDataAccess {
  name: string
  kind: string
  semanticReferences: string[]
  coverage: 'declared'
}

type RuntimeConfig = Awaited<ReturnType<typeof configModule.read>>

export async function gatherContextV2(
  workspaceRoot: string,
  configPath: string
): Promise<ContextV2Payload> {
  await rejectUnknownConfiguredEngine(configPath)
  const config = await configModule.read(configPath)
  const system = config.connection?.system ?? 'unknown'
  if (!SUPPORTED_SYSTEMS.has(system)) throw new ContextV2Error('UNSUPPORTED_CONTEXT_ENGINE')

  const blacklist = {
    tables: [...(config.blacklist?.tables ?? [])].sort(codePointOrder),
    columns: sortedRecord(config.blacklist?.columns ?? {}),
  }
  const blockedTerms = [...blacklist.tables, ...Object.values(blacklist.columns).flat()].filter(
    Boolean
  )
  const version = safeString(
    config.metadata?.version ?? '1.0',
    'INVALID_SCHEMA_CACHE',
    blockedTerms,
    1,
    1_000
  )
  const gaps: ContextGap[] = []
  const fullResources = await collectResources(workspaceRoot, config, system, blockedTerms, gaps)
  const resourceTotals = countResources(fullResources)
  const resources = limitResources(fullResources)
  const emittedResources = countResources(resources)

  const allSnippets = await collectSnippets(workspaceRoot, system, blockedTerms)
  if (allSnippets.length === 0) gaps.push({ code: 'SAVED_QUERIES_UNAVAILABLE', scope: 'snippets' })
  const snippets = allSnippets.slice(0, SNIPPET_LIMIT)

  const completeSemanticSchema = semanticSchema(fullResources)
  let semanticSource: SemanticContext | null
  try {
    semanticSource = await loadSemanticContext({
      workspaceRoot,
      schema: completeSemanticSchema,
      snippets: allSnippets.map(({ key }) => ({ key })),
      missingFile: 'allow',
    })
  } catch (error) {
    if (error instanceof SemanticValidationError && hasSemanticReferenceIssue(error.issues)) {
      throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
    }
    throw new ContextV2Error('INVALID_SEMANTIC_CONTEXT')
  }
  if (!semanticSource) gaps.push({ code: 'SEMANTIC_CONTEXT_UNAVAILABLE', scope: 'semantic' })

  const completeRegistry = semanticSource
    ? semanticReferenceRegistry(
        semanticSource,
        completeSemanticSchema,
        allSnippets.map(({ key }) => key)
      )
    : new Set<string>()

  let contractsSource: SemanticContract[]
  try {
    contractsSource = filterApprovedSemanticContracts(
      await loadSemanticContracts({
        workspaceRoot,
        references: completeRegistry,
        blockedTerms,
      })
    )
  } catch (error) {
    if (
      error instanceof SemanticContractValidationError &&
      hasSemanticContractReferenceIssue(error.issues)
    ) {
      throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
    }
    throw new ContextV2Error('INVALID_SEMANTIC_CONTEXT')
  }

  const dataAccessFile = defaultDataAccessManifestFile(workspaceRoot)
  const dataAccessPresent = await Bun.file(dataAccessFile).exists()
  let dataAccessSource: readonly DataAccessOperation[]
  try {
    dataAccessSource = await loadDataAccessManifest({
      workspaceRoot,
      references: completeRegistry,
      blockedTerms,
    })
  } catch (error) {
    if (
      error instanceof DataAccessManifestValidationError &&
      hasDataAccessReferenceIssue(error.issues)
    ) {
      throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
    }
    throw new ContextV2Error('INVALID_DATA_ACCESS_MANIFEST')
  }
  if (!dataAccessPresent) gaps.push({ code: 'DATA_ACCESS_UNAVAILABLE', scope: 'dataAccess' })

  const emittedIds = emittedResourceIds(resources)
  const snippetKeys = new Set(snippets.map(({ key }) => key))
  const semantic = semanticSource
    ? projectSemantic(semanticSource, fullResources, emittedIds, snippetKeys, blockedTerms)
    : undefined
  const emittedReferences = semanticReferences(semantic)
  const contracts = contractsSource
    .filter((contract) => contract.subjects.every((subject) => emittedReferences.has(subject)))
    .map((contract) => projectContract(contract, blockedTerms))
  const eligibleDataAccess = dataAccessSource.filter((operation) =>
    operation.references.every((reference) => emittedReferences.has(reference))
  )
  const dataAccess = eligibleDataAccess
    .sort((left, right) => codePointOrder(left.name, right.name))
    .slice(0, DECLARATION_LIMIT)
    .map((operation) => projectDataAccess(operation, blockedTerms))

  const truncation = {
    resources: count(emittedResources.resources, resourceTotals.resources),
    fields: count(emittedResources.fields, resourceTotals.fields),
    snippets: count(snippets.length, allSnippets.length),
    declarations: count(dataAccess.length, dataAccessSource.length),
  }
  if (Object.values(truncation).some(({ omitted }) => omitted > 0)) {
    gaps.push({ code: 'CONTEXT_TRUNCATED', scope: 'context' })
  }

  return {
    contextVersion: 2,
    version,
    system,
    permission: config.permission ?? 'query-only',
    blacklist,
    capabilities: CAPABILITY_COMMANDS.map((command) => {
      const capability = getEngineCapabilities(
        system as Parameters<typeof getEngineCapabilities>[0]
      )[command]
      return {
        command,
        status: capability.status,
        sideEffectTier: capability.tier,
      }
    }).sort((a, b) => codePointOrder(a.command, b.command)),
    resources,
    snippets,
    dataAccess,
    ...(semantic ? { semantic } : {}),
    ...(contracts.length > 0 ? { contracts } : {}),
    gaps: gaps.sort(compareGap),
    truncation,
  }
}

async function collectResources(
  workspaceRoot: string,
  config: RuntimeConfig,
  system: string,
  blockedTerms: string[],
  gaps: ContextGap[]
): Promise<SqlResources | ElasticsearchResources | RedisResources> {
  if (system === 'redis') return collectRedisResources(workspaceRoot, config, blockedTerms, gaps)
  const raw = config.schema
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContextV2Error('INVALID_SCHEMA_CACHE')
  }
  const entries = Object.entries(raw)
  const manager = new BlacklistManager(config)
  const visible = entries.filter(([name]) => !manager.isTableBlacklisted(name))
  if (entries.length === 0) {
    gaps.push({
      code:
        system === 'elasticsearch' ? 'ELASTICSEARCH_MAPPING_UNAVAILABLE' : 'SQL_SCHEMA_UNAVAILABLE',
      scope: 'resources',
    })
  } else if (visible.length === 0) {
    gaps.push({ code: 'ALL_RESOURCES_FILTERED', scope: 'resources' })
  }
  if (system === 'elasticsearch') {
    const indices = visible
      .map(([, value]) => parseElasticsearchIndex(value, manager, blockedTerms))
      .sort((a, b) => codePointOrder(a.name, b.name))
    unique(
      indices.map(({ name }) => name),
      'INVALID_SCHEMA_CACHE'
    )
    unique(
      indices.map(({ id }) => id),
      'INVALID_SCHEMA_CACHE'
    )
    return {
      kind: 'elasticsearch',
      indices,
    }
  }
  const tables = visible
    .map(([, value]) => parseSqlTable(value, system, manager, blockedTerms))
    .sort((a, b) => codePointOrder(a.name, b.name))
  unique(
    tables.map(({ name }) => name),
    'INVALID_SCHEMA_CACHE'
  )
  unique(
    tables.map(({ id }) => id),
    'INVALID_SCHEMA_CACHE'
  )
  const tableByName = new Map(tables.map((table) => [table.name, table]))
  for (const table of tables) {
    table.relationships = table.relationships.filter((relationship) => {
      const referenced = [...tableByName.values()].find(
        (candidate) => candidate.id === relationship.referencedTableId
      )
      if (!referenced) throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
      if (
        !relationship.columns.every((id) => table.columns.some((column) => column.id === id)) ||
        !relationship.referencedColumns.every((id) =>
          referenced.columns.some((column) => column.id === id)
        )
      ) {
        throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
      }
      return true
    })
  }
  return { kind: 'sql', tables }
}

function parseSqlTable(
  raw: unknown,
  system: string,
  manager: BlacklistManager,
  blockedTerms: string[]
): SqlTable {
  const table = schemaTable(raw)
  const name = requiredString(table.name, 'INVALID_SCHEMA_CACHE', blockedTerms)
  const id = sqlTableId(name, system, manager)
  const columns = schemaColumns(table)
    .filter((column) => !manager.isColumnBlacklisted(name, column.name))
    .map((column) => ({
      id: sqlFieldId(name, column.name, system, manager),
      name: safeString(column.name, 'INVALID_SCHEMA_CACHE', blockedTerms, 1, 1_000),
      type: safeString(column.type, 'INVALID_SCHEMA_CACHE', blockedTerms, 1, 1_000),
      nullable: booleanValue(column.nullable),
      primaryKey: column.primaryKey === undefined ? false : booleanValue(column.primaryKey),
    }))
    .sort((a, b) => codePointOrder(a.name, b.name))
  unique(
    columns.map(({ name: column }) => column),
    'INVALID_SCHEMA_CACHE'
  )
  const relationships = Array.isArray(table.foreignKeys)
    ? table.foreignKeys.flatMap((rawForeignKey) => {
        if (!record(rawForeignKey)) throw new ContextV2Error('INVALID_SCHEMA_CACHE')
        const columns = stringArray(rawForeignKey.columns, 'INVALID_SCHEMA_CACHE')
        const refColumns = stringArray(rawForeignKey.refColumns, 'INVALID_SCHEMA_CACHE')
        const refTable = requiredString(rawForeignKey.refTable, 'INVALID_SCHEMA_CACHE', [])
        if (columns.length === 0 || columns.length !== refColumns.length) {
          throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
        }
        if (
          manager.isTableBlacklisted(refTable) ||
          columns.some((column) => manager.isColumnBlacklisted(name, column)) ||
          refColumns.some((column) => manager.isColumnBlacklisted(refTable, column))
        ) {
          return []
        }
        return [
          {
            columns: columns.map((column) => sqlFieldId(name, column, system, manager)),
            referencedColumns: refColumns.map((column) =>
              sqlFieldId(refTable, column, system, manager)
            ),
            referencedTableId: sqlTableId(refTable, system, manager),
          },
        ]
      })
    : []
  if (table.foreignKeys !== undefined && !Array.isArray(table.foreignKeys)) {
    throw new ContextV2Error('INVALID_SCHEMA_CACHE')
  }
  return { id, name, columns, relationships }
}

function parseElasticsearchIndex(
  raw: unknown,
  manager: BlacklistManager,
  blockedTerms: string[]
): ElasticsearchResources['indices'][number] {
  const table = schemaTable(raw)
  const name = requiredString(table.name, 'INVALID_SCHEMA_CACHE', blockedTerms)
  const id = elasticsearchIndexId(name)
  const fields = schemaColumns(table)
    .filter((column) => !manager.isColumnBlacklisted(name, column.name))
    .map((column) => {
      const path = safeString(column.name, 'INVALID_SCHEMA_CACHE', blockedTerms, 1, 1_000)
      return {
        id: id + '/field/' + encoded(path, 'INVALID_SCHEMA_CACHE'),
        path,
        type: safeString(column.type, 'INVALID_SCHEMA_CACHE', blockedTerms, 1, 1_000),
      }
    })
    .sort((a, b) => codePointOrder(a.path, b.path))
  unique(
    fields.map(({ path }) => path),
    'INVALID_SCHEMA_CACHE'
  )
  return { id, name, fields }
}

async function collectRedisResources(
  workspaceRoot: string,
  config: RuntimeConfig,
  blockedTerms: string[],
  gaps: ContextGap[]
): Promise<RedisResources> {
  const filePath = resolve(workspaceRoot, 'dbcli.redis-context.json')
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(filePath)
  } catch {
    gaps.push({ code: 'REDIS_KEY_FAMILIES_UNAVAILABLE', scope: 'resources' })
    return { kind: 'redis', keyFamilies: [] }
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > REDIS_CONTEXT_BYTES) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  try {
    if ((await realpath(filePath)) !== filePath) throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  } catch {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  let raw: unknown
  try {
    raw = JSON.parse(await Bun.file(filePath).text())
  } catch {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.keyFamilies)) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  exactKeys(raw, ['version', 'keyFamilies'], 'INVALID_REDIS_CONTEXT')
  if (raw.keyFamilies.length > RESOURCE_LIMIT) throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  const protection = [
    ...(config.blacklist?.tables ?? []),
    ...(config.redis?.mask ?? []).map(({ keyPattern }) => keyPattern),
  ]
  const families = raw.keyFamilies
    .map((family) => parseRedisFamily(family, blockedTerms, protection))
    .sort((a, b) => codePointOrder(a.name, b.name))
  unique(
    families.map(({ name }) => name),
    'INVALID_REDIS_CONTEXT'
  )
  if (families.length === 0) {
    gaps.push({ code: 'REDIS_KEY_FAMILIES_UNAVAILABLE', scope: 'resources' })
  }
  return { kind: 'redis', keyFamilies: families }
}

function parseRedisFamily(raw: unknown, blockedTerms: string[], protection: string[]): RedisFamily {
  if (!record(raw)) throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  exactKeys(
    raw,
    ['name', 'pattern', 'type', 'description', 'aliases', 'fields'],
    'INVALID_REDIS_CONTEXT'
  )
  const name = safeString(raw.name, 'INVALID_REDIS_CONTEXT', blockedTerms, 1, 100)
  if (!/^[a-z][a-z0-9-]{0,99}$/.test(name)) throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  const pattern = safeString(raw.pattern, 'INVALID_REDIS_CONTEXT', blockedTerms, 1, 200)
  // Redis declaration syntax excludes controls before placeholder-to-glob conversion.
  // eslint-disable-next-line no-control-regex
  if (/[\s\\*?[\]\u0000-\u001f\u007f-\u009f]/u.test(pattern)) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  const placeholders = [...pattern.matchAll(/\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g)]
  if (
    placeholders.length === 0 ||
    pattern.replace(/\{[A-Za-z_][A-Za-z0-9_]{0,63}\}/g, '').match(/[{}]/) ||
    new Set(placeholders.map((match) => match[1])).size !== placeholders.length
  ) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  const glob = pattern.replace(/\{[A-Za-z_][A-Za-z0-9_]{0,63}\}/g, '*')
  if (protection.some((protectedGlob) => globsOverlap(glob, protectedGlob))) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  const types = new Set(['string', 'hash', 'list', 'set', 'zset', 'stream'])
  if (typeof raw.type !== 'string' || !types.has(raw.type)) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  const type = raw.type as RedisFamily['type']
  const fieldsRaw = raw.fields ?? []
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length > 100) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  if (fieldsRaw.length > 0 && type !== 'hash' && type !== 'stream') {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  const id = 'redis/key-family/' + encoded(name, 'INVALID_REDIS_CONTEXT')
  const fields = fieldsRaw
    .map((field) => parseRedisField(field, id, blockedTerms))
    .sort((a, b) => codePointOrder(a.name, b.name))
  unique(
    fields.map(({ name: field }) => field),
    'INVALID_REDIS_CONTEXT'
  )
  const description = optionalSafeString(
    raw.description,
    'INVALID_REDIS_CONTEXT',
    blockedTerms,
    1_000
  )
  const aliases = aliasesOf(raw.aliases, 'INVALID_REDIS_CONTEXT', blockedTerms)
  return {
    id,
    name,
    pattern,
    type,
    ...(description ? { description } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    fields,
  }
}

function parseRedisField(raw: unknown, familyId: string, blockedTerms: string[]): RedisField {
  if (!record(raw)) throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  exactKeys(raw, ['name', 'type', 'description', 'aliases'], 'INVALID_REDIS_CONTEXT')
  const name = safeString(raw.name, 'INVALID_REDIS_CONTEXT', blockedTerms, 1, 200)
  const types = new Set(['string', 'number', 'boolean', 'json', 'timestamp', 'binary'])
  if (typeof raw.type !== 'string' || !types.has(raw.type)) {
    throw new ContextV2Error('INVALID_REDIS_CONTEXT')
  }
  const description = optionalSafeString(
    raw.description,
    'INVALID_REDIS_CONTEXT',
    blockedTerms,
    1_000
  )
  const aliases = aliasesOf(raw.aliases, 'INVALID_REDIS_CONTEXT', blockedTerms)
  return {
    id: familyId + '/field/' + encoded(name, 'INVALID_REDIS_CONTEXT'),
    name,
    type: raw.type as RedisField['type'],
    ...(description ? { description } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  }
}

async function collectSnippets(
  workspaceRoot: string,
  system: string,
  blockedTerms: string[]
): Promise<ContextSnippet[]> {
  const failures: Error[] = []
  let map: Map<string, ResolvedSnippet[]>
  try {
    map = await loadSnippets({
      ...resolveSnippetDirs(workspaceRoot),
      onError: ({ error }) => failures.push(error),
    })
  } catch {
    throw new ContextV2Error('INVALID_SAVED_QUERY')
  }
  if (failures.length > 0) throw new ContextV2Error('INVALID_SAVED_QUERY')
  const engine = mapSystemToEngine(system)
  const snippets: ContextSnippet[] = []
  for (const [key, variants] of map) {
    const matched =
      variants.find(({ query }) => query.meta.engine?.includes(engine)) ??
      variants.find(({ query }) => !query.meta.engine || query.meta.engine.length === 0)
    if (!matched) continue
    const meta = matched.query.meta
    const description = optionalSafeString(
      meta.description,
      'INVALID_SAVED_QUERY',
      blockedTerms,
      1_000
    )
    const intent = optionalSafeString(meta.intent, 'INVALID_SAVED_QUERY', blockedTerms, 200)
    const engines = meta.engine
      ? meta.engine
          .map((value) => safeString(value, 'INVALID_SAVED_QUERY', blockedTerms, 1, 100))
          .sort(codePointOrder)
      : undefined
    const parameters = meta.params
      .map((parameter) => ({
        name: safeString(parameter.name, 'INVALID_SAVED_QUERY', blockedTerms, 1, 200),
        type: safeString(parameter.type, 'INVALID_SAVED_QUERY', blockedTerms, 1, 100),
        required: parameter.required,
      }))
      .sort((a, b) => codePointOrder(a.name, b.name))
    snippets.push({
      key: safeString(key, 'INVALID_SAVED_QUERY', blockedTerms, 1, 200),
      ...(description ? { description } : {}),
      ...(intent ? { intent } : {}),
      ...(engines ? { engines } : {}),
      parameters,
    })
  }
  return snippets.sort((a, b) => codePointOrder(a.key, b.key))
}

function projectSemantic(
  source: SemanticContext,
  fullResources: ContextV2Payload['resources'],
  emittedIds: Set<string>,
  snippetKeys: Set<string>,
  blockedTerms: string[]
): ContextSemantic {
  const tableIds = resourceNameIds(fullResources)
  const fieldIds = resourceFieldIds(fullResources)
  const models = source.models
    .filter((model) => emittedIds.has(tableIds.get(model.table) ?? ''))
    .map((model) => ({
      reference: safeString(
        'model:' + model.name,
        'INVALID_SEMANTIC_CONTEXT',
        blockedTerms,
        1,
        1_000
      ),
      name: safeString(model.name, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000),
      tableId: tableIds.get(model.table)!,
      ...(model.description
        ? {
            description: safeString(
              model.description,
              'INVALID_SEMANTIC_CONTEXT',
              blockedTerms,
              1,
              1_000
            ),
          }
        : {}),
      aliases: model.aliases
        .map((alias) => safeString(alias, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000))
        .sort(codePointOrder),
      fields: model.fields
        .filter((field) => emittedIds.has(fieldIds.get(model.table + '\\0' + field.column) ?? ''))
        .map((field) => ({
          reference: safeString(
            'field:' + model.name + '.' + field.column,
            'INVALID_SEMANTIC_CONTEXT',
            blockedTerms,
            1,
            1_000
          ),
          name: safeString(field.column, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000),
          fieldId: fieldIds.get(model.table + '\\0' + field.column)!,
          ...(field.description
            ? {
                description: safeString(
                  field.description,
                  'INVALID_SEMANTIC_CONTEXT',
                  blockedTerms,
                  1,
                  1_000
                ),
              }
            : {}),
          aliases: field.aliases
            .map((alias) => safeString(alias, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000))
            .sort(codePointOrder),
        }))
        .sort((a, b) => codePointOrder(a.name, b.name)),
    }))
    .sort((a, b) => codePointOrder(a.name, b.name))
  const fieldReferences = new Set(
    models.flatMap((model) => model.fields.map(({ reference }) => reference))
  )
  const relationships = source.relationships
    .map((relationship) => ({
      reference: 'relationship:' + relationship.name,
      name: relationship.name,
      from: 'field:' + relationship.from.model + '.' + relationship.from.field,
      to: 'field:' + relationship.to.model + '.' + relationship.to.field,
      cardinality: relationship.cardinality,
      ...(relationship.description ? { description: relationship.description } : {}),
    }))
    .filter(({ from, to }) => fieldReferences.has(from) && fieldReferences.has(to))
    .map((relationship) => safeSemanticRecord(relationship, blockedTerms))
    .sort((a, b) => codePointOrder(a.name, b.name))
  const metrics = source.metrics
    .filter((metric) => snippetKeys.has(metric.query))
    .map((metric) =>
      safeSemanticRecord(
        {
          reference: 'metric:' + metric.name,
          name: metric.name,
          query: metric.query,
          ...(metric.description ? { description: metric.description } : {}),
        },
        blockedTerms
      )
    )
    .sort((a, b) => codePointOrder(a.name, b.name))
  return { version: source.version, models, relationships, metrics }
}

function safeSemanticRecord<T extends Record<string, string>>(value: T, blockedTerms: string[]): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      safeString(item, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000),
    ])
  ) as T
}

function projectContract(contract: SemanticContract, blockedTerms: string[]): ContextContract {
  return {
    name: safeString(contract.name, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000),
    description: safeString(
      contract.description,
      'INVALID_SEMANTIC_CONTEXT',
      blockedTerms,
      1,
      1_000
    ),
    subjects: contract.subjects
      .map((subject) => safeString(subject, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000))
      .sort(codePointOrder),
    owner: safeString(contract.owner, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000),
    aliases: contract.aliases
      .map((alias) => safeString(alias, 'INVALID_SEMANTIC_CONTEXT', blockedTerms, 1, 1_000))
      .sort(codePointOrder),
    evidencePolicy: safeString(
      contract.evidencePolicy,
      'INVALID_SEMANTIC_CONTEXT',
      blockedTerms,
      1,
      1_000
    ),
  }
}

function projectDataAccess(
  operation: DataAccessOperation,
  blockedTerms: string[]
): ContextDataAccess {
  return {
    name: safeString(operation.name, 'INVALID_DATA_ACCESS_MANIFEST', blockedTerms, 1, 1_000),
    kind: safeString(operation.kind, 'INVALID_DATA_ACCESS_MANIFEST', blockedTerms, 1, 100),
    semanticReferences: operation.references
      .map((reference) =>
        safeString(reference, 'INVALID_DATA_ACCESS_MANIFEST', blockedTerms, 1, 1_000)
      )
      .sort(codePointOrder),
    coverage: 'declared',
  }
}

function limitResources(resources: ContextV2Payload['resources']): ContextV2Payload['resources'] {
  let remaining = FIELD_LIMIT
  if (resources.kind === 'sql') {
    const tables = resources.tables.slice(0, RESOURCE_LIMIT).map((table) => {
      const columns = table.columns.slice(0, remaining)
      remaining -= columns.length
      return { ...table, columns }
    })
    const ids = new Set(tables.flatMap((table) => table.columns.map(({ id }) => id)))
    return {
      kind: 'sql',
      tables: tables.map((table) => ({
        ...table,
        relationships: table.relationships.filter(
          (relationship) =>
            relationship.columns.every((id) => ids.has(id)) &&
            relationship.referencedColumns.every((id) => ids.has(id))
        ),
      })),
    }
  }
  if (resources.kind === 'elasticsearch') {
    return {
      kind: 'elasticsearch',
      indices: resources.indices.slice(0, RESOURCE_LIMIT).map((index) => {
        const fields = index.fields.slice(0, remaining)
        remaining -= fields.length
        return { ...index, fields }
      }),
    }
  }
  return {
    kind: 'redis',
    keyFamilies: resources.keyFamilies.slice(0, RESOURCE_LIMIT).map((family) => {
      const fields = family.fields.slice(0, remaining)
      remaining -= fields.length
      return { ...family, fields }
    }),
  }
}

function countResources(resources: ContextV2Payload['resources']): {
  resources: number
  fields: number
} {
  if (resources.kind === 'sql') {
    return {
      resources: resources.tables.length,
      fields: resources.tables.reduce((sum, table) => sum + table.columns.length, 0),
    }
  }
  if (resources.kind === 'elasticsearch') {
    return {
      resources: resources.indices.length,
      fields: resources.indices.reduce((sum, index) => sum + index.fields.length, 0),
    }
  }
  return {
    resources: resources.keyFamilies.length,
    fields: resources.keyFamilies.reduce((sum, family) => sum + family.fields.length, 0),
  }
}

function semanticSchema(
  resources: ContextV2Payload['resources']
): Record<string, { columns: Array<{ name: string }> }> {
  if (resources.kind === 'sql') {
    return Object.fromEntries(
      resources.tables.map((table) => [
        table.name,
        { columns: table.columns.map(({ name }) => ({ name })) },
      ])
    )
  }
  if (resources.kind === 'elasticsearch') {
    return Object.fromEntries(
      resources.indices.map((index) => [
        index.name,
        { columns: index.fields.map(({ path }) => ({ name: path })) },
      ])
    )
  }
  return Object.fromEntries(
    resources.keyFamilies.map((family) => [
      family.name,
      { columns: family.fields.map(({ name }) => ({ name })) },
    ])
  )
}

function resourceNameIds(resources: ContextV2Payload['resources']): Map<string, string> {
  if (resources.kind === 'sql') return new Map(resources.tables.map(({ name, id }) => [name, id]))
  if (resources.kind === 'elasticsearch') {
    return new Map(resources.indices.map(({ name, id }) => [name, id]))
  }
  return new Map(resources.keyFamilies.map(({ name, id }) => [name, id]))
}

function resourceFieldIds(resources: ContextV2Payload['resources']): Map<string, string> {
  if (resources.kind === 'sql') {
    return new Map(
      resources.tables.flatMap((table) =>
        table.columns.map(({ name, id }) => [table.name + '\\0' + name, id] as const)
      )
    )
  }
  if (resources.kind === 'elasticsearch') {
    return new Map(
      resources.indices.flatMap((index) =>
        index.fields.map(({ path, id }) => [index.name + '\\0' + path, id] as const)
      )
    )
  }
  return new Map(
    resources.keyFamilies.flatMap((family) =>
      family.fields.map(({ name, id }) => [family.name + '\\0' + name, id] as const)
    )
  )
}

function emittedResourceIds(resources: ContextV2Payload['resources']): Set<string> {
  const ids = new Set<string>(resourceNameIds(resources).values())
  for (const id of resourceFieldIds(resources).values()) ids.add(id)
  return ids
}

function semanticReferences(semantic: ContextSemantic | undefined): Set<string> {
  if (!semantic) return new Set()
  return new Set([
    ...semantic.models.flatMap((model) => [
      model.reference,
      ...model.fields.map(({ reference }) => reference),
    ]),
    ...semantic.relationships.map(({ reference }) => reference),
    ...semantic.metrics.map(({ reference }) => reference),
  ])
}

function schemaTable(raw: unknown): TableSchema {
  if (!record(raw)) throw new ContextV2Error('INVALID_SCHEMA_CACHE')
  return raw as unknown as TableSchema
}

function schemaColumns(table: TableSchema): TableSchema['columns'] {
  if (!Array.isArray(table.columns)) throw new ContextV2Error('INVALID_SCHEMA_CACHE')
  for (const column of table.columns) {
    if (
      !record(column) ||
      typeof column.name !== 'string' ||
      typeof column.type !== 'string' ||
      typeof column.nullable !== 'boolean'
    ) {
      throw new ContextV2Error('INVALID_SCHEMA_CACHE')
    }
  }
  return table.columns
}

function sqlTableId(name: string, system: string, manager: BlacklistManager): string {
  if (manager.isTableBlacklisted(name)) throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
  return system + '/table/' + encoded(name, 'INVALID_SCHEMA_CACHE')
}

function sqlFieldId(
  name: string,
  column: string,
  system: string,
  manager: BlacklistManager
): string {
  if (manager.isTableBlacklisted(name) || manager.isColumnBlacklisted(name, column)) {
    throw new ContextV2Error('INVALID_RESOURCE_REFERENCE')
  }
  return sqlTableId(name, system, manager) + '/field/' + encoded(column, 'INVALID_SCHEMA_CACHE')
}

function elasticsearchIndexId(name: string): string {
  return 'elasticsearch/index/' + encoded(name, 'INVALID_SCHEMA_CACHE')
}

function requiredString(value: unknown, code: ContextV2ErrorCode, blockedTerms: string[]): string {
  return safeString(value, code, blockedTerms, 1, 1_000)
}

function optionalSafeString(
  value: unknown,
  code: ContextV2ErrorCode,
  blockedTerms: string[],
  max: number
): string | undefined {
  if (value === undefined) return undefined
  return safeString(value, code, blockedTerms, 1, max)
}

function safeString(
  value: unknown,
  code: ContextV2ErrorCode,
  blockedTerms: string[],
  min: number,
  max: number
): string {
  if (typeof value !== 'string') throw new ContextV2Error(code)
  const length = [...value].length
  if (
    length < min ||
    length > max ||
    // Agent-facing metadata is single-line plain text.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) ||
    /--|\/\*|\*\/|\b(password|secret|credential)\b/i.test(value) ||
    containsBlockedOutput(value, blockedTerms)
  ) {
    throw new ContextV2Error(code)
  }
  try {
    encodeURIComponent(value)
  } catch {
    throw new ContextV2Error(code)
  }
  return value
}

function containsBlockedOutput(value: string, blockedTerms: string[]): boolean {
  if (containsBlockedSemanticIdentifier(value, blockedTerms)) return true
  const candidates = [value, ...value.split(/\s+/u), ...value.split(/[^\p{L}\p{N}_-]+/u)].filter(
    Boolean
  )
  return blockedTerms.some(
    (term) =>
      isGlobPattern(term) &&
      (candidates.some((candidate) => globMatches(term, candidate, { caseInsensitive: true })) ||
        (/\s/u.test(term) && globMatches(`*${term}*`, value, { caseInsensitive: true })))
  )
}

async function rejectUnknownConfiguredEngine(configPath: string): Promise<void> {
  try {
    const storagePath = await resolveConfigStoragePath(configPath)
    const stat = await Bun.file(storagePath).stat()
    const filePath = stat?.isDirectory() ? join(storagePath, 'config.json') : storagePath
    const raw = JSON.parse(await Bun.file(filePath).text()) as Record<string, unknown>
    let system: unknown
    if (record(raw.connection)) {
      system = raw.connection.system
    } else if (raw.version === 2 && typeof raw.default === 'string' && record(raw.connections)) {
      const selected = raw.connections[raw.default]
      if (record(selected)) system = selected.system
    }
    if (typeof system === 'string' && !KNOWN_SYSTEMS.has(system)) {
      throw new ContextV2Error('UNSUPPORTED_CONTEXT_ENGINE')
    }
  } catch (error) {
    if (error instanceof ContextV2Error) throw error
  }
}

function aliasesOf(value: unknown, code: ContextV2ErrorCode, blockedTerms: string[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new ContextV2Error(code)
  const aliases = value
    .map((alias) => safeString(alias, code, blockedTerms, 1, 100))
    .sort(codePointOrder)
  unique(aliases, code)
  return aliases
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  code: ContextV2ErrorCode
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new ContextV2Error(code)
}

function stringArray(value: unknown, code: ContextV2ErrorCode): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ContextV2Error(code)
  }
  return value
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ContextV2Error('INVALID_SCHEMA_CACHE')
  return value
}

function unique(values: string[], code: ContextV2ErrorCode): void {
  if (new Set(values).size !== values.length) throw new ContextV2Error(code)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function encoded(value: string, code: ContextV2ErrorCode): string {
  try {
    return encodeURIComponent(value)
  } catch {
    throw new ContextV2Error(code)
  }
}

function sortedRecord(input: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => codePointOrder(left, right))
      .map(([key, values]) => [key, [...values].sort(codePointOrder)])
  )
}

function count(emitted: number, total: number): ContextCount {
  return { emitted, omitted: Math.max(0, total - emitted) }
}

function compareGap(a: ContextGap, b: ContextGap): number {
  return codePointOrder(a.code, b.code) || codePointOrder(a.scope, b.scope)
}

export function codePointOrder(left: string, right: string): number {
  const a = [...left]
  const b = [...right]
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return a.length - b.length
}
