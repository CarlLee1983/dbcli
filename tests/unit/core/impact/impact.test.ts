import { describe, expect, test } from 'bun:test'
import { assessImpact, type ImpactAssessmentInput } from '@/core/impact'
import type { NormalizedChangeSet } from '@/core/orm-drift/change-set'

const changes: NormalizedChangeSet = {
  scope: { key: 'production', system: 'postgresql', connection: 'primary' },
  origins: { declared: 'dbcli.design.json', baseline: 'schema-cache' },
  changes: [
    {
      id: 'change:accounts.email:remove',
      operation: 'remove',
      objectKind: 'column',
      subject: {
        scopeKey: 'production',
        system: 'postgresql',
        connection: 'primary',
        schema: 'public',
        table: 'accounts',
        column: 'email',
      },
      source: { baseline: 'schema-cache#public.accounts.columns.email' },
    },
  ],
  coverage: { level: 'declared', gaps: [] },
}

function input(overrides: Partial<ImpactAssessmentInput> = {}): ImpactAssessmentInput {
  return {
    changes,
    semantic: {
      state: 'available',
      origin: 'dbcli.semantic.json',
      value: {
        version: 2,
        models: [
          {
            name: 'account',
            table: 'accounts',
            aliases: [],
            fields: [{ column: 'email', aliases: [] }],
          },
        ],
        relationships: [],
        metrics: [{ name: 'active-accounts', query: '@active-accounts' }],
      },
    },
    contracts: {
      state: 'available',
      origin: 'dbcli.contracts.json',
      value: [
        {
          name: 'account-contactability',
          status: 'approved',
          description: 'Account contact state',
          subjects: ['field:account.email', 'metric:active-accounts'],
          owner: 'data',
          aliases: [],
          evidencePolicy: 'verification-required',
        },
      ],
    },
    savedQueries: {
      state: 'available',
      origin: 'saved-query-index',
      value: ['@active-accounts'],
    },
    verifications: {
      state: 'available',
      origin: 'verification-artifacts',
      value: [
        {
          id: 'verification-1',
          createdAt: '2026-08-08T00:00:00.000Z',
          status: 'verified',
          subject: { kind: 'table', name: 'public.accounts' },
          location: 'verification:verification-1',
        },
      ],
    },
    dataAccess: {
      state: 'available',
      origin: 'dbcli.data-access.json',
      value: [],
    },
    observedWorkload: {
      state: 'absent',
      origin: 'proxy-workload',
      observations: [],
      malformedLines: 0,
      issues: [],
    },
    blockedIdentifiers: [],
    ...overrides,
  }
}

