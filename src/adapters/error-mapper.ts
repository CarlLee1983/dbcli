/**
 * Error mapper for database connection errors
 * Categorizes driver errors into user-friendly messages with actionable hints
 */

import { ConnectionError, type ConnectionOptions } from './types'

/**
 * Map database and OS errors to user-friendly ConnectionError with categorized hints
 *
 * @param error The original error from driver or OS
 * @param system Database system type for system-specific hints
 * @param options Connection options for context in error messages
 * @returns ConnectionError with categorized code, message, and troubleshooting hints
 */
export function mapError(
  error: unknown,
  system: 'postgresql' | 'mysql' | 'mariadb',
  options: ConnectionOptions
): ConnectionError {
  const err = error as Record<string, unknown>
  const errMsg = String(err?.message || String(error))
  const errCode = String(err?.code || '')

  // ECONNREFUSED: Server not running or port not listening
  if (errCode === 'ECONNREFUSED' || errMsg.includes('refused')) {
    return new ConnectionError(
      'ECONNREFUSED',
      `Cannot connect to ${options.host}:${options.port} — server is not running or not listening on this port`,
      [
        `Check that the ${system} service is running: ${
          system === 'postgresql' ? 'systemctl status postgresql' : 'systemctl status mysql'
        }`,
        `Verify the port is correct: ${system === 'postgresql' ? 'default 5432' : 'default 3306'}`,
        `Check that ${options.host} is reachable: ping ${options.host} or telnet ${options.host} ${options.port}`,
      ]
    )
  }

  // ETIMEDOUT: Firewall or slow network
  if (errCode === 'ETIMEDOUT' || errMsg.includes('timeout') || errMsg.includes('timed out')) {
    return new ConnectionError(
      'ETIMEDOUT',
      `Connection timed out (${options.timeout || 5000}ms) — may be blocked by a firewall or slow network`,
      [
        `Check firewall rules: ${system === 'postgresql' ? 'allow TCP 5432' : 'allow TCP 3306'}`,
        `Increase timeout: edit .dbcli and add "timeout": 15000`,
        `Verify network connectivity: ping ${options.host} -c 3`,
      ]
    )
  }

  // AUTH_FAILED: Authentication (credentials) error
  if (
    errMsg.includes('authentication') ||
    errMsg.includes('auth') ||
    errMsg.includes('password') ||
    errMsg.includes('access denied') ||
    errMsg.includes('FATAL')
  ) {
    return new ConnectionError(
      'AUTH_FAILED',
      `Authentication failed — check your username or password`,
      [
        `Verify credentials: ${
          system === 'postgresql'
            ? `psql -U ${options.user} -h ${options.host}`
            : `mysql -u ${options.user} -h ${options.host}`
        }`,
        `Check pg_hba.conf (PostgreSQL) or user privileges (MySQL)`,
        `Re-run dbcli init to update credentials`,
      ]
    )
  }

  // ENOTFOUND: Host not found (DNS resolution failed)
  if (errCode === 'ENOTFOUND' || errMsg.includes('not found') || errMsg.includes('getaddrinfo')) {
    return new ConnectionError('ENOTFOUND', `Host not found: ${options.host}`, [
      `Check the hostname spelling: ${options.host}`,
      `Verify DNS resolution: nslookup ${options.host}`,
      `If using localhost, try 127.0.0.1 (IPv4 vs IPv6 issue)`,
    ])
  }

  // UNKNOWN: Fallback for unrecognized errors
  return new ConnectionError('UNKNOWN', `Connection failed: ${errMsg}`, [
    `Check connection parameters: host=${options.host}, port=${options.port}, user=${options.user}`,
    `View server logs: ${system === 'postgresql' ? 'postgresql.log' : 'mysql.log'}`,
    `Try connecting directly with the ${system === 'postgresql' ? 'psql' : 'mysql'} command-line tool`,
  ])
}

// Re-export ConnectionError for convenience
export { ConnectionError }
