import { describe, expect, test } from 'bun:test'
import {
  buildBackfillArtifact,
  generateBackfillSql,
  parseBackfillSourceManifest,
} from '@/core/backfill-artifact'

const source = {
  name: 'catalog',
  environment: 'demo',
  permission: 'query-only',
  system: 'postgresql',
  server: { host: 'demo.db', port: 5432 },
  database: 'catalog',
} as const

const target = {
  ...source,
  name: 'production',
  environment: 'prod',
  permission: 'read-write',
  server: { host: 'prod.db', port: 5432 },
  database: 'app',
} as const

describe('source-to-SQL backfill artifact', () => {
  test('generates bounded UPDATE statements and a dry-run/read-back workflow', () => {
    const manifest = parseBackfillSourceManifest({
      table: 'accounts',
      keyColumns: ['id'],
      rows: [
        { id: 7, tier: "pro's", active: true },
        { id: 8, tier: 'free', active: false },
      ],
      verifyQuery: 'SELECT count(*) AS n FROM accounts WHERE tier IS NULL',
      expect: 'value == 0',
    })
    expect(generateBackfillSql(manifest)).toEqual([
      "UPDATE accounts SET tier = 'pro''s', active = TRUE WHERE id = 7",
      "UPDATE accounts SET tier = 'free', active = FALSE WHERE id = 8",
    ])
    const artifact = buildBackfillArtifact({
      manifest,
      sourcePath: '/tmp/catalog.json',
      sourceContent: JSON.stringify(manifest),
      sourceIdentity: source,
      targetIdentity: target,
      now: new Date('2026-08-04T00:00:00.000Z'),
    })
    expect(artifact.execution.mode).toBe('dry-run')
    expect(artifact.execution.requiresHumanConfirmation).toBe(true)
    expect(artifact.identityDiff).toEqual([
      'environment: demo -> prod',
      'database: catalog -> app',
      'server: demo.db:5432 -> prod.db:5432',
    ])
    expect(artifact.preflight).toContain('dbcli --use production schema accounts --format json')
    expect(artifact.readBack.command).toContain('verify safe-backfill')
    expect(artifact.statements).toHaveLength(2)
  })

  test('rejects unbounded sources and keyless updates', () => {
    expect(() =>
      parseBackfillSourceManifest({
        table: 'x',
        keyColumns: [],
        rows: [{}],
        verifyQuery: 'SELECT 1',
        expect: 'value == 1',
      })
    ).toThrow('keyColumns')
    expect(() =>
      parseBackfillSourceManifest({
        table: 'x',
        keyColumns: ['id'],
        rows: [{ id: 1 }],
        verifyQuery: 'SELECT 1',
        expect: 'value == 1',
      })
    ).not.toThrow()
    const manifest = parseBackfillSourceManifest({
      table: 'x',
      keyColumns: ['id'],
      rows: [{ id: 1 }],
      verifyQuery: 'SELECT 1',
      expect: 'value == 1',
    })
    expect(() => generateBackfillSql(manifest)).toThrow('no non-key columns')
  })

  test('uses injection-safe string literals for MySQL-family artifacts', () => {
    const manifest = parseBackfillSourceManifest({
      table: 'accounts',
      keyColumns: ['id'],
      rows: [{ id: 7, tier: "\\\\'; DROP TABLE accounts; --" }],
      verifyQuery: 'SELECT 1',
      expect: 'value == 1',
    })

    for (const system of ['mysql', 'mariadb'] as const) {
      expect(generateBackfillSql(manifest, system)).toEqual([
        "UPDATE accounts SET tier = CONVERT(UNHEX('5c5c273b2044524f50205441424c45206163636f756e74733b202d2d') USING utf8mb4) WHERE id = 7",
      ])
    }

    const artifact = buildBackfillArtifact({
      manifest,
      sourcePath: '/tmp/catalog.json',
      sourceContent: '{}',
      sourceIdentity: source,
      targetIdentity: { ...target, system: 'mysql' },
    })
    expect(artifact.statements[0]?.sql).toContain("CONVERT(UNHEX('5c5c27")
  })

  test('rejects a write-capable or multi-statement read-back query', () => {
    const base = {
      table: 'accounts',
      keyColumns: ['id'],
      rows: [{ id: 1, tier: 'free' }],
      expect: 'value == 0',
    }
    expect(() =>
      parseBackfillSourceManifest({ ...base, verifyQuery: "UPDATE accounts SET tier = 'x'" })
    ).toThrow(/read-only|write/i)
    expect(() =>
      parseBackfillSourceManifest({ ...base, verifyQuery: 'SELECT 1; DELETE FROM accounts' })
    ).toThrow(/single plain|write/i)
  })

  test('quotes hostile connection names and rejects non-SQL targets', () => {
    const manifest = parseBackfillSourceManifest({
      table: 'accounts',
      keyColumns: ['id'],
      rows: [{ id: 1, tier: 'free' }],
      verifyQuery: 'SELECT 1',
      expect: 'value == 1',
    })
    const hostileTarget = { ...target, name: 'prod; touch /tmp/dbcli-pwned' }
    const artifact = buildBackfillArtifact({
      manifest,
      sourcePath: '/tmp/catalog.json',
      sourceContent: '{}',
      sourceIdentity: source,
      targetIdentity: hostileTarget,
    })
    expect(artifact.statements[0]?.planCommand).toContain("--use 'prod; touch /tmp/dbcli-pwned'")

    expect(() =>
      buildBackfillArtifact({
        manifest,
        sourcePath: '/tmp/catalog.json',
        sourceContent: '{}',
        sourceIdentity: source,
        targetIdentity: { ...target, system: 'mongodb' },
      })
    ).toThrow(/require a SQL target connection/)
  })
})
