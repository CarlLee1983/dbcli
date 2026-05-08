import { join } from 'node:path'
import { resolveSchemaPath } from '@/utils/schema-path'
import type { SchemaCacheSection, SnapshotSystem } from './types'

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const SQL_SYSTEMS: ReadonlyArray<SnapshotSystem> = ['postgresql', 'mysql', 'mariadb']

export interface CollectSchemaCacheOptions {
  dbcliPath: string
  connectionName?: string
  /** Used to mark non-SQL engines as unavailable. */
  system?: SnapshotSystem | null
}

export interface SchemaCacheCollectResult {
  section: SchemaCacheSection
  warnings: string[]
}

export async function collectSchemaCache(
  opts: CollectSchemaCacheOptions
): Promise<SchemaCacheCollectResult> {
  const warnings: string[] = []
  if (opts.system && !SQL_SYSTEMS.includes(opts.system)) {
    return {
      section: { available: false, unavailable: true, reason: 'schema cache is sql-only' },
      warnings,
    }
  }

  const root = resolveSchemaPath(opts.dbcliPath, opts.connectionName)
  const indexPath = join(root, 'index.json')
  const file = Bun.file(indexPath)
  if (!(await file.exists())) {
    return { section: { available: false }, warnings }
  }

  try {
    const idx = (await file.json()) as {
      metadata?: { lastRefreshed?: string; totalTables?: number }
    }
    const lastRefreshed = idx.metadata?.lastRefreshed
    const totalTables = idx.metadata?.totalTables
    const stale = lastRefreshed
      ? Date.now() - new Date(lastRefreshed).getTime() > STALE_AFTER_MS
      : true
    return {
      section: {
        available: true,
        stale,
        ...(lastRefreshed ? { lastRefreshed } : {}),
        ...(typeof totalTables === 'number' ? { totalTables } : {}),
      },
      warnings,
    }
  } catch (err) {
    warnings.push(`schemaCache: ${(err as Error).message}`)
    return {
      section: { available: false, unavailable: true, reason: 'index.json unreadable' },
      warnings,
    }
  }
}
