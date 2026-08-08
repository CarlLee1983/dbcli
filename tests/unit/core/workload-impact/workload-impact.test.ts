import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWorkloadEvidence } from '@/core/workload-impact'

const now = new Date('2026-08-08T12:00:00.000Z')

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    type: 'query_completed',
    timestamp: '2026-08-08T11:00:00.000Z',
    engine: 'postgresql',
    sessionId: 'private-session',
    queryId: 'private-query',
    client: 'private-client',
    target: 'private-target',
    sql: "SELECT * FROM accounts WHERE token = 'private-literal'",
    statement: 'select',
    tables: ['accounts'],
    error: null,
    tags: [],
    ...overrides,
  }
}

describe('loadWorkloadEvidence', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dbcli-workload-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  test('returns only bounded redacted metadata from recent completed events', async () => {
    const path = join(workspace, 'events.jsonl')
    await writeFile(
      path,
      `${JSON.stringify(event({ type: 'query_errored', error: { message: 'private-error', code: 'x' } }))}\n`
    )

    const evidence = await loadWorkloadEvidence({ path, blockedIdentifiers: [], now })

    expect(evidence).toMatchObject({
      state: 'available',
      origin: 'proxy-workload',
      observations: [{ tables: ['accounts'] }],
      malformedLines: 0,
      issues: [],
      timeframe: { from: '2026-08-08T11:00:00.000Z', to: '2026-08-08T11:00:00.000Z' },
    })
    const serialized = JSON.stringify(evidence)
    for (const unsafe of [
      'private-literal',
      'private-error',
      'private-session',
      'private-query',
      'private-client',
      'private-target',
    ]) {
      expect(serialized).not.toContain(unsafe)
    }
  })

  test('makes missing, malformed, stale, and protected input non-clean without retaining source content', async () => {
    const missing = await loadWorkloadEvidence({
      path: join(workspace, 'missing.jsonl'),
      blockedIdentifiers: [],
      now,
    })
    expect(missing.state).toBe('absent')

    const path = join(workspace, 'events.jsonl')
    await writeFile(
      path,
      [
        '{not json}',
        JSON.stringify(event({ timestamp: '2026-07-01T11:00:00.000Z' })),
        JSON.stringify(event({ tables: ['restricted_accounts'] })),
        JSON.stringify(event({ tables: ['not a canonical table'] })),
      ].join('\n')
    )
    const evidence = await loadWorkloadEvidence({
      path,
      blockedIdentifiers: ['restricted_accounts'],
      now,
    })

    expect(evidence.state).toBe('available')
    expect(evidence.observations).toEqual([])
    expect(evidence.issues).toEqual(['malformed', 'redaction-failed', 'redacted-protected-subject'])
    expect(JSON.stringify(evidence)).not.toContain('restricted_accounts')
  })

  test('ignores normal lifecycle and observed events while retaining deduplicated completed metadata', async () => {
    const path = join(workspace, 'events.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({
          version: 1,
          type: 'session_started',
          timestamp: '2026-08-08T11:00:00.000Z',
        }),
        JSON.stringify(event({ type: 'query_observed' })),
        JSON.stringify(event()),
        JSON.stringify(event()),
      ].join('\n')
    )

    const evidence = await loadWorkloadEvidence({ path, blockedIdentifiers: [], now })

    expect(evidence.observations).toEqual([{ tables: ['accounts'] }])
    expect(evidence.malformedLines).toBe(0)
    expect(evidence.issues).toEqual([])
  })

  test('retains safe tables from mixed protected observations without leaking the protected table', async () => {
    const path = join(workspace, 'events.jsonl')
    await writeFile(
      path,
      `${JSON.stringify(event({ tables: ['accounts', 'restricted_accounts'] }))}\n`
    )

    const evidence = await loadWorkloadEvidence({
      path,
      blockedIdentifiers: ['restricted_accounts'],
      now,
    })

    expect(evidence.observations).toEqual([{ tables: ['accounts'] }])
    expect(evidence.issues).toEqual(['redacted-protected-subject'])
    expect(JSON.stringify(evidence)).not.toContain('restricted_accounts')
  })

  test('marks a readable event file with no recent completed observation as stale', async () => {
    const path = join(workspace, 'events.jsonl')
    await writeFile(path, `${JSON.stringify(event({ timestamp: '2026-07-01T11:00:00.000Z' }))}\n`)

    const evidence = await loadWorkloadEvidence({ path, blockedIdentifiers: [], now })

    expect(evidence.observations).toEqual([])
    expect(evidence.issues).toEqual(['stale'])
  })

  test('rejects an oversized event file before retaining any event content', async () => {
    const path = join(workspace, 'events.jsonl')
    await writeFile(path, 'x'.repeat(2 * 1024 * 1024 + 1))

    const evidence = await loadWorkloadEvidence({ path, blockedIdentifiers: [], now })

    expect(evidence).toEqual({
      state: 'invalid',
      origin: 'proxy-workload',
      observations: [],
      malformedLines: 0,
      issues: [],
    })
  })
})
