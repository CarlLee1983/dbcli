import { describe, test, expect } from 'bun:test'
import { CONNECTION_RESOLVER_KEYWORDS } from '@/core/recovery/connection-branches'

// Representative phrases the doctor connection check surfaces today, per engine.
// Update these (and the release notes) whenever doctor's message wording changes.
const DOCTOR_MESSAGES = {
  auth: {
    postgres: 'password authentication failed for user "x"',
    mysql: 'access denied for user',
    mariadb: 'access denied for user',
    mongodb: 'authentication failed',
    redis: 'wrongpass invalid username-password pair',
    elasticsearch: 'failed authentication for [elastic]',
  },
  network: {
    postgres: 'connect ECONNREFUSED 127.0.0.1:5432',
    mysql: 'connect ECONNREFUSED 127.0.0.1:3306',
    mariadb: 'connect ETIMEDOUT 10.0.0.1:3306',
    mongodb: 'connection timed out',
    redis: 'getaddrinfo ENOTFOUND redis-host',
    elasticsearch: 'connect ECONNREFUSED 127.0.0.1:9200',
  },
} as const

function lowerHasAny(message: string, keywords: readonly string[]): boolean {
  const m = message.toLowerCase()
  return keywords.some((k) => m.includes(k))
}

describe('doctor ↔ resolver coupling contract (release gate)', () => {
  for (const [engine, msg] of Object.entries(DOCTOR_MESSAGES.auth)) {
    test(`auth message for ${engine} hits AUTH_KEYWORDS`, () => {
      expect(lowerHasAny(msg, CONNECTION_RESOLVER_KEYWORDS.auth)).toBe(true)
    })
  }

  for (const [engine, msg] of Object.entries(DOCTOR_MESSAGES.network)) {
    test(`network message for ${engine} hits NETWORK_KEYWORDS`, () => {
      expect(lowerHasAny(msg, CONNECTION_RESOLVER_KEYWORDS.network)).toBe(true)
    })
  }
})
