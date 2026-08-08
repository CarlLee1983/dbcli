import { ConnectionError } from './types'

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
