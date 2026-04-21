/**
 * .env file parser
 * Supports DATABASE_URL format and DB_* component format
 */

import { DatabaseEnv } from '@/types'
import { EnvParseError } from '@/utils/errors'
import { getDefaultsForSystem } from '@/adapters/defaults'

/**
 * Parse connection info from DATABASE_URL
 * Supports RFC 3986 percent-encoding (special characters in passwords)
 *
 * @example
 * parseConnectionUrl('postgresql://user:p%40ssword@localhost:5432/mydb')
 * // returns { system: 'postgresql', host: 'localhost', port: 5432, user: 'user', password: 'p@ssword', database: 'mydb' }
 */
export function parseConnectionUrl(url: string): DatabaseEnv {
  try {
    const parsed = new URL(url)

    // Detect database system from protocol
    const protocol = parsed.protocol.replace(':', '')
    let system: 'postgresql' | 'mysql' | 'mariadb'

    if (protocol === 'postgresql' || protocol === 'postgres') {
      system = 'postgresql'
    } else if (protocol === 'mysql') {
      system = 'mysql'
    } else if (protocol === 'mariadb') {
      system = 'mariadb'
    } else {
      throw new Error(`Unsupported protocol: ${protocol}`)
    }

    // Extract components, using percent-decoding to handle special characters
    const host = parsed.hostname || 'localhost'
    const port =
      parsed.port !== ''
        ? parseInt(parsed.port, 10)
        : getDefaultsForSystem(system).port || 5432

    // CRITICAL: Decode username and password to handle special characters
    const user = decodeURIComponent(parsed.username || '')
    const password = decodeURIComponent(parsed.password || '')
    const database = parsed.pathname.slice(1) // Remove leading /

    return { system, host, port, user, password, database }
  } catch (error) {
    throw new EnvParseError(
      `Failed to parse DATABASE_URL: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Parse database configuration from environment variables
 *
 * Priority order:
 * 1. DATABASE_URL (complete connection string)
 * 2. DB_* components (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME/DB_DATABASE)
 * 3. Returns null if neither is present
 *
 * @returns DatabaseEnv or null if no database configuration found
 * @throws EnvParseError if components are incomplete or invalid
 */
export function parseEnvDatabase(env: Record<string, string>): DatabaseEnv | null {
  // Path 1: DATABASE_URL (complete connection string)
  if (env.DATABASE_URL) {
    return parseConnectionUrl(env.DATABASE_URL)
  }

  // Path 2: DB_* components
  if (env.DB_HOST || env.DB_USER) {
    const system = (env.DB_SYSTEM || 'postgresql') as 'postgresql' | 'mysql' | 'mariadb'
    const user = env.DB_USER
    const database = env.DB_NAME || env.DB_DATABASE

    // Validate required fields
    if (!user) {
      throw new EnvParseError('DB_USER is required when using component format')
    }
    if (!database) {
      throw new EnvParseError('DB_NAME or DB_DATABASE is required when using component format')
    }

    const defaults = getDefaultsForSystem(system)
    const port = env.DB_PORT ? parseInt(env.DB_PORT, 10) : (defaults.port || 5432)

    // Validate port number
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new EnvParseError(`DB_PORT must be between 1 and 65535, got: ${env.DB_PORT}`)
    }

    return {
      system,
      host: env.DB_HOST || defaults.host || 'localhost',
      port,
      user,
      password: env.DB_PASSWORD || '',
      database
    }
  }

  // No database configuration found
  return null
}
