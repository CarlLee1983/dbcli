/**
 * `capabilities check` evaluation — unit tests (DBCLI-PLAT-003).
 *
 * The property under test throughout is fail-closed: nothing the caller can
 * type, and no state of the local environment, produces `available` for a
 * capability whose engine or permission does not actually allow it.
 */
import { describe, expect, test } from 'bun:test'
import {
  CapabilityRequirementError,
  checkCapabilities,
  parseRequirements,
  type CapabilityCheckContext,
} from '@/core/capabilities'
import { parseCapabilityCheckReport } from '@/core/capabilities/schema'

const PG_QUERY_ONLY: CapabilityCheckContext = {
  engine: 'postgresql',
  permission: 'query-only',
  connectionName: null,
  agentMode: false,
}

const REDIS_ADMIN: CapabilityCheckContext = {
  engine: 'redis',
  permission: 'admin',
  connectionName: 'cache',
  agentMode: false,
}

describe('parseRequirements', () => {
  test('splits and trims a comma-separated list', () => {
    expect(parseRequirements(' schema.read , query.read ').ids).toEqual([
      'schema.read',
      'query.read',
    ])
  })

  test('de-duplicates in first-seen order and warns', () => {
    const parsed = parseRequirements('query.read,schema.read,query.read')
    expect(parsed.ids).toEqual(['query.read', 'schema.read'])
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.warnings[0]).toContain('query.read')
  })

  test('refuses an empty requirement list rather than reporting ok', () => {
    expect(() => parseRequirements('')).toThrow(CapabilityRequirementError)
    expect(() => parseRequirements('   ')).toThrow(CapabilityRequirementError)
  })

  test('refuses an empty element inside the list', () => {
    expect(() => parseRequirements('schema.read,,query.read')).toThrow(CapabilityRequirementError)
    expect(() => parseRequirements('schema.read,')).toThrow(CapabilityRequirementError)
  })
})

