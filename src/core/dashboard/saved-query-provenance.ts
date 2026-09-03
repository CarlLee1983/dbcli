import type { AppliedLimitMetadata } from '../../types/query'
import { getGlobalConnectionName } from '../config'
import {
  DASHBOARD_PROVENANCE_VERSION,
  validateDashboardProvenance,
  type DashboardProvenance,
} from './provenance'

export interface SavedQueryProvenanceInput {
  /** Logical connection name — the v2 connection key, or `default` for v1. */
  connectionName: string
  system: string
  savedQueryKey: string
  savedQuerySource: string
  permission: string
  /** Present only when a row cap actually governed this execution. */
  appliedLimit?: AppliedLimitMetadata
}

/**
 * Assemble provenance from what actually governed the execution. Every field
 * is validated here, so a missing or unexpected value fails before HTML is
 * written instead of being filled in with a plausible guess.
 */
export function buildSavedQueryProvenance(input: SavedQueryProvenanceInput): DashboardProvenance {
  return validateDashboardProvenance({
    version: DASHBOARD_PROVENANCE_VERSION,
    connection: { name: input.connectionName, system: input.system },
    savedQuery: { key: input.savedQueryKey, source: input.savedQuerySource },
    permission: input.permission,
    limit: input.appliedLimit
      ? {
          state: 'applied',
          limitApplied: input.appliedLimit.limitApplied,
          truncated: input.appliedLimit.truncated,
        }
      : { state: 'not-applied', truncated: false },
  })
}

/**
 * The logical name of the connection this execution ran on: the v2 connection
 * key, or `default` for a v1 config, which has exactly one unnamed connection.
 * Never a host, endpoint, or file path.
 */
export function resolveLogicalConnectionName(config: unknown): string {
  const named = (config as { effectiveConnectionName?: string } | null | undefined)
    ?.effectiveConnectionName
  return named || getGlobalConnectionName() || 'default'
}
