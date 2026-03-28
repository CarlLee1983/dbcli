/**
 * Integration test helpers — connection availability detection
 *
 * Auto-skips tests when the target database is unreachable,
 * instead of failing with authentication/connection errors.
 */

import type { ConnectionOptions } from 'src/adapters/types'

/**
 * Check if integration tests should be skipped via env var
 */
export const SKIP_BY_ENV = process.env.SKIP_INTEGRATION_TESTS === 'true'

/**
 * Test if a database connection is available.
 * Returns true if we can establish a TCP connection to the host:port.
 * Does not require valid credentials — only checks reachability.
 */
export async function isDbReachable(
  host: string,
  port: number,
  timeoutMs = 2000
): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data() {},
        open(socket) { socket.end() },
        error() {},
        connectError() {},
      },
    })
    socket.end()
    return true
  } catch {
    return false
  }
}

/**
 * Attempt an actual database connection to determine if tests should run.
 * This catches both unreachable hosts AND invalid credentials.
 */
export async function shouldSkipTests(options: ConnectionOptions): Promise<boolean> {
  if (SKIP_BY_ENV) return true

  try {
    const { AdapterFactory } = await import('src/adapters')
    const adapter = AdapterFactory.createAdapter(options)
    await adapter.connect()
    await adapter.disconnect()
    return false
  } catch {
    return true
  }
}
