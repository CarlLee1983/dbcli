/**
 * Database-system-specific default values
 * Used by env-parser, config, and init commands
 */

import { ConnectionConfig } from '@/types'

/**
 * Get default configuration values for the specified database system
 *
 * @example
 * getDefaultsForSystem('postgresql')
 * // returns { port: 5432, host: 'localhost' }
 */
export function getDefaultsForSystem(
  system: 'postgresql' | 'mysql' | 'mariadb'
): Partial<ConnectionConfig> {
  switch (system) {
    case 'postgresql':
      return {
        port: 5432,
        host: 'localhost'
      }
    case 'mysql':
    case 'mariadb':
      return {
        port: 3306,
        host: 'localhost'
      }
    default:
      // Should never reach here (TypeScript will catch this)
      // but provide a sensible fallback just in case
      return {
        port: 3306,
        host: 'localhost'
      }
  }
}
