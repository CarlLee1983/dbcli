/**
 * Database server version validation
 * Checks if the connected database meets minimum supported version requirements
 */

import { t_vars } from '@/i18n/message-loader'
import { colors } from '@/utils/colors'

export interface DbVersionRequirement {
  system: 'postgresql' | 'mysql' | 'mariadb'
  minVersion: string
}

export const MIN_SUPPORTED_VERSIONS: Record<string, string> = {
  postgresql: '12.0',
  mysql: '8.0',
  mariadb: '10.5',
}

/**
 * Parse a version string into numeric segments for comparison
 * Extracts leading numeric parts, ignoring suffixes like "-MariaDB"
 * e.g. "10.11.6-MariaDB" → [10, 11, 6]
 */
export function parseVersionSegments(version: string): number[] {
  const match = version.match(/^(\d+(?:\.\d+)*)/)
  if (!match) return []
  return match[1].split('.').map(Number)
}

/**
 * Detect if a VERSION() string indicates MariaDB
 * MariaDB returns strings like "10.11.6-MariaDB" or "5.5.5-10.11.6-MariaDB-..."
 */
export function isMariaDBVersion(versionString: string): boolean {
  return /mariadb/i.test(versionString)
}

/**
 * Extract the actual MariaDB version from VERSION() output
 * Some MariaDB versions prefix with "5.5.5-" for compatibility
 * e.g. "5.5.5-10.11.6-MariaDB-1:10.11.6+maria~ubu2204" → "10.11.6"
 */
export function extractMariaDBVersion(versionString: string): string {
  const match = versionString.match(/(\d+\.\d+\.\d+)-MariaDB/i)
  if (match) return match[1]

  // Fallback: try to find version after "5.5.5-" prefix
  const prefixMatch = versionString.match(/^5\.5\.5-(\d+\.\d+\.\d+)/)
  if (prefixMatch) return prefixMatch[1]

  return versionString
}

/**
 * Compare two version strings
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const segA = parseVersionSegments(a)
  const segB = parseVersionSegments(b)
  const len = Math.max(segA.length, segB.length)

  for (let i = 0; i < len; i++) {
    const diff = (segA[i] ?? 0) - (segB[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface VersionCheckResult {
  serverVersion: string
  system: 'postgresql' | 'mysql' | 'mariadb'
  supported: boolean
  minVersion: string
}

/**
 * Check if the server version meets minimum requirements
 */
export function checkDbVersion(
  rawVersion: string,
  declaredSystem: 'postgresql' | 'mysql' | 'mariadb'
): VersionCheckResult {
  const isMariaDB = isMariaDBVersion(rawVersion)
  const system = isMariaDB ? 'mariadb' : declaredSystem
  const serverVersion = isMariaDB
    ? extractMariaDBVersion(rawVersion)
    : rawVersion
  const minVersion = MIN_SUPPORTED_VERSIONS[system]
  const supported = compareVersions(serverVersion, minVersion) >= 0

  return { serverVersion, system, supported, minVersion }
}

/**
 * Print version warning to stderr if the server version is below minimum
 */
export function warnIfUnsupported(result: VersionCheckResult): void {
  if (result.supported) return

  const message = t_vars('version.unsupported_warning', {
    system: result.system,
    version: result.serverVersion,
    minVersion: result.minVersion,
  })
  process.stderr.write(colors.warn(`⚠ ${message}`) + '\n')
}
