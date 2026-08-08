import type { ConnectionOptions } from './types'
import { ConnectionError } from './types'
import { mapError } from './error-mapper'

type SqlSystem = 'postgresql' | 'mysql' | 'mariadb'

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
