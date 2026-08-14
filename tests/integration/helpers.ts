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
 * Demand that the services really are there.
 *
 * Auto-skipping is right on a developer machine with no docker running, and
 * wrong in the job whose entire purpose is to exercise these tests: a suite
 * that skips reports the same green as a suite that passes, which is how
 * `tests/integration` sat in CI doing nothing. With this set, an unreachable
 * service is a failure with the address in it rather than a silent skip.
 */
export const REQUIRE_SERVICES = process.env.REQUIRE_INTEGRATION_SERVICES === 'true'

/**
 * Connection defaults for the docker-compose.test.yml fixture services, each
 * overridable by an environment variable. Values are the published host
 * ports in docker-compose.test.yml, not the in-container ports.
 *
 * PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE is the only
 * accepted spelling for PostgreSQL. A second spelling (PGHOST / PGPORT / ...,
 * the libpq convention) used to exist in several test files with its own
 * defaults — localhost:5432, user/password/database all "postgres" — which
 * is not a server this repo starts. Two names for one address is exactly how
 * that split happened and how those tests sat silently skipping (or, once
 * REQUIRE_INTEGRATION_SERVICES stopped tolerating the skip, failing) for as
 * long as they existed. Do not reintroduce PGHOST as an accepted alias.
 */
export const PG_HOST = process.env.PG_HOST || 'localhost'
export const PG_PORT = Number(process.env.PG_PORT || 5433)
export const PG_USER = process.env.PG_USER || 'dbcli'
export const PG_PASSWORD = process.env.PG_PASSWORD || 'testpass'
export const PG_DATABASE = process.env.PG_DATABASE || 'dbcli_test'

export const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost'
export const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3307)
export const MYSQL_USER = process.env.MYSQL_USER || 'dbcli'
export const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'testpass'
export const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'dbcli_test'

export const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
export const REDIS_PORT = Number(process.env.REDIS_PORT || 6379)

export const MONGO_HOST = process.env.MONGO_HOST || 'localhost'
export const MONGO_PORT = Number(process.env.MONGO_PORT || 27017)
export const MONGO_URI = process.env.MONGO_TEST_URI || `mongodb://${MONGO_HOST}:${MONGO_PORT}`

export const ES_HOST = process.env.ES_HOST || 'localhost'
export const ES_PORT = Number(process.env.ES_PORT || 9201)

function refuseToSkip(what: string, cause?: unknown): never {
  const reason = cause instanceof Error ? `: ${cause.message}` : ''
  throw new Error(
    `REQUIRE_INTEGRATION_SERVICES is set, but ${what} is not available${reason}. ` +
      'Start them with: docker compose -f docker-compose.test.yml up -d --wait'
  )
}

/**
 * Test if a database connection is available.
 * Returns true if we can establish a TCP connection to the host:port.
 * Does not require valid credentials — only checks reachability.
 */
export async function isDbReachable(
  host: string,
  port: number,
  _timeoutMs = 2000
): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data() {},
        open(socket) {
          socket.end()
        },
        error() {},
        connectError() {},
      },
    })
    socket.end()
    return true
  } catch (error) {
    if (REQUIRE_SERVICES) refuseToSkip(`${host}:${port}`, error)
    return false
  }
}

/**
 * Attempt an actual database connection to determine if tests should run.
 * This catches both unreachable hosts AND invalid credentials.
 */
export async function shouldSkipTests(options: ConnectionOptions): Promise<boolean> {
  if (SKIP_BY_ENV) {
    // Both set is a contradiction in the caller's own configuration, and the
    // one that wins silently would decide whether the suite means anything.
    if (REQUIRE_SERVICES) {
      throw new Error(
        'SKIP_INTEGRATION_TESTS and REQUIRE_INTEGRATION_SERVICES are both set; ' +
          'they ask for opposite things. Unset one.'
      )
    }
    return true
  }

  try {
    const { AdapterFactory } = await import('src/adapters')
    const adapter = AdapterFactory.createAdapter(options)
    await adapter.connect()
    await adapter.disconnect()
    return false
  } catch (error) {
    if (REQUIRE_SERVICES)
      refuseToSkip(`${options.system} at ${options.host}:${options.port}`, error)
    return true
  }
}
