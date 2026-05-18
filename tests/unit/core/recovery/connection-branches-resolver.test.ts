import { describe, test, expect } from 'bun:test'
import {
  CONNECTION_BRANCH_IDS,
  matchConnectionBranch,
} from '@/core/recovery/connection-branches'
import type { StepResultSummary } from '@/core/recovery/next-types'

function withDoctor(doctor: object | string, status: 'ok' | 'failed' = 'ok'): StepResultSummary {
  return {
    status,
    stdoutSummary: typeof doctor === 'string' ? doctor : JSON.stringify(doctor),
  }
}

const cleanDoctor = {
  results: [
    { group: 'env', label: 'Bun version', status: 'pass', message: 'ok' },
    { group: 'connection', label: 'Connection', status: 'pass', message: 'ok' },
  ],
  hasError: false,
}

const configMissingDoctor = {
  results: [
    { group: 'config', label: 'Config exists', status: 'error', message: 'no .dbcli found' },
  ],
  hasError: true,
}

const authDoctor = {
  results: [
    { group: 'connection', label: 'Connection', status: 'error', message: 'password authentication failed for user' },
  ],
  hasError: true,
}

const networkDoctor = {
  results: [
    { group: 'connection', label: 'Connection', status: 'error', message: 'ECONNREFUSED 127.0.0.1:5432' },
  ],
  hasError: true,
}

describe('CONNECTION_BRANCH_IDS', () => {
  test('exposes the 4 ids in spec order', () => {
    expect([...CONNECTION_BRANCH_IDS]).toEqual([
      'doctor-clean',
      'doctor-config-missing',
      'doctor-auth-error',
      'doctor-network-error',
    ])
  })
})

describe('matchConnectionBranch — happy paths', () => {
  test('clean doctor → doctor-clean', () => {
    expect(matchConnectionBranch(withDoctor(cleanDoctor))).toBe('doctor-clean')
  })

  test('config error → doctor-config-missing', () => {
    expect(matchConnectionBranch(withDoctor(configMissingDoctor))).toBe('doctor-config-missing')
  })

  test('connection auth error → doctor-auth-error', () => {
    expect(matchConnectionBranch(withDoctor(authDoctor))).toBe('doctor-auth-error')
  })

  test('connection network error → doctor-network-error', () => {
    expect(matchConnectionBranch(withDoctor(networkDoctor))).toBe('doctor-network-error')
  })
})

describe('matchConnectionBranch — trigger order (locked, §3.1)', () => {
  test('config-missing wins over auth+network when both present', () => {
    const mixed = {
      results: [
        { group: 'config', label: 'Config exists', status: 'error', message: 'no config' },
        { group: 'connection', label: 'Connection', status: 'error', message: 'auth failed; ECONNREFUSED' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(mixed))).toBe('doctor-config-missing')
  })

  test('auth wins over network when both keywords match (auth first)', () => {
    const both = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'auth failed: ECONNREFUSED 127.0.0.1' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(both))).toBe('doctor-auth-error')
  })

  test('Default connection error → doctor-config-missing', () => {
    const cfg = {
      results: [
        { group: 'config', label: 'Default connection', status: 'error', message: 'no default connection' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(cfg))).toBe('doctor-config-missing')
  })

  test('V2 config validation error → doctor-config-missing', () => {
    const cfg = {
      results: [
        { group: 'config', label: 'V2 config validation', status: 'error', message: 'invalid v2 config' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(cfg))).toBe('doctor-config-missing')
  })

  test('Config valid error → doctor-config-missing', () => {
    const cfg = {
      results: [
        { group: 'config', label: 'Config valid', status: 'error', message: 'invalid config' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(cfg))).toBe('doctor-config-missing')
  })
})

describe('matchConnectionBranch — fallback to null', () => {
  test('empty stdoutSummary → null', () => {
    expect(matchConnectionBranch({ status: 'ok' })).toBeNull()
  })

  test('not valid JSON → null', () => {
    expect(matchConnectionBranch(withDoctor('this is not json'))).toBeNull()
  })

  test('JSON with wrong shape → null', () => {
    expect(matchConnectionBranch(withDoctor({ foo: 'bar' }))).toBeNull()
  })

  test('Connection error without auth-or-network keyword → null', () => {
    const weird = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'something went wrong' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(weird))).toBeNull()
  })

  test('error in a label we do not look at → null (no fallthrough to clean)', () => {
    const other = {
      results: [
        { group: 'env', label: 'Bun version', status: 'error', message: 'outdated' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(other))).toBeNull()
  })

  test('JSON missing results array → null', () => {
    expect(matchConnectionBranch(withDoctor({ hasError: true }))).toBeNull()
  })

  test('truncated JSON tail → null (parse fails)', () => {
    const fullStr = JSON.stringify(authDoctor)
    expect(matchConnectionBranch(withDoctor(fullStr.slice(0, 40)))).toBeNull()
  })
})

describe('matchConnectionBranch — keyword boundaries', () => {
  test('case-insensitive match', () => {
    const upper = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'AUTHENTICATION FAILED' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(upper))).toBe('doctor-auth-error')
  })

  test("'authority' triggers auth (substring match is intentional)", () => {
    const authority = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'no authority returned' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(authority))).toBe('doctor-auth-error')
  })

  test('"DNS" message routes to network', () => {
    const dns = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'DNS resolution failed' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(dns))).toBe('doctor-network-error')
  })

  test('"timeout" message routes to network', () => {
    const t = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'Operation timeout after 5s' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(t))).toBe('doctor-network-error')
  })

  test('"ENOTFOUND" message routes to network', () => {
    const n = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'getaddrinfo ENOTFOUND db.local' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(n))).toBe('doctor-network-error')
  })

  test('"permission denied" routes to auth', () => {
    const p = {
      results: [
        { group: 'connection', label: 'Connection', status: 'error', message: 'permission denied for role' },
      ],
      hasError: true,
    }
    expect(matchConnectionBranch(withDoctor(p))).toBe('doctor-auth-error')
  })
})

describe('matchConnectionBranch — determinism', () => {
  test('100 invocations of same input return the same result', () => {
    const out = new Set<string | null>()
    for (let i = 0; i < 100; i++) out.add(matchConnectionBranch(withDoctor(authDoctor)))
    expect(out.size).toBe(1)
    expect([...out][0]).toBe('doctor-auth-error')
  })
})
