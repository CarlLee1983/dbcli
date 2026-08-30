/**
 * Test config builders — produce valid DbcliConfig / DbcliConfigV2 with sensible defaults
 * so individual tests don't have to repeat blacklist/schemas/metadata boilerplate.
 */

import type { DbcliConfig } from '@/utils/validation'

type ConnectionInput = Partial<DbcliConfig['connection']>
type ConfigOverrides = Partial<Omit<DbcliConfig, 'connection'>> & {
  connection?: ConnectionInput
}

const DEFAULT_PG_CONNECTION: DbcliConfig['connection'] = {
  system: 'postgresql',
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'test',
}

export function makeTestConfig(overrides: ConfigOverrides = {}): DbcliConfig {
  const { connection: connOverride, ...rest } = overrides
  // Spreading the partial overrides last is what callers expect, and it is also
  // what makes the literal stop matching `DbcliConfig`: every key the partial
  // mentions comes back optional. Building the complete value first and merging
  // into it keeps the required keys required.
  const base: DbcliConfig = {
    connection: { ...DEFAULT_PG_CONNECTION, ...connOverride } as DbcliConfig['connection'],
    permission: 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    audit: { strict: false, enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  }
  return { ...base, ...rest }
}

export function makeTestV2Config(
  overrides: { default?: string; connections?: Record<string, unknown>; [k: string]: unknown } = {}
): Record<string, unknown> {
  return {
    version: 2,
    default: 'primary',
    connections: {
      primary: {
        ...DEFAULT_PG_CONNECTION,
        permission: 'query-only',
      },
    },
    schema: {},
    schemas: {},
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    ...overrides,
  }
}
