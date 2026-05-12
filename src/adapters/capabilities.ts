import type { DatabaseSystem } from './types'

export type CapabilityStatus = 'supported' | 'limited' | 'unsupported' | 'not-applicable'

export type SideEffectTier =
  | 'readonly'
  | 'dry-run'
  | 'local-write'
  | 'db-write'
  | 'interactive'
  | 'none'

export type CommandCapabilityKey =
  | 'init'
  | 'use'
  | 'list'
  | 'schemaSingle'
  | 'schemaFullScan'
  | 'query'
  | 'queryOutput'
  | 'queryLimitGuard'
  | 'q'
  | 'queries'
  | 'insert'
  | 'update'
  | 'delete'
  | 'export'
  | 'blacklist'
  | 'check'
  | 'diff'
  | 'migrate'
  | 'shell'
  | 'status'
  | 'doctor'
  | 'inspect'
  | 'report'
  | 'guide'
  | 'completion'
  | 'upgrade'
  | 'recover'
  | 'skill'

export interface CommandCapability {
  status: CapabilityStatus
  tier: SideEffectTier
  note: string
}

export type EngineCapabilities = Readonly<Record<CommandCapabilityKey, Readonly<CommandCapability>>>

export const COMMAND_CAPABILITY_KEYS = Object.freeze([
  'init',
  'use',
  'list',
  'schemaSingle',
  'schemaFullScan',
  'query',
  'queryOutput',
  'queryLimitGuard',
  'q',
  'queries',
  'insert',
  'update',
  'delete',
  'export',
  'blacklist',
  'check',
  'diff',
  'migrate',
  'shell',
  'status',
  'doctor',
  'inspect',
  'report',
  'guide',
  'completion',
  'upgrade',
  'recover',
  'skill',
] as const satisfies readonly CommandCapabilityKey[])

function cap(
  status: CapabilityStatus,
  tier: SideEffectTier,
  note: string
): Readonly<CommandCapability> {
  return Object.freeze({ status, tier, note })
}

const ENGINE_INDEPENDENT = {
  completion: cap('not-applicable', 'none', 'Shell completion is engine-independent.'),
  upgrade: cap('not-applicable', 'local-write', 'Package update checks are engine-independent.'),
  recover: cap(
    'not-applicable',
    'dry-run',
    'Recovery operates on saved envelopes and gated command steps.'
  ),
  skill: cap(
    'not-applicable',
    'local-write',
    'Skill and task-pack generation are engine-independent.'
  ),
} satisfies Pick<EngineCapabilities, 'completion' | 'upgrade' | 'recover' | 'skill'>

const SQL_BASE = {
  init: cap('supported', 'interactive', 'SQL connection initialization is supported.'),
  use: cap('supported', 'local-write', 'V2 config supports named SQL connections.'),
  list: cap('supported', 'readonly', 'Lists relational tables.'),
  schemaSingle: cap('supported', 'readonly', 'Reads a single table schema.'),
  schemaFullScan: cap('supported', 'readonly', 'Full scan, refresh, and reset are supported.'),
  query: cap('supported', 'readonly', 'Runs SQL through permission and blacklist guards.'),
  queryOutput: cap('supported', 'readonly', 'table/json/csv output is supported.'),
  queryLimitGuard: cap(
    'supported',
    'readonly',
    'Query-only auto-limit and size guard are supported.'
  ),
  q: cap('supported', 'readonly', 'Saved SQL snippets allow SELECT/WITH only.'),
  queries: cap(
    'supported',
    'local-write',
    'Snippet management is available regardless of active connection.'
  ),
  insert: cap('supported', 'db-write', 'Dedicated INSERT command is supported.'),
  update: cap('supported', 'db-write', 'Dedicated UPDATE command is supported.'),
  delete: cap('supported', 'db-write', 'Dedicated DELETE command is supported.'),
  export: cap('supported', 'readonly', 'SQL export is supported.'),
  blacklist: cap('supported', 'local-write', 'Blacklist management and enforcement are supported.'),
  check: cap('supported', 'readonly', 'Data health checks are SQL-only.'),
  diff: cap('supported', 'readonly', 'Relational schema snapshots are supported.'),
  migrate: cap('supported', 'db-write', 'DDL migrations are supported for SQL engines.'),
  shell: cap('supported', 'interactive', 'Interactive SQL shell is supported.'),
  status: cap('supported', 'readonly', 'Safe config summary is supported.'),
  doctor: cap('supported', 'readonly', 'Engine-specific diagnostics are supported.'),
  inspect: cap('supported', 'readonly', 'Agent context snapshot is supported.'),
  report: cap('supported', 'readonly', 'Diagnostic report is supported.'),
  guide: cap('supported', 'readonly', 'Deterministic next-command planner is supported.'),
  ...ENGINE_INDEPENDENT,
} satisfies EngineCapabilities

