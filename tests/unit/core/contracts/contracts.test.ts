import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  filterApprovedSemanticContracts,
  type SemanticContract,
  inspectSemanticContractDrift,
  loadSemanticContracts,
  renderSemanticContractsMarkdown,
  SemanticContractValidationError,
} from '@/core/contracts'
import { AdapterFactory } from '@/adapters/factory'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

async function writeContracts(value: unknown): Promise<string> {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-contracts-'))
  const filePath = join(workspace, 'dbcli.contracts.json')
  await writeFile(filePath, JSON.stringify(value), 'utf8')
  return filePath
}

const references = new Set(['metric:paid-orders-30d', 'model:customers'])

// Typed rather than inferred: the filtering seam below takes
// `SemanticContract[]`, and an inferred literal widens `status` and
// `evidencePolicy` to `string`, which is not one.
const contractFile: { version: number; contracts: SemanticContract[] } = {
  version: 1,
  contracts: [
    {
      name: 'active-customer',
      status: 'approved',
      description: 'A customer with a paid order in the trailing 30 days.',
      subjects: ['metric:paid-orders-30d', 'model:customers'],
      owner: 'growth',
      aliases: ['active buyer'],
      evidencePolicy: 'verification-required',
    },
  ],
}

describe('semantic contracts', () => {
  test('loads strictly validated contracts in deterministic order', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [
        ...contractFile.contracts,
        {
          name: 'churn-risk',
          status: 'draft',
          description: 'A customer likely to leave soon.',
          subjects: ['model:customers'],
          owner: 'retention',
          evidencePolicy: 'none',
        },
      ],
    })

    const contracts = await loadSemanticContracts({
      workspaceRoot: workspace!,
      filePath,
      references,
    })

    expect(contracts.map((contract) => contract.name)).toEqual(['active-customer', 'churn-risk'])
    expect(contracts[0]?.subjects).toEqual(['metric:paid-orders-30d', 'model:customers'])
    expect(filterApprovedSemanticContracts(contracts).map((contract) => contract.name)).toEqual([
      'active-customer',
    ])
  })

  test('allows an absent file only when requested', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dbcli-contracts-'))

    await expect(loadSemanticContracts({ workspaceRoot: workspace, references })).resolves.toEqual(
      []
    )
    await expect(
      loadSemanticContracts({ workspaceRoot: workspace, references, missingFile: 'error' })
    ).rejects.toThrow(/file not found/)
  })

  test('fails closed for strict shape and unsafe semantic subjects without naming protected terms', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      unexpected: true,
      contracts: [
        {
          ...contractFile.contracts[0],
          subjects: ['model:customers', 'model:customers', 'field:users.password'],
        },
      ],
    })

    await expect(
      loadSemanticContracts({
        workspaceRoot: workspace!,
        filePath,
        references,
        blockedTerms: ['password'],
      })
    ).rejects.toThrow(SemanticContractValidationError)

    try {
      await loadSemanticContracts({
        workspaceRoot: workspace!,
        filePath,
        references,
        blockedTerms: ['password'],
      })
      throw new Error('expected validation failure')
    } catch (error) {
      expect(String(error)).not.toContain('password')
      expect(String(error)).toContain('duplicate subject')
      expect(String(error)).toContain('protected semantic reference')
    }
  })

  test('classifies offline drift without re-reading semantic sources', async () => {
    const filePath = await writeContracts(contractFile)

    await expect(
      inspectSemanticContractDrift({ workspaceRoot: workspace!, filePath, references })
    ).resolves.toEqual({ status: 'valid', issues: [] })
    await expect(
      inspectSemanticContractDrift({
        workspaceRoot: workspace!,
        filePath,
        references: new Set(['model:customers']),
      })
    ).resolves.toMatchObject({ status: 'stale' })
    await expect(
      inspectSemanticContractDrift({
        workspaceRoot: workspace!,
        filePath,
        references,
        referencesAvailable: false,
      })
    ).resolves.toEqual({
      status: 'unavailable',
      issues: [{ path: '$', message: 'semantic reference registry is unavailable' }],
    })

    await rm(filePath)
    await expect(
      inspectSemanticContractDrift({ workspaceRoot: workspace!, filePath, references })
    ).resolves.toEqual({
      status: 'unavailable',
      issues: [{ path: '$', message: 'contract file is unavailable' }],
    })
  })

  test('reports invalid drift without disclosing arbitrary input or creating an adapter', async () => {
    const seededInput = 'contract-input-must-not-leak-9c731'
    const filePath = await writeContracts({
      version: 1,
      contracts: seededInput,
    })
    const adapterSpies = [
      spyOn(AdapterFactory, 'createAdapter'),
      spyOn(AdapterFactory, 'createAdapterWithoutRules'),
      spyOn(AdapterFactory, 'createSqlAdapter'),
      spyOn(AdapterFactory, 'createMongoDBAdapter'),
      spyOn(AdapterFactory, 'createRedisAdapter'),
      spyOn(AdapterFactory, 'createElasticsearchAdapter'),
    ]

    try {
      const report = await inspectSemanticContractDrift({
        workspaceRoot: workspace!,
        filePath,
        references,
      })

      expect(report.status).toBe('invalid')
      expect(report.issues.length).toBeGreaterThan(0)
      expect(JSON.stringify(report)).not.toContain(seededInput)
      for (const adapterSpy of adapterSpies) expect(adapterSpy).not.toHaveBeenCalled()
    } finally {
      for (const adapterSpy of adapterSpies) adapterSpy.mockRestore()
    }
  })

  test('rejects unsupported lifecycle values and accepts canonical field references', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [
        {
          ...contractFile.contracts[0],
          status: 'published',
          evidencePolicy: 'required',
          subjects: ['field:customers.created_at'],
        },
      ],
    })

    await expect(
      loadSemanticContracts({
        workspaceRoot: workspace!,
        filePath,
        references: new Set(['field:customers.created_at']),
      })
    ).rejects.toThrow(/supported status.*supported evidence policy/)
  })

  test('renders normalized contracts deterministically', async () => {
    const filePath = await writeContracts(contractFile)
    const contracts = await loadSemanticContracts({
      workspaceRoot: workspace!,
      filePath,
      references,
    })

    expect(renderSemanticContractsMarkdown(contracts)).toBe(`# Semantic contracts

## active-customer

A customer with a paid order in the trailing 30 days.

- Status: approved
- Owner: growth
- Evidence policy: verification-required
- Subjects: \`metric:paid-orders-30d\`, \`model:customers\`
- Aliases: active buyer

`)
  })

  // DBCLI-011 R1: a noncanonical subject is now a form issue, so the two
  // subjects below fail for two different, separately actionable reasons.
  test('fails closed for malformed subjects, unknown subjects, and markdown-shaped text', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [
        {
          ...contractFile.contracts[0],
          description: 'Normal definition.\n# injected heading',
          subjects: ['customers', 'model:unknown'],
        },
      ],
    })

    await expect(
      loadSemanticContracts({ workspaceRoot: workspace!, filePath, references })
    ).rejects.toThrow(
      /bounded plain text.*supported semantic subject form.*available semantic entity/
    )
  })

  test('uses semantic blacklist boundaries instead of substring matching plain text', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [
        {
          ...contractFile.contracts[0],
          description: 'An ordinary customer with recent activity.',
          subjects: ['model:customers'],
        },
      ],
    })

    await expect(
      loadSemanticContracts({
        workspaceRoot: workspace!,
        filePath,
        references,
        blockedTerms: ['order'],
      })
    ).resolves.toHaveLength(1)
  })

  test('reports an unsupported property without reproducing the rejected key', async () => {
    const seededKey = 'SECRET-9f21-/Users/example/private/leak.txt'
    const filePath = await writeContracts({
      ...contractFile,
      [seededKey]: 'x',
      contracts: [{ ...contractFile.contracts[0], [seededKey]: 'x' }],
    })

    const report = await inspectSemanticContractDrift({
      workspaceRoot: workspace!,
      filePath,
      references,
    })

    expect(report.status).toBe('invalid')
    expect(JSON.stringify(report)).not.toContain(seededKey)
    expect(JSON.stringify(report)).not.toContain('SECRET')
    expect(report.issues.map((entry) => entry.path)).toEqual(['$', '$.contracts[0]'])
    expect(report.issues[0]?.message).toContain('version, contracts')

    await expect(
      loadSemanticContracts({ workspaceRoot: workspace!, filePath, references })
    ).rejects.toThrow(/must contain only/)
  })

  test('classifies an unsupported subject form as invalid rather than stale', async () => {
    const seededSubject = 'table:customers--DROP'
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [{ ...contractFile.contracts[0], subjects: [seededSubject] }],
    })

    const report = await inspectSemanticContractDrift({
      workspaceRoot: workspace!,
      filePath,
      references,
    })

    expect(report.status).toBe('invalid')
    expect(JSON.stringify(report)).not.toContain(seededSubject)
    expect(report.issues).toEqual([
      {
        path: '$.contracts[0].subjects[0]',
        message: 'must use a supported semantic subject form',
      },
    ])
  })

  test('keeps a well-formed but absent subject stale, not invalid', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [{ ...contractFile.contracts[0], subjects: ['model:renamed-customers'] }],
    })

    await expect(
      inspectSemanticContractDrift({ workspaceRoot: workspace!, filePath, references })
    ).resolves.toEqual({
      status: 'stale',
      issues: [
        {
          path: '$.contracts[0].subjects[0]',
          message: 'must reference an available semantic entity',
        },
      ],
    })
  })

  test('accepts every field subject the semantic registry can emit', async () => {
    // Column names come from the visible schema, not from an identifier
    // grammar: hyphens, dots, and non-ASCII all reach the registry. A form
    // check narrower than this would fail an artifact that is not stale.
    const registryEmitted = [
      'field:orders.first-name',
      'field:orders.user.email',
      'field:orders.cr\u00e9\u00e9',
      'field:orders.created_at',
    ]
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [{ ...contractFile.contracts[0], subjects: registryEmitted }],
    })

    await expect(
      inspectSemanticContractDrift({
        workspaceRoot: workspace!,
        filePath,
        references: new Set(registryEmitted),
      })
    ).resolves.toEqual({ status: 'valid', issues: [] })
  })

  test('reports a malformed subject once, not twice', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [{ ...contractFile.contracts[0], subjects: ['table:customers'] }],
    })

    try {
      await loadSemanticContracts({ workspaceRoot: workspace!, filePath, references })
      throw new Error('expected validation failure')
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticContractValidationError)
      expect((error as SemanticContractValidationError).issues).toEqual([
        {
          path: '$.contracts[0].subjects[0]',
          message: 'must use a supported semantic subject form',
        },
      ])
    }
  })

  test('still names a protected identifier when the subject form is also wrong', async () => {
    const filePath = await writeContracts({
      ...contractFile,
      contracts: [{ ...contractFile.contracts[0], subjects: ['table:secrets'] }],
    })

    await expect(
      inspectSemanticContractDrift({
        workspaceRoot: workspace!,
        filePath,
        references,
        blockedTerms: ['secrets'],
      })
    ).resolves.toMatchObject({
      status: 'invalid',
      issues: [
        {
          path: '$.contracts[0].subjects[0]',
          message: 'must use a supported semantic subject form',
        },
      ],
    })

    await expect(
      loadSemanticContracts({
        workspaceRoot: workspace!,
        filePath,
        references,
        blockedTerms: ['secrets'],
      })
    ).rejects.toThrow(/protected semantic reference/)
  })

  test('sorts approved contracts at the public filtering seam', () => {
    const approved = filterApprovedSemanticContracts([
      { ...contractFile.contracts[0]!, name: 'zebra', aliases: [] },
      { ...contractFile.contracts[0]!, name: 'archer', aliases: [] },
      { ...contractFile.contracts[0]!, status: 'deprecated', aliases: [] },
    ])

    expect(approved.map((contract) => contract.name)).toEqual(['archer', 'zebra'])
  })
})
