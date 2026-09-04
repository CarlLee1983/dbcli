/**
 * The schema cache write seam.
 *
 * A schema cache is derived data. It is re-readable at any time from the
 * database the configuration already points at, and anyone who can run
 * `dbcli schema` can already see everything it holds. It is not connection
 * identity, not a permission level, and not a credential — the three things
 * `assertConfigMutationApproved()` exists to keep an untrusted automation
 * context away from. The cache sat behind that guard for one reason: it is
 * stored inside `config.json`, next to things that are. Storage adjacency, not
 * a shared trust decision.
 *
 * The cost of the conflation was larger than a false capability claim. Storing
 * a cache went through `configModule.write`, which republishes the whole
 * document: measured against a config holding `connection.password` and an
 * existing `.env.local`, one `dbcli schema` deleted the password from
 * `config.json` and overwrote `.env.local` with a regenerated one. That happens
 * outside agent mode as well, where no guard fires — so the defect was never
 * only that the guard was misplaced. It was that a cache update was a
 * whole-config publication wearing a cache's name.
 *
 * This module is that update and nothing else. The narrowness is in the
 * signature: the only things a caller can supply are a schema, a connection
 * slot and two timestamps. There is no parameter through which a credential,
 * a permission or a host could travel, so no flag has to guard it and no caller
 * has to be trusted to be honest about what it is writing. The configuration
 * itself is read here, not handed in.
 *
 * `assertOnlyCacheFieldsChanged` states that same guarantee out loud. It is
 * redundant against today's code by construction, which is the point: an edit
 * that widens what gets written fails in a unit test naming the field, instead
 * of shipping.
 *
 * `assertConfigMutationApproved()` is untouched, and every writer that guards
 * it still does. Under agent mode `dbcli init`, `dbcli use`,
 * `dbcli blacklist add` and the credential commands are refused exactly as
 * before; only the cache moved out from behind it.
 */

import { join } from 'node:path'
import { detectConfigVersion } from '@/core/config-v2'
import {
  assertAgentReadableFile,
  assertConfigIntegrity,
  writeConfigWithIntegrity,
} from '@/core/config-integrity'
import { ConfigError } from '@/utils/errors'

/** A refusal from the cache seam. Never carries a value, only a field name. */
export class SchemaCacheWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaCacheWriteError'
    Object.setPrototypeOf(this, SchemaCacheWriteError.prototype)
  }
}

export interface SchemaCacheWrite {
  /** The resolved `.dbcli` storage directory holding `config.json`. */
  readonly storagePath: string
  /** The v2 connection slot to write, or `undefined` for a v1 config. */
  readonly connectionName?: string
  /** The table map just read from the database. */
  readonly schema: Record<string, unknown>
  /** Absent clears the timestamp, which is how a cache-clearing write reads. */
  readonly schemaLastUpdated?: string
  readonly schemaTableCount: number
}

/** The `metadata` keys that belong to the cache rather than to the document. */
const CACHE_METADATA_KEYS = ['schemaLastUpdated', 'schemaTableCount'] as const

type Document = Record<string, unknown>

const isObject = (value: unknown): value is Document =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Strip the cache fields, so what remains is everything the seam must not move.
 *
 * For a v2 document only the named connection's slot is stripped: writing one
 * connection's cache must not be able to disturb another's, and leaving the
 * other slots in the comparison is what makes that checkable.
 */
function withoutCacheFields(document: Document, connectionName?: string): Document {
  const rest: Document = { ...document }

  if (connectionName === undefined) {
    delete rest.schema
  } else {
    const schemas = isObject(rest.schemas) ? { ...rest.schemas } : {}
    delete schemas[connectionName]
    rest.schemas = schemas
  }

  if (isObject(rest.metadata)) {
    const metadata: Document = { ...rest.metadata }
    for (const key of CACHE_METADATA_KEYS) delete metadata[key]
    rest.metadata = metadata
  }

  return rest
}

/**
 * Refuse a candidate document that differs from disk outside the cache fields.
 *
 * The message names the offending top-level field and never its value: a
 * refusal that quoted the rejected `connection` would print the credential the
 * refusal exists to protect.
 */