export const ENGINE_CAPABILITIES: Readonly<Record<DatabaseSystem, EngineCapabilities>> =
  Object.freeze({
    postgresql: Object.freeze({
      ...SQL_BASE,
      check: cap('limited', 'readonly', 'SQL-only and strongest on MySQL/MariaDB.'),
    }),
    mysql: Object.freeze(SQL_BASE),
    mariadb: Object.freeze(SQL_BASE),
    mongodb: Object.freeze({
      ...SQL_BASE,
      schemaSingle: cap('limited', 'readonly', 'MongoDB schema is sampled from documents.'),
      schemaFullScan: cap('limited', 'readonly', 'Full scan is sampled and document-oriented.'),
      query: cap('limited', 'readonly', 'Uses JSON filter or aggregation syntax, not SQL.'),
      queryLimitGuard: cap(
        'limited',
        'readonly',
        'Applies result limits and collection size guard.'
      ),
      queries: cap(
        'limited',
        'local-write',
        'Snippet management works, but saved-query execution is not supported for MongoDB.'
      ),
      q: cap('unsupported', 'none', 'MongoDB saved-query execution is not supported.'),
      insert: cap(
        'limited',
        'db-write',
        'Document insert is supported with Mongo-specific behavior.'
      ),
      update: cap(
        'limited',
        'db-write',
        'Document update is supported with Mongo-specific behavior.'
      ),
      delete: cap(
        'limited',
        'db-write',
        'Document delete is supported with Mongo-specific behavior.'
      ),
      export: cap('limited', 'readonly', 'MongoDB export is supported with document-query syntax.'),
      blacklist: cap(
        'limited',
        'local-write',
        'Rule management works; enforcement differs from SQL column enforcement.'
      ),
      check: cap('unsupported', 'none', 'Data health check is SQL-only.'),
      diff: cap('unsupported', 'none', 'Schema snapshots are relational only.'),
      migrate: cap('unsupported', 'none', 'DDL migrations are SQL-only.'),
      shell: cap(
        'limited',
        'interactive',
        'MongoDB shell support is narrower than SQL shell support.'
      ),
    }),
    redis: Object.freeze({
      ...SQL_BASE,
      schemaSingle: cap('limited', 'readonly', 'Per-key synthetic schema only.'),
      schemaFullScan: cap('unsupported', 'none', 'Redis has no full schema cache scan.'),
      query: cap('limited', 'readonly', 'Runs allow-listed Redis commands.'),
      queryLimitGuard: cap(
        'unsupported',
        'none',
        'Redis has command-specific guards, not generic LIMIT rewriting.'
      ),
      q: cap(
        'limited',
        'readonly',
        'Saved Redis snippets use a read-only allowlist and range guards.'
      ),
      queries: cap(
        'limited',
        'local-write',
        'Snippet management works with Redis-specific saved-query limitations.'
      ),
      insert: cap('unsupported', 'none', 'Dedicated write subcommand is not exposed.'),
      update: cap('unsupported', 'none', 'Dedicated write subcommand is not exposed.'),
      delete: cap('unsupported', 'none', 'Dedicated write subcommand is not exposed.'),
      export: cap('unsupported', 'none', 'Redis export is not supported.'),
      blacklist: cap(
        'unsupported',
        'none',
        'Redis key/value blacklist enforcement is not supported.'
      ),
      check: cap('unsupported', 'none', 'Data health check is SQL-only.'),
      diff: cap('unsupported', 'none', 'Schema snapshots are relational only.'),
      migrate: cap('unsupported', 'none', 'DDL migrations are SQL-only.'),
      shell: cap('unsupported', 'none', 'Redis REPL is not supported.'),
    }),
    elasticsearch: Object.freeze({
      ...SQL_BASE,
      schemaSingle: cap('limited', 'readonly', 'Schema flattens index mappings.'),
      schemaFullScan: cap('supported', 'readonly', 'Full scan iterates non-system indices.'),
      query: cap('limited', 'readonly', 'Uses JSON DSL or Lucene query strings with an index.'),
      queryLimitGuard: cap('limited', 'readonly', 'Applies Elasticsearch size guard.'),
      q: cap(
        'limited',
        'readonly',
        'Saved ES snippets require index frontmatter and reject scripts.'
      ),
      queries: cap(
        'limited',
        'local-write',
        'Snippet management works with Elasticsearch-specific saved-query limitations.'
      ),
      insert: cap('unsupported', 'none', 'Dedicated write subcommand is not exposed.'),
      update: cap('unsupported', 'none', 'Dedicated write subcommand is not exposed.'),
      delete: cap('unsupported', 'none', 'Dedicated write subcommand is not exposed.'),
      export: cap('unsupported', 'none', 'Elasticsearch export is not supported.'),
      blacklist: cap(
        'limited',
        'local-write',
        'Index-level and flattened-column enforcement differ from SQL.'
      ),
      check: cap('unsupported', 'none', 'Data health check is SQL-only.'),
      diff: cap('unsupported', 'none', 'Schema snapshots are relational only.'),
      migrate: cap('unsupported', 'none', 'DDL migrations are SQL-only.'),
      shell: cap('unsupported', 'none', 'Elasticsearch REPL is not supported.'),
    }),
  })

export function getEngineCapabilities(system: DatabaseSystem): EngineCapabilities {
  return Object.freeze({ ...ENGINE_CAPABILITIES[system] })
}

export function getEngineCapability(
  system: DatabaseSystem,
  key: CommandCapabilityKey
): Readonly<CommandCapability> {
  return ENGINE_CAPABILITIES[system][key]
}

export function supportsCapability(system: DatabaseSystem, key: CommandCapabilityKey): boolean {
  return getEngineCapability(system, key).status === 'supported'
}
