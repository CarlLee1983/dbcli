import type { GuideStep } from '@/core/guide/types'

/** Stable contract version for RecoveryEnvelope JSON. Bump on breaking shape change. */
export const RECOVERY_SCHEMA_VERSION = 1 as const

/**
 * Fixed list of v1.15.0 recovery codes. Order is documentation order; agents
 * are expected to switch on these values, so additions go to the end and only
 * via a schemaVersion bump.
 */
export const RECOVERY_CODES = [
  'CONFIG_MISSING',
  'CONN_REFUSED',
  'CONN_AUTH_FAILED',
  'CONN_TIMEOUT',
  'CONN_HOST_NOT_FOUND',
  'CONN_UNKNOWN',
  'PERMISSION_DENIED',
  'BLACKLIST_TABLE',
  'BLACKLIST_COLUMN_WRITE',
  'SNIPPET_NOT_FOUND',
  'SNIPPET_AMBIGUOUS',
  'SNIPPET_PARAM_MISSING',
  'SCHEMA_CACHE_MISSING',
  'UNKNOWN',
] as const
export type RecoveryCode = (typeof RECOVERY_CODES)[number]

export type RecoveryCategory =
  | 'config'
  | 'connection'
  | 'permission'
  | 'blacklist'
  | 'snippet'
  | 'schema-cache'
  | 'unknown'

/** Static metadata about each code: human label, category, one-line description. */
export interface RecoveryCodeMetadata {
  code: RecoveryCode
  category: RecoveryCategory
  description: string
}

export interface RecoveryError {
  /** Stable code from RECOVERY_CODES. */
  code: RecoveryCode
  category: RecoveryCategory
  /** User-safe message; never includes hostnames, ports, or secrets. */
  message: string
  /**
   * Bounded set of structured details for agents. Allowed keys are intentionally
   * limited so the envelope shape stays predictable across versions.
   */
  details?: {
    table?: string
    columns?: string
    requiredPermission?: string
    connectionCode?: string
    snippet?: string
    intent?: string
    paramName?: string
  }
}

export interface RecoveryEnvelope {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION
  /** ISO-8601 UTC timestamp at envelope construction. */
  generatedAt: string
  /** Always `false` — the envelope is only emitted on failure. Reserved for future success-shape symmetry. */
  ok: false
  error: RecoveryError
  /** Ordered, deterministic recovery plan. Capped by `MAX_RECOVERY_STEPS` (6). */
  recovery: GuideStep[]
}

/**
 * Read-only context the classifier needs to decorate the envelope.
 * Pure data; no I/O. Built by the participating command before calling classify.
 */
export interface RecoveryContext {
  /** Operation that failed, e.g. "query" / "q" / "schema". Used in messages, not in the code. */
  operation: string
  /** Connected system if known, otherwise null. */
  system?: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'elasticsearch' | null
  /** Active connection name when v2 multi-connection is in use; otherwise undefined. */
  connectionName?: string
  /** Optional snippet name the operation was attempting (for snippet errors). */
  snippet?: string
  /** Optional table the operation was attempting (for blacklist / schema-cache errors). */
  table?: string
  /** Free-form hint surfaced to the agent — bound into placeholder steps when present. */
  hint?: string
  /**
   * Set by `insert` / `update` / `delete` so the step library can suggest a
   * `--dry-run` re-run on BLACKLIST_COLUMN_WRITE / PERMISSION_DENIED. Other
   * commands omit this field; classifier preserves it via spread without
   * inspecting it.
   */
  writeOperation?: 'INSERT' | 'UPDATE' | 'DELETE'
}

/**
 * Sentinel error thrown when a caller needs a cached table schema but the
 * schema cache is unavailable. Distinct from ConnectionError so the classifier
 * can route it to SCHEMA_CACHE_MISSING without false positives on real
 * network failures.
 */
export class SchemaCacheMissingError extends Error {
  constructor(
    message: string,
    public readonly table?: string
  ) {
    super(message)
    this.name = 'SchemaCacheMissingError'
    Object.setPrototypeOf(this, SchemaCacheMissingError.prototype)
  }
}

export interface RecoveryRenderOptions {
  /** Drop `rationale` and `expects` from steps for compact output. */
  brief?: boolean
}

/**
 * Static metadata for every code. Single source of truth for `--list` views,
 * classifier descriptions, and human Markdown.
 */
export const RECOVERY_CODE_METADATA: Record<RecoveryCode, RecoveryCodeMetadata> = {
  CONFIG_MISSING: {
    code: 'CONFIG_MISSING',
    category: 'config',
    description: 'No dbcli config found in the workspace; run `dbcli init`.',
  },
  CONN_REFUSED: {
    code: 'CONN_REFUSED',
    category: 'connection',
    description: 'Database refused the connection (server down or wrong host/port).',
  },
  CONN_AUTH_FAILED: {
    code: 'CONN_AUTH_FAILED',
    category: 'connection',
    description: 'Database rejected credentials (wrong user/password or role).',
  },
  CONN_TIMEOUT: {
    code: 'CONN_TIMEOUT',
    category: 'connection',
    description: 'Connection attempt timed out (network slow or blocked).',
  },
  CONN_HOST_NOT_FOUND: {
    code: 'CONN_HOST_NOT_FOUND',
    category: 'connection',
    description: 'Hostname could not be resolved (typo or DNS unavailable).',
  },
  CONN_UNKNOWN: {
    code: 'CONN_UNKNOWN',
    category: 'connection',
    description: 'Generic connection failure with no specific category.',
  },
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    category: 'permission',
    description: 'Active permission level forbids the requested operation.',
  },
  BLACKLIST_TABLE: {
    code: 'BLACKLIST_TABLE',
    category: 'blacklist',
    description: 'Target table is blacklisted for this operation.',
  },
  BLACKLIST_COLUMN_WRITE: {
    code: 'BLACKLIST_COLUMN_WRITE',
    category: 'blacklist',
    description: 'Write would touch blacklisted columns.',
  },
  SNIPPET_NOT_FOUND: {
    code: 'SNIPPET_NOT_FOUND',
    category: 'snippet',
    description: 'Saved-query snippet name is unknown in the current workspace.',
  },
  SNIPPET_AMBIGUOUS: {
    code: 'SNIPPET_AMBIGUOUS',
    category: 'snippet',
    description: 'Saved-query name matches more than one variant; pick a more specific key.',
  },
  SNIPPET_PARAM_MISSING: {
    code: 'SNIPPET_PARAM_MISSING',
    category: 'snippet',
    description: 'Saved-query requires a parameter that was not supplied.',
  },
  SCHEMA_CACHE_MISSING: {
    code: 'SCHEMA_CACHE_MISSING',
    category: 'schema-cache',
    description:
      'Local schema cache is missing or empty; refresh before relying on cached metadata.',
  },
  UNKNOWN: {
    code: 'UNKNOWN',
    category: 'unknown',
    description: 'Failure could not be classified into a known category.',
  },
}
