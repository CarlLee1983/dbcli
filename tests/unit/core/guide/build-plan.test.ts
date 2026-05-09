import { describe, test, expect } from 'bun:test'
import { buildPlan } from '@/core/guide/build-plan'
import type { ResolvedSnippet, EngineTag } from '@/core/saved-queries'
import type { InspectSnapshot } from '@/core/inspect/types'

function snippet(opts: {
  key: string
  engine: EngineTag
  intent: string
  required?: boolean
  hasDefault?: boolean
}): ResolvedSnippet {
  const param = opts.required
    ? [
        {
          name: 'min_seconds',
          type: 'int' as const,
          required: !opts.hasDefault,
          ...(opts.hasDefault ? { default: 30 } : {}),
        },
      ]
    : []
  return {
    query: {
      meta: {
        name: opts.key,
        key: opts.key,
        description: '',
        engine: [opts.engine],
        params: param,
        tags: [],
        intent: opts.intent,
      },
      sqlBody: 'SELECT 1',
      file: `assets/${opts.key}.sql`,
      source: 'builtin',
    },
    hasLocalOverride: false,
  }
}

function asMap(list: ResolvedSnippet[]): Map<string, ResolvedSnippet[]> {
  const out = new Map<string, ResolvedSnippet[]>()
  for (const s of list) {
    const arr = out.get(s.query.meta.key) ?? []
    arr.push(s)
    out.set(s.query.meta.key, arr)
  }
  return out
}

const PG_CONTEXT: InspectSnapshot = {
  schemaVersion: 1,
  system: 'postgresql',
  connection: { name: 'default', database: 'app', version: '16.4' },
  permission: { level: 'query-only', canWrite: false, canDestruct: false },
  blacklist: { tables: 0, columnRules: 0 },
  objects: { kind: 'tables', count: 1, sample: ['users'] },
  schemaCache: { available: true, stale: false },
  snippets: { count: 5, engines: ['postgres'], intents: [] },
  suggestedCommands: [],
  warnings: [],
}

const NULL_CONTEXT: InspectSnapshot = {
  ...PG_CONTEXT,
  system: null,
  connection: { name: null, database: null, version: null },
  objects: { kind: 'tables', unavailable: true, reason: 'no system' },
  schemaCache: { available: false },
}

const STALE_CACHE_CONTEXT: InspectSnapshot = {
  ...PG_CONTEXT,
  schemaCache: { available: true, stale: true },
}