describe('assessImpact', () => {
  test('traverses physical changes through approved contracts to known saved queries', () => {
    const report = assessImpact(input())

    expect(report.findings.map((finding) => finding.code)).toEqual([
      'AFFECTED_SEMANTIC_FIELD',
      'AFFECTED_SEMANTIC_CONTRACT',
      'AFFECTED_SAVED_QUERY',
      'AFFECTED_VERIFICATION',
    ])
    expect(report.findings.every((finding) => finding.changeId === 'change:accounts.email:remove')).toBe(true)
    expect(report.recommendedVerification).toEqual([
      {
        changeId: 'change:accounts.email:remove',
        policy: 'verification-required',
        source: { artifact: 'dbcli.contracts.json', selector: 'contract:account-contactability' },
      },
    ])
  })

  test('is cycle-safe and deterministic across semantic input order', () => {
    const semantic = input().semantic
    if (semantic.state !== 'available') throw new Error('test setup')
    semantic.value.relationships = [
      {
        name: 'account-self',
        from: { model: 'account', field: 'email' },
        to: { model: 'account', field: 'email' },
        cardinality: 'one-to-one',
      },
    ]
    const report = assessImpact({ ...input(), semantic })

    expect(report.findings.map((finding) => finding.id)).toEqual(
      [...report.findings.map((finding) => finding.id)].sort()
    )
    expect(report.findings.filter((finding) => finding.code === 'AFFECTED_SEMANTIC_RELATIONSHIP')).toHaveLength(1)
  })

  test('maps index and foreign-key changes through their owning table model', () => {
    const report = assessImpact(
      input({
        changes: {
          ...changes,
          changes: [
            {
              ...changes.changes[0]!,
              objectKind: 'index',
              subject: { ...changes.changes[0]!.subject, column: undefined },
            },
          ],
        },
      })
    )

    expect(report.findings.map((finding) => finding.code)).toContain('AFFECTED_SEMANTIC_MODEL')
  })

  test('emits one stable warning for each affected declared access operation', () => {
    const report = assessImpact(
      input({
        dataAccess: {
          state: 'available',
          origin: 'dbcli.data-access.json',
          value: [
            {
              name: 'accounts.lookup',
              kind: 'read',
              source: 'src/accounts.ts',
              references: ['field:account.email', 'model:account'],
              coverage: 'declared',
            },
            {
              name: 'unrelated',
              kind: 'write',
              source: 'src/other.ts',
              references: ['metric:other'],
              coverage: 'declared',
            },
          ],
        },
      })
    )

    expect(report.findings.filter((finding) => finding.code === 'AFFECTED_DECLARED_ACCESS_OPERATION')).toEqual([
      expect.objectContaining({
        severity: 'warn',
        location: { artifact: 'src/accounts.ts', selector: 'data-access:read:accounts.lookup' },
      }),
    ])
    expect(report.coverage.gaps).toContainEqual(
      expect.objectContaining({ code: 'DATA_ACCESS_DYNAMIC_OR_UNLISTED' })
    )
  })

  test('adds advisory observed workload warnings without depending on semantic evidence', () => {
    const report = assessImpact(
      input({
        semantic: { state: 'absent', origin: 'dbcli.semantic.json', reason: 'missing' },
        observedWorkload: {
          state: 'available',
          origin: 'proxy-workload',
          observations: [{ tables: ['accounts'] }],
          malformedLines: 0,
          issues: [],
          timeframe: { from: '2026-08-07T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' },
        },
      })
    )

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'AFFECTED_OBSERVED_WORKLOAD',
        severity: 'warn',
        location: { artifact: 'proxy-workload', selector: 'observed-table:public.accounts' },
      })
    )
  })

  test('maps every workload evidence quality issue to visible coverage without exposing protected references', () => {
    const report = assessImpact(
      input({
        observedWorkload: {
          state: 'available',
          origin: 'proxy-workload',
          observations: [],
          malformedLines: 1,
          issues: ['malformed', 'stale', 'redaction-failed', 'redacted-protected-subject'],
        },
      })
    )

    expect(report.coverage.gaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining([
        'WORKLOAD_MALFORMED',
        'WORKLOAD_STALE',
        'WORKLOAD_REDACTION_FAILED',
        'WORKLOAD_PROTECTED_REFERENCE_OMITTED',
      ])
    )
  })

  test('reports the count of safe observed table references rather than aggregate objects', () => {
    const report = assessImpact(
      input({
        observedWorkload: {
          state: 'available',
          origin: 'proxy-workload',
          observations: [{ tables: ['accounts', 'orders'] }],
          malformedLines: 0,
          issues: [],
        },
      })
    )

    expect(report.observedWorkload.tableReferenceCount).toBe(2)
  })

  test('redacts protected declared operation metadata and records the omission', () => {
    const report = assessImpact(
      input({
        blockedIdentifiers: ['private-access'],
        dataAccess: {
          state: 'available',
          origin: 'dbcli.data-access.json',
          value: [
            {
              name: 'private-access',
              kind: 'read',
              source: 'src/accounts.ts',
              references: ['field:account.email'],
              coverage: 'declared',
            },
          ],
        },
      })
    )

    expect(JSON.stringify(report)).not.toContain('private-access')
    expect(report.coverage.gaps).toContainEqual(
      expect.objectContaining({ code: 'REDACTED_PROTECTED_SUBJECT' })
    )
  })

  test('makes missing sources and inherited normalization uncertainty visible without claiming complete coverage', () => {
    const partialChanges: NormalizedChangeSet = {
      ...changes,
      coverage: {
        level: 'partial',
        gaps: [
          {
            kind: 'unsupported',
            side: 'baseline',
            location: 'private source location',
            reason: 'private parser detail',
          },
        ],
      },
    }
    const report = assessImpact(
      input({
        changes: partialChanges,
        savedQueries: { state: 'absent', origin: 'saved-query-index', reason: 'missing' },
      })
    )

    expect(report.coverage).toMatchObject({ level: 'partial' })
    expect(report.coverage.gaps.map((gap) => gap.code)).toEqual([
      'DATA_ACCESS_DYNAMIC_OR_UNLISTED',
      'NORMALIZATION_PARTIAL',
      'SAVED_QUERIES_ABSENT',
      'WORKLOAD_ABSENT',
    ])
    expect(JSON.stringify(report)).not.toContain('private source location')
    expect(JSON.stringify(report)).not.toContain('private parser detail')
  })

  test('omits protected subjects and reports a redacted coverage gap', () => {
    const report = assessImpact(input({ blockedIdentifiers: ['accounts'] }))

    expect(report.findings).toEqual([])
    expect(report.coverage.gaps).toContainEqual(
      expect.objectContaining({ code: 'REDACTED_PROTECTED_SUBJECT' })
    )
    expect(JSON.stringify(report)).not.toContain('accounts')
  })

  test('redacts protected scope metadata before returning the report', () => {
    const protectedChanges: NormalizedChangeSet = {
      ...changes,
      scope: { ...changes.scope, key: 'restricted-scope', environment: 'restricted-scope' },
      changes: changes.changes.map((change) => ({
        ...change,
        subject: { ...change.subject, scopeKey: 'restricted-scope' },
      })),
    }
    const report = assessImpact(input({ changes: protectedChanges, blockedIdentifiers: ['restricted-scope'] }))

    expect(report.scope).toMatchObject({ key: '[redacted]', environment: '[redacted]' })
    expect(JSON.stringify(report)).not.toContain('restricted-scope')
  })

  test('keeps safe verification findings when semantic evidence is absent', () => {
    const report = assessImpact(input({ semantic: { state: 'absent', origin: 'dbcli.semantic.json', reason: 'missing' } }))

    expect(report.findings.map((finding) => finding.code)).toEqual(['AFFECTED_VERIFICATION'])
    expect(report.coverage.gaps).toContainEqual(expect.objectContaining({ code: 'SEMANTIC_ABSENT' }))
  })

  test('marks filtered evidence as a visible redaction gap', () => {
    const report = assessImpact(
      input({ verifications: { state: 'available', origin: 'verification-artifacts', redacted: true, value: [] } })
    )

    expect(report.coverage.gaps).toContainEqual(
      expect.objectContaining({ code: 'REDACTED_PROTECTED_SUBJECT' })
    )
  })

  test('omits protected physical object keys and evidence origins', () => {
    const protectedChanges: NormalizedChangeSet = {
      ...changes,
      changes: changes.changes.map((change) => ({
        ...change,
        id: 'change:secret-index',
        objectKind: 'index',
        subject: { ...change.subject, column: undefined, objectKey: 'secret-index' },
      })),
    }
    const report = assessImpact(
      input({
        changes: protectedChanges,
        blockedIdentifiers: ['secret-index', 'semantic-origin'],
        semantic: { ...input().semantic, origin: 'semantic-origin' },
      })
    )

    expect(report.findings).toEqual([])
    expect(JSON.stringify(report)).not.toContain('secret-index')

    const safeChangeReport = assessImpact(
      input({
        blockedIdentifiers: ['semantic-origin'],
        semantic: { ...input().semantic, origin: 'semantic-origin' },
      })
    )
    expect(safeChangeReport.findings[0]?.location.artifact).toBe('local-artifact')
    expect(JSON.stringify(safeChangeReport)).not.toContain('semantic-origin')
  })
})