export function assertOnlyCacheFieldsChanged(
  before: unknown,
  after: unknown,
  connectionName?: string
): void {
  if (!isObject(before) || !isObject(after)) {
    throw new SchemaCacheWriteError(
      'schema cache write refused: the configuration is not a JSON object'
    )
  }

  const strippedBefore = withoutCacheFields(before, connectionName)
  const strippedAfter = withoutCacheFields(after, connectionName)

  const fields = new Set([...Object.keys(strippedBefore), ...Object.keys(strippedAfter)])
  const changed = [...fields]
    .filter((field) => !Bun.deepEquals(strippedBefore[field], strippedAfter[field], true))
    .sort()

  if (changed.length === 0) return

  throw new SchemaCacheWriteError(
    `schema cache write refused: it would also change ${changed.map((field) => `'${field}'`).join(', ')}, ` +
      'which is not part of the schema cache'
  )
}

/**
 * Where the configuration document lives.
 *
 * Two layouts are live. Directory mode keeps `config.json` inside the storage
 * directory alongside its integrity record; legacy single-file mode is the
 * whole document at the storage path itself, with no record — `configModule`
 * still reads and writes both, so the seam has to as well or `dbcli schema`
 * would start refusing on a layout that works today. Agent mode never reaches
 * the legacy layout: `configModule.read` refuses it outright.
 */
interface ConfigLocation {
  readonly path: string
  readonly directoryMode: boolean
}

async function locateConfig(storagePath: string): Promise<ConfigLocation> {
  let isDirectory = false
  try {
    isDirectory = (await Bun.file(storagePath).stat())?.isDirectory() ?? false
  } catch {
    isDirectory = false
  }

  if (isDirectory) return { path: join(storagePath, 'config.json'), directoryMode: true }
  return { path: storagePath, directoryMode: false }
}

/** Read the configuration the way every other reader does, checks included. */
async function readConfigDocument(
  storagePath: string,
  location: ConfigLocation
): Promise<Document> {
  const file = Bun.file(location.path)

  if (!(await file.exists())) {
    // Deliberately a refusal rather than a create. Writing a configuration that
    // was not there would mean publishing connection details from a cache
    // write, which is the whole thing this module exists not to do.
    throw new ConfigError('No dbcli configuration was found to store the schema cache in.')
  }

  const content = await file.text()
  if (location.directoryMode) {
    await assertAgentReadableFile(location.path)
    await assertConfigIntegrity(storagePath, content, { requireRecord: true })
  }

  const raw: unknown = JSON.parse(content)
  if (!isObject(raw)) {
    throw new ConfigError('The dbcli configuration is not a JSON object.')
  }
  return raw
}

/** Build the candidate document: the one on disk, with the cache replaced. */
function applyCache(current: Document, write: SchemaCacheWrite): Document {
  const metadata: Document = {
    ...(isObject(current.metadata) ? current.metadata : {}),
    schemaTableCount: write.schemaTableCount,
  }
  if (write.schemaLastUpdated === undefined) delete metadata.schemaLastUpdated
  else metadata.schemaLastUpdated = write.schemaLastUpdated

  if (write.connectionName === undefined) {
    return { ...current, schema: write.schema, metadata }
  }

  const connections = isObject(current.connections) ? current.connections : {}
  if (!(write.connectionName in connections)) {
    throw new SchemaCacheWriteError(
      `schema cache write refused: connection '${write.connectionName}' is not in this configuration`
    )
  }

  return {
    ...current,
    schemas: {
      ...(isObject(current.schemas) ? current.schemas : {}),
      [write.connectionName]: write.schema,
    },
    metadata,
  }
}

/**
 * Store a schema cache, and nothing else.
 *
 * The connection slot is taken from the caller, but which shape is on disk is
 * not: a v1 document has no `schemas` map to write into, and a v2 document must
 * not grow a top-level `schema`. Disagreement between the two is refused rather
 * than resolved, because guessing produces a document neither reader accepts.
 */
export async function persistSchemaCache(write: SchemaCacheWrite): Promise<void> {
  const location = await locateConfig(write.storagePath)
  const current = await readConfigDocument(write.storagePath, location)
  const isV2 = detectConfigVersion(current) === 2

  if (isV2 !== (write.connectionName !== undefined)) {
    throw new SchemaCacheWriteError(
      isV2
        ? 'schema cache write refused: this is a multi-connection configuration, so the cache needs a connection name'
        : 'schema cache write refused: this is a single-connection configuration, which has no connection slot to write'
    )
  }

  const candidate = applyCache(current, write)
  assertOnlyCacheFieldsChanged(current, candidate, write.connectionName)

  const json = JSON.stringify(candidate, null, 2)
  if (location.directoryMode) await writeConfigWithIntegrity(write.storagePath, json)
  else await Bun.file(location.path).write(json)
}