describe('checkCapabilities', () => {
  test('reports available when engine and permission both allow it', () => {
    const report = checkCapabilities(['schema.read', 'query.read'], PG_QUERY_ONLY)
    expect(report.ok).toBe(true)
    expect(report.results.map((result) => result.status)).toEqual(['available', 'available'])
    expect(report.results.every((result) => result.reason === null)).toBe(true)
  })

  test('an unknown id is unknown, never available, and never guessed at', () => {
    const report = checkCapabilities(['schema.reed'], PG_QUERY_ONLY)
    expect(report.ok).toBe(false)
    expect(report.results[0]).toEqual({
      id: 'schema.reed',
      status: 'unknown',
      reason: 'unknown-capability',
    })
  })

  test('an unsupported engine is unavailable, not available', () => {
    // `data.health-check` is SQL-only in ENGINE_CAPABILITIES.
    const report = checkCapabilities(['data.health-check'], REDIS_ADMIN)
    expect(report.results[0]!.status).toBe('unavailable')
    expect(report.results[0]!.reason).toBe('engine')
  })

  test('an insufficient permission is unavailable, not available', () => {
    const report = checkCapabilities(['data.delete'], PG_QUERY_ONLY)
    expect(report.results[0]!.status).toBe('unavailable')
    expect(report.results[0]!.reason).toBe('permission')
  })

  test('a higher permission than required still passes', () => {
    const report = checkCapabilities(['query.read'], {
      engine: 'postgresql',
      permission: 'admin',
      connectionName: null,
      agentMode: false,
    })
    expect(report.results[0]!.status).toBe('available')
  })

  test('engine is checked before permission, so the reason names the real blocker', () => {
    // `schema.migrate` needs admin and is SQL-only; on Redis with query-only
    // both would fail, and the engine is the one that cannot be fixed by
    // raising a level.
    const report = checkCapabilities(['schema.migrate'], {
      engine: 'redis',
      permission: 'query-only',
      connectionName: null,
      agentMode: false,
    })
    expect(report.results[0]!.reason).toBe('engine')
  })

  test('an absent config is unavailable with context-unavailable, never available', () => {
    const report = checkCapabilities(['schema.read', 'query.read'], null, [], 'absent')
    expect(report.ok).toBe(false)
    for (const result of report.results) {
      expect(result.status).toBe('unavailable')
      expect(result.reason).toBe('context-unavailable')
    }
    expect(report.warnings.join(' ')).toContain('No dbcli configuration was found')
  })

  test('a config that exists but will not resolve says so, not "no config"', () => {
    // The distinction is the whole point: an unset `{"$env":...}` password
    // leaves a perfectly present config unresolvable, and reporting "there is no
    // configuration" there would be the contract stating a falsehood.
    const report = checkCapabilities(['schema.read'], null, [], 'unresolvable')
    expect(report.results[0]!.reason).toBe('context-unresolvable')
    expect(report.warnings.join(' ')).toContain('could not be resolved')
    expect(report.warnings.join(' ')).not.toContain('No dbcli configuration was found')
  })

  test('agent mode makes a configuration-mutating capability unavailable', () => {
    // DBCLI_AGENT_MODE=1 refuses every config change unconditionally, and that
    // is knowable without connecting. Reporting `available` here would be the
    // one promise this contract makes that its primary consumer would act on
    // and find false.
    const agent: CapabilityCheckContext = { ...PG_QUERY_ONLY, permission: 'admin', agentMode: true }
    for (const id of ['connection.select', 'connection.init', 'blacklist.manage']) {
      const report = checkCapabilities([id], agent)
      expect({ id, status: report.results[0]!.status, reason: report.results[0]!.reason }).toEqual({
        id,
        status: 'unavailable',
        reason: 'agent-mode',
      })
    }
  })

  test('agent mode leaves capabilities that change no configuration alone', () => {
    const agent: CapabilityCheckContext = { ...PG_QUERY_ONLY, agentMode: true }
    for (const id of ['schema.read', 'query.read', 'snippet.manage', 'audit.tail']) {
      const report = checkCapabilities([id], agent)
      expect({ id, status: report.results[0]!.status }).toEqual({ id, status: 'available' })
    }
  })

  test('agent mode is reported in warnings so the refusal is explicable', () => {
    const report = checkCapabilities(['schema.read'], { ...PG_QUERY_ONLY, agentMode: true })
    expect(report.warnings.join(' ')).toContain('DBCLI_AGENT_MODE=1')
  })

  test('engine outranks agent mode, which outranks permission', () => {
    // Least-fixable first, so the reason names the blocker actually in the way.
    const onRedisUnderAgentMode: CapabilityCheckContext = {
      engine: 'redis',
      permission: 'query-only',
      connectionName: null,
      agentMode: true,
    }
    expect(checkCapabilities(['schema.migrate'], onRedisUnderAgentMode).results[0]!.reason).toBe(
      'engine'
    )
    expect(
      checkCapabilities(['blacklist.manage'], { ...onRedisUnderAgentMode, engine: 'postgresql' })
        .results[0]!.reason
    ).toBe('agent-mode')
  })

  test('an absent context still distinguishes an unknown id from a known one', () => {
    const report = checkCapabilities(['schema.read', 'not.a.capability'], null)
    expect(report.results[0]!.reason).toBe('context-unavailable')
    expect(report.results[1]!.status).toBe('unknown')
  })

  test('an engine-independent capability is available on any engine', () => {
    for (const engine of ['postgresql', 'redis', 'elasticsearch'] as const) {
      const report = checkCapabilities(['shell-completion.generate'], {
        engine,
        permission: 'query-only',
        connectionName: null,
        agentMode: false,
      })
      expect(report.results[0]!.status).toBe('available')
    }
  })

  test('input order is preserved and does not change the verdict', () => {
    const forward = checkCapabilities(['schema.read', 'data.delete'], PG_QUERY_ONLY)
    const reverse = checkCapabilities(['data.delete', 'schema.read'], PG_QUERY_ONLY)

    expect(forward.ok).toBe(reverse.ok)
    expect(forward.results.map((r) => r.id)).toEqual(['schema.read', 'data.delete'])
    expect(reverse.results.map((r) => r.id)).toEqual(['data.delete', 'schema.read'])

    const byId = (report: typeof forward) =>
      Object.fromEntries(report.results.map((r) => [r.id, r.status]))
    expect(byId(forward)).toEqual(byId(reverse))
  })

  test('a SQL-only capability is unavailable on the engines whose code refuses it', () => {
    // DBCLI-PLAT-011. Each of these is `unsupported` in the matrix because the
    // command itself throws on a non-SQL connection; the reason has to be
    // `engine`, not `permission`, or a caller goes and edits the wrong thing.
    const SQL_ONLY = [
      'query.explain',
      'query.plan-risk',
      'data.assert',
      'data.snapshot',
      'verification.run',
      'diagnostic.proxy',
    ]

    for (const id of SQL_ONLY) {
      const supported = checkCapabilities([id], PG_QUERY_ONLY)
      expect({ id, status: supported.results[0]!.status }).toEqual({ id, status: 'available' })

      for (const engine of ['mongodb', 'redis', 'elasticsearch'] as const) {
        const report = checkCapabilities([id], {
          engine,
          permission: 'admin',
          connectionName: null,
          agentMode: false,
        })
        // `admin` on purpose: no permission level can make an engine support
        // something its own command refuses.
        expect({ id, engine, result: report.results[0] }).toEqual({
          id,
          engine,
          result: { id, status: 'unavailable', reason: 'engine' },
        })
      }
    }
  })

  test('a mode-limited capability stays available off SQL', () => {
    // `schema.impact-assess`, `semantic.context` and `schema.design` lose one
    // documented mode on a non-SQL connection — `--against-cache`, and
    // `semantic draft validate` — and keep the rest. `unsupported` would have
    // closed a command the caller can actually run.
    for (const id of ['schema.impact-assess', 'semantic.context', 'schema.design']) {
      for (const engine of ['mongodb', 'redis', 'elasticsearch'] as const) {
        const report = checkCapabilities([id], {
          engine,
          permission: 'query-only',
          connectionName: null,
          agentMode: false,
        })
        expect({ id, engine, status: report.results[0]!.status }).toEqual({
          id,
          engine,
          status: 'available',
        })
      }
    }
  })

  test('an engine-independent capability is available wherever a context exists', () => {
    for (const id of ['capability.discover', 'capability.check', 'recovery.codes']) {
      for (const engine of ['postgresql', 'mongodb', 'redis', 'elasticsearch'] as const) {
        const report = checkCapabilities([id], {
          engine,
          permission: 'query-only',
          connectionName: null,
          agentMode: false,
        })
        expect({ id, engine, status: report.results[0]!.status }).toEqual({
          id,
          engine,
          status: 'available',
        })
      }
    }
  })

  test('rotating a credential is refused under agent mode whatever the permission', () => {
    const report = checkCapabilities(['connection.rotate-credential'], {
      engine: 'postgresql',
      permission: 'admin',
      connectionName: null,
      agentMode: true,
    })
    expect(report.results[0]).toEqual({
      id: 'connection.rotate-credential',
      status: 'unavailable',
      reason: 'agent-mode',
    })
  })

  test('the report satisfies the strict schema', () => {
    for (const context of [PG_QUERY_ONLY, REDIS_ADMIN, null]) {
      const report = checkCapabilities(['schema.read', 'nope.nope'], context)
      expect(() => parseCapabilityCheckReport(report)).not.toThrow()
    }
  })

  test('the report never carries a host, port or credential', () => {
    const serialized = JSON.stringify(checkCapabilities(['schema.read'], REDIS_ADMIN))
    expect(serialized).not.toMatch(/localhost|127\.0\.0\.1|:\/\/|password|"port"|"host"/i)
    // The connection *name* is a label the user chose, and is what makes the
    // report attributable; the endpoint behind it never appears.
    expect(serialized).toContain('cache')
  })
})
