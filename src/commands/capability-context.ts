import { join } from 'node:path'
import { DATABASE_SYSTEMS, type DatabaseSystem } from '@/adapters/types'
import { configModule } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import type { CapabilityCheckContext, CapabilityContextFailure } from '@/core/capabilities'
import { ConfigError } from '@/utils/errors'

const MAX_CONNECTION_LABEL = 200

function isDatabaseSystem(value: unknown): value is DatabaseSystem {
  return typeof value === 'string' && (DATABASE_SYSTEMS as readonly string[]).includes(value)
}

function truncateLabel(name: string | undefined): string | null {
  if (!name) return null
  return name.length <= MAX_CONNECTION_LABEL ? name : `${name.slice(0, MAX_CONNECTION_LABEL)}…`
}

async function configExists(configPath: string): Promise<boolean> {
  const storagePath = await resolveConfigStoragePath(configPath)
  if (await Bun.file(join(storagePath, 'config.json')).exists()) return true
  return Bun.file(configPath).exists()
}

export interface ResolvedCapabilityContext {
  readonly context: CapabilityCheckContext | null
  readonly failure: CapabilityContextFailure
}

/** Resolve only the local configuration needed for an offline capability check. */
export async function resolveCapabilityContext(
  configPath: string
): Promise<ResolvedCapabilityContext> {
  if (!(await configExists(configPath))) return { context: null, failure: 'absent' }
  try {
    const config = await configModule.read(configPath, undefined, { loadLayeredSchema: false })
    if (!isDatabaseSystem(config.connection?.system))
      return { context: null, failure: 'unresolvable' }
    return {
      context: {
        engine: config.connection.system,
        permission: config.permission,
        connectionName: truncateLabel(config.effectiveConnectionName),
        agentMode: process.env.DBCLI_AGENT_MODE === '1',
      },
      failure: 'absent',
    }
  } catch (error) {
    if (error instanceof ConfigError) return { context: null, failure: 'unresolvable' }
    throw error
  }
}
