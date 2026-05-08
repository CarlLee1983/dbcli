import type { DatabaseAdapter } from '@/adapters/types'
import type { ObjectsSection, SnapshotSystem } from './types'

const SAMPLE_SIZE = 10

export interface CollectObjectsOptions {
  system: SnapshotSystem
  adapter: DatabaseAdapter
  brief?: boolean
}

export interface ObjectsCollectResult {
  section: ObjectsSection
  warnings: string[]
}

export async function collectObjects(
  opts: CollectObjectsOptions
): Promise<ObjectsCollectResult> {
  const warnings: string[] = []
  const kind = pickKind(opts.system)
  const isSql =
    opts.system === 'postgresql' || opts.system === 'mysql' || opts.system === 'mariadb'
  if (!isSql) {
    return {
      section: {
        kind,
        unavailable: true,
        reason: `${opts.system} object listing not in v1.12.0 scope`,
      },
      warnings,
    }
  }
  try {
    const tables = await opts.adapter.listTables()
    const names = tables.map((t) => t.name)
    return {
      section: {
        kind,
        count: names.length,
        ...(opts.brief ? {} : { sample: names.slice(0, SAMPLE_SIZE) }),
      },
      warnings,
    }
  } catch (err) {
    warnings.push(`objects: ${(err as Error).message}`)
    return { section: { kind, unavailable: true, reason: 'listTables failed' }, warnings }
  }
}

function pickKind(system: SnapshotSystem): ObjectsSection['kind'] {
  switch (system) {
    case 'mongodb':
      return 'collections'
    case 'redis':
      return 'keys'
    case 'elasticsearch':
      return 'indices'
    default:
      return 'tables'
  }
}