describe('buildPlan', () => {
  test('null system returns single dbcli init step', () => {
    const plan = buildPlan({
      context: NULL_CONTEXT,
      snippets: new Map(),
      engine: null,
      goal: 'slow-query',
    })
    expect(plan).toEqual([
      {
        order: 1,
        command: 'dbcli init',
        rationale: 'No dbcli configuration detected; initialize the workspace first.',
        risk: 'readonly',
        expects: 'Init wizard prompts for system, connection name, and credentials.',
      },
    ])
  })

  test('slow-query on postgres expands to anchor + per-intent snippets + suggest + doctor', () => {
    const map = asMap([
      snippet({ key: '@diag/long-running', engine: 'postgres', intent: 'perf.slow-query' }),
      snippet({ key: '@diag/locks', engine: 'postgres', intent: 'safety.locks' }),
      snippet({ key: '@diag/cache-hit', engine: 'postgres', intent: 'perf.cache-hit' }),
      snippet({ key: '@diag/index-usage', engine: 'postgres', intent: 'perf.index-usage' }),
    ])
    const plan = buildPlan({
      context: PG_CONTEXT,
      snippets: map,
      engine: 'postgres',
      goal: 'slow-query',
    })
    const commands = plan.map((s) => s.command)
    expect(commands).toEqual([
      'dbcli inspect --for-agent',
      'dbcli q @diag/long-running --format json',
      'dbcli q @diag/locks --format json',
      'dbcli q @diag/cache-hit --format json',
      'dbcli q @diag/index-usage --format json',
      'dbcli queries suggest perf --format json',
      'dbcli doctor --format json',
    ])
    expect(plan.every((s) => s.risk === 'readonly')).toBe(true)
    expect(plan.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(plan[1]!.snippet).toBe('@diag/long-running')
    expect(plan[1]!.intent).toBe('perf.slow-query')
  })

  test('skips snippets with required-without-default params', () => {
    const map = asMap([
      snippet({
        key: '@diag/long-running',
        engine: 'postgres',
        intent: 'perf.slow-query',
        required: true,
        hasDefault: false,
      }),
      snippet({ key: '@diag/locks', engine: 'postgres', intent: 'safety.locks' }),
    ])
    const plan = buildPlan({
      context: PG_CONTEXT,
      snippets: map,
      engine: 'postgres',
      goal: 'slow-query',
    })
    expect(plan.map((s) => s.command)).not.toContain(
      'dbcli q @diag/long-running --format json'
    )
    expect(plan.map((s) => s.command)).toContain('dbcli q @diag/locks --format json')
  })

  test('engine with zero matching snippets still produces anchor + suggest + doctor', () => {
    const plan = buildPlan({
      context: PG_CONTEXT,
      snippets: new Map(),
      engine: 'postgres',
      goal: 'capacity',
    })
    expect(plan.map((s) => s.command)).toEqual([
      'dbcli inspect --for-agent',
      'dbcli queries suggest capacity --format json',
      'dbcli doctor --format json',
    ])
  })

  test('mongodb engine emits a context-only plan with anchor + suggest + doctor', () => {
    const mongoCtx: InspectSnapshot = { ...PG_CONTEXT, system: 'mongodb' }
    const plan = buildPlan({
      context: mongoCtx,
      snippets: new Map(),
      engine: 'mongodb',
      goal: 'health',
    })
    expect(plan[0]!.command).toBe('dbcli inspect --for-agent')
    expect(plan.map((s) => s.command)).toContain('dbcli queries suggest safety --format json')
    expect(plan.map((s) => s.command)).toContain('dbcli doctor --format json')
  })

  test('permissions goal emits the synthetic permissions plan', () => {
    const plan = buildPlan({
      context: PG_CONTEXT,
      snippets: new Map(),
      engine: 'postgres',
      goal: 'permissions',
    })
    expect(plan.map((s) => s.command)).toEqual([
      'dbcli inspect --for-agent',
      'dbcli blacklist list --format json',
      'dbcli queries list --format json',
      'dbcli doctor --format json',
    ])
  })

  test('schema-overview emits list + conditional refresh + queries suggest', () => {
    const plan = buildPlan({
      context: STALE_CACHE_CONTEXT,
      snippets: new Map(),
      engine: 'postgres',
      goal: 'schema-overview',
    })
    expect(plan.map((s) => s.command)).toEqual([
      'dbcli inspect --for-agent',
      'dbcli list --format json',
      'dbcli schema --refresh',
      'dbcli queries suggest capacity --format json',
    ])
  })

  test('schema-overview without stale cache omits the refresh step', () => {
    const plan = buildPlan({
      context: PG_CONTEXT,
      snippets: new Map(),
      engine: 'postgres',
      goal: 'schema-overview',
    })
    expect(plan.map((s) => s.command)).toEqual([
      'dbcli inspect --for-agent',
      'dbcli list --format json',
      'dbcli queries suggest capacity --format json',
    ])
  })

  test('plan length stays within MAX_STEPS (8) and orders are 1-based contiguous', () => {
    // Even with 20 candidate snippets, the algorithm picks at most one per intent.
    const map = asMap(
      Array.from({ length: 20 }, (_, i) =>
        snippet({
          key: `@diag/extra-${i}`,
          engine: 'postgres',
          intent: 'perf.slow-query',
        })
      )
    )
    const plan = buildPlan({
      context: PG_CONTEXT,
      snippets: map,
      engine: 'postgres',
      goal: 'slow-query',
    })
    expect(plan.length).toBeLessThanOrEqual(8)
    expect(plan.length).toBeGreaterThan(0)
    expect(plan.map((s) => s.order)).toEqual(
      Array.from({ length: plan.length }, (_, i) => i + 1)
    )
  })
})
