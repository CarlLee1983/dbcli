import { join } from 'node:path'
import { configModule } from '@/core/config'
import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import type { DbcliConfig } from '@/types'
import { collectConnection } from './collect-connection'
import { collectPermission } from './collect-permission'
import { collectBlacklist } from './collect-blacklist'
import { collectSnippets } from './collect-snippets'
import { collectSchemaCache } from './collect-schema-cache'
import { collectObjects, type ObjectsCollectResult } from './collect-objects'
import { collectVersion } from './collect-version'
import { suggestCommands } from './suggest-commands'
import {
  INSPECT_SCHEMA_VERSION,
  type InspectOptions,
  type InspectSnapshot,
  type SnapshotSystem,
} from './types'

const DEFAULT_PROBE_MS = 1500

export async function collectInspect(opts: InspectOptions): Promise<InspectSnapshot> {
  const warnings: string[] = []

  // 1. Config — never throws. Treat "no config file present" as no-config rather
  //    than letting the read fall back to a default postgres shape.
  let config: DbcliConfig | null = null
  if (await hasConfig(opts.configPath)) {
    try {
      config = await configModule.read(opts.configPath)
    } catch (err) {
      warnings.push(`config: ${(err as Error).message}`)
    }
  }

  const conn = collectConnection(config)
  const system = conn.system
  const permission = collectPermission(config?.permission ?? 'query-only')
  const blacklist = collectBlacklist(config?.blacklist)

  // 2. Snippets (workspace-only, no network)
  const snippets = await collectSnippets({
    workspace: opts.workspace,
    topIntents: opts.brief ? 3 : 5,
  })
  warnings.push(...snippets.warnings)

  // 3. Schema cache (filesystem-only, no network)
  const sc = await collectSchemaCache({ dbcliPath: opts.configPath, system })
  warnings.push(...sc.warnings)

  // 4. Network-touching: objects + version
  let objects: ObjectsCollectResult = {
    section: defaultObjectsForSystem(system),
    warnings: [],
  }
  let version: string | null = null

  if (!opts.noConnect && config?.connection && system) {
    try {
      const adapter = AdapterFactory.createAdapter(config.connection as ConnectionOptions)
      try {
        await adapter.connect()
        const probeTimeout = opts.probeTimeoutMs ?? DEFAULT_PROBE_MS
        version = await collectVersion(adapter, probeTimeout)
        objects = await collectObjects({ system, adapter, brief: opts.brief })
        warnings.push(...objects.warnings)
      } finally {
        try {
          await adapter.disconnect()
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      warnings.push(`connect: ${(err as Error).message}`)
    }
  } else if (opts.noConnect) {
    objects = {
      section: {
        ...defaultObjectsForSystem(system),
        unavailable: true,
        reason: 'no-connect mode',
      },
      warnings: [],
    }
  }

  // 5. Build snapshot before suggestions so suggestions can read it
  const snapWithoutSuggestions = {
    schemaVersion: INSPECT_SCHEMA_VERSION,
    system,
    connection: { ...conn.section, version },
    permission,
    blacklist,
    objects: objects.section,
    schemaCache: sc.section,
    snippets: snippets.section,
  }
  const suggestedCommands = suggestCommands(snapWithoutSuggestions, { brief: opts.brief })

  return { ...snapWithoutSuggestions, suggestedCommands, warnings }
}

async function hasConfig(configPath: string): Promise<boolean> {
  // Directory mode: <configPath>/config.json
  // File mode: <configPath> itself is the legacy single-file config
  if (await Bun.file(join(configPath, 'config.json')).exists()) return true
  if (await Bun.file(configPath).exists()) {
    const stat = await Bun.file(configPath).stat().catch(() => null)
    return stat?.isFile() === true
  }
  return false
}

function defaultObjectsForSystem(system: SnapshotSystem | null) {
  if (!system)
    return { kind: 'tables' as const, unavailable: true as const, reason: 'no system' }
  switch (system) {
    case 'mongodb':
      return { kind: 'collections' as const, unavailable: true as const, reason: 'not connected' }
    case 'redis':
      return { kind: 'keys' as const, unavailable: true as const, reason: 'not connected' }
    case 'elasticsearch':
      return { kind: 'indices' as const, unavailable: true as const, reason: 'not connected' }
    default:
      return { kind: 'tables' as const, unavailable: true as const, reason: 'not connected' }
  }
}
