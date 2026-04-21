/**
 * Database-system-specific default values
 * Used by env-parser, config, and init commands
 */

import type { ConnectionConfig } from '@/types'

/**
 * Get default configuration values for the specified database system
 *
 * @example
 * getDefaultsForSystem('postgresql')
 * // returns { port: 5432, host: 'localhost' }
 */
export function getDefaultsForSystem(
  system: 'postgresql' | 'mysql' | 'mariadb' | 'mongodb'
): Partial<ConnectionConfig> {
  switch (system) {
    case 'postgresql':
      return {
        port: 5432,
        host: 'localhost',
      }
    case 'mysql':
    case 'mariadb':
      return {
        port: 3306,
        host: 'localhost',
      }
    case 'mongodb':
      return {
        port: 27017,
        host: 'localhost',
      }
    default:
      return {
        port: 5432,
        host: 'localhost',
      }
  }
}
