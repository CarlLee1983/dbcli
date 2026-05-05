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
  return {
    connection: { ...DEFAULT_PG_CONNECTION, ...connOverride } as DbcliConfig['connection'],
    permission: 'query-only',
    schema: {},
    metadata: { version: '1.0' },
    blacklist: { tables: [], columns: {} },
    ...rest,
  }
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
