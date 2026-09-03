/**
 * Dashboard provenance (DBCLI-006)
 *
 * A standalone dashboard travels away from dbcli, the database, and the
 * workspace that produced it. Provenance is the *closed* set of facts a
 * recipient may see about that execution: which logical connection and engine,
 * which saved query and where it came from, what permission actually governed
 * it, and what row cap actually applied.
 *
 * Everything else — query bodies, parameter values, credentials, endpoints,
 * file paths, undisplayed rows — is outside the contract by construction:
 * the validator rejects unknown fields rather than passing them through.
 */

/** Only version `1` exists; a payload without it is rejected, never assumed. */
export const DASHBOARD_PROVENANCE_VERSION = 1 as const

/** Encoded provenance must stay small enough to read, not to carry a transcript. */
export const MAX_PROVENANCE_BYTES = 4 * 1024
/** `connection.name` / `savedQuery.key` upper bound, in UTF-8 bytes. */
export const MAX_IDENTITY_BYTES = 512

export const PROVENANCE_SYSTEMS = [
  'postgresql',
  'mysql',
  'mariadb',
  'mongodb',
  'redis',
  'elasticsearch',
] as const
export const PROVENANCE_SOURCES = ['builtin', 'shared', 'local'] as const
export const PROVENANCE_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

export type ProvenanceSystem = (typeof PROVENANCE_SYSTEMS)[number]
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number]
export type ProvenancePermission = (typeof PROVENANCE_PERMISSIONS)[number]

/**
 * `applied` carries the cap that actually governed the execution; `not-applied`
 * says no cap governed it. The two states are distinguishable on purpose — a
 * dashboard that cannot tell them apart cannot tell a complete result from a
 * silently capped one.
 */
export type ProvenanceLimit =
  | { state: 'applied'; limitApplied: number; truncated: boolean }
  | { state: 'not-applied'; truncated: false }

export interface DashboardProvenance {
  version: typeof DASHBOARD_PROVENANCE_VERSION
  connection: { name: string; system: ProvenanceSystem }
  savedQuery: { key: string; source: ProvenanceSource }
  permission: ProvenancePermission
  limit: ProvenanceLimit
}

export class DashboardProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardProvenanceError'
    Object.setPrototypeOf(this, DashboardProvenanceError.prototype)
  }
}

function fail(message: string): never {
  throw new DashboardProvenanceError(message)
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`Dashboard provenance ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string
): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    fail(`Dashboard provenance ${path} has unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

function boundedIdentity(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`Dashboard provenance ${path} must be a non-empty string`)
  }
  if (utf8ByteLength(value) > MAX_IDENTITY_BYTES) {
    fail(`Dashboard provenance ${path} exceeds ${MAX_IDENTITY_BYTES} UTF-8 bytes`)
  }
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`Dashboard provenance ${path} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function validateLimit(raw: unknown): ProvenanceLimit {
  const limit = asObject(raw, 'limit')
  const state = limit.state
  if (state === 'applied') {
    rejectUnknownKeys(limit, ['state', 'limitApplied', 'truncated'], 'limit')
    const limitApplied = limit.limitApplied
    if (typeof limitApplied !== 'number' || !Number.isInteger(limitApplied) || limitApplied <= 0) {
      fail('Dashboard provenance limit.limitApplied must be a positive integer')
    }
    if (typeof limit.truncated !== 'boolean') {
      fail('Dashboard provenance limit.truncated must be a boolean')
    }
    return { state: 'applied', limitApplied, truncated: limit.truncated }
  }
  if (state === 'not-applied') {
    rejectUnknownKeys(limit, ['state', 'truncated'], 'limit')
    if (limit.truncated !== false) {
      fail('Dashboard provenance limit.truncated must be false when no limit was applied')
    }
    return { state: 'not-applied', truncated: false }
  }
  fail('Dashboard provenance limit.state must be one of: applied, not-applied')
}

/**
 * Validate an untrusted provenance object into the closed version `1` shape.
 * Throws before any HTML is written; nothing here is inferred or defaulted.
 */
export function validateDashboardProvenance(input: unknown): DashboardProvenance {
  const raw = asObject(input, 'payload')
  rejectUnknownKeys(raw, ['version', 'connection', 'savedQuery', 'permission', 'limit'], 'payload')

  if (raw.version !== DASHBOARD_PROVENANCE_VERSION) {
    fail(`Dashboard provenance version must be ${DASHBOARD_PROVENANCE_VERSION}`)
  }

  const connection = asObject(raw.connection, 'connection')
  rejectUnknownKeys(connection, ['name', 'system'], 'connection')
  const savedQuery = asObject(raw.savedQuery, 'savedQuery')
  rejectUnknownKeys(savedQuery, ['key', 'source'], 'savedQuery')

  const provenance: DashboardProvenance = {
    version: DASHBOARD_PROVENANCE_VERSION,
    connection: {
      name: boundedIdentity(connection.name, 'connection.name'),
      system: oneOf(connection.system, PROVENANCE_SYSTEMS, 'connection.system'),
    },
    savedQuery: {
      key: boundedIdentity(savedQuery.key, 'savedQuery.key'),
      source: oneOf(savedQuery.source, PROVENANCE_SOURCES, 'savedQuery.source'),
    },
    permission: oneOf(raw.permission, PROVENANCE_PERMISSIONS, 'permission'),
    limit: validateLimit(raw.limit),
  }

  const encodedBytes = utf8ByteLength(JSON.stringify(provenance))
  if (encodedBytes > MAX_PROVENANCE_BYTES) {
    fail(
      `Dashboard provenance encodes to ${encodedBytes} bytes, over the ${MAX_PROVENANCE_BYTES} byte limit`
    )
  }

  return provenance
}
