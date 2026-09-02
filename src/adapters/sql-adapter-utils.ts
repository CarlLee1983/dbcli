import type { ConnectionOptions } from './types'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'
import { t_vars } from '@/i18n/message-loader'

export type SqlSystem = 'postgresql' | 'mysql' | 'mariadb'

export function queryOnlyBoundaryError(system: SqlSystem, error: unknown): ConnectionError {
  const detail = error instanceof Error ? error.message : String(error)
  return new ConnectionError(
    'QUERY_ONLY_BOUNDARY_FAILED',
    t_vars('errors.query_only_boundary_failed', { system, detail }),
    [
      t_vars('errors.query_only_boundary_verify', { system }),
      t_vars('errors.query_only_boundary_not_executed', {}),
    ]
  )
}

export function queryOnlyCleanupError(
  system: SqlSystem,
  error: unknown,
  targetCompleted: boolean
): ConnectionError {
  const detail = error instanceof Error ? error.message : String(error)
  return new ConnectionError(
    'CONNECTION_LOST',
    targetCompleted
      ? t_vars('errors.query_only_cleanup_completed', { system, detail })
      : t_vars('errors.query_only_cleanup_uncertain', { system, detail }),
    [
      targetCompleted
        ? t_vars('errors.query_only_cleanup_completed_retry', {})
        : t_vars('errors.query_only_cleanup_uncertain_retry', {}),
      t_vars('errors.query_only_cleanup_reconnect', {}),
    ],
    undefined,
    false
  )
}

/**
 * Return a live driver connection or preserve the shared adapter contract for
 * operations invoked before connect().
 */
export function requireConnected<T>(connection: T | null | undefined): T {
  if (!connection) {
    throw new ConnectionError('UNKNOWN', 'Database connection not established', [
      'Call connect() to establish a connection',
    ])
  }
  return connection
}

/** Map driver failures consistently while allowing callers to retain their
 * adapter-specific operation bodies. */
export async function withMappedConnectionError<T>(
  system: SqlSystem,
  options: ConnectionOptions,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw mapError(error, system, options)
  }
}
