import { afterEach, describe, expect, test } from 'bun:test'
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

  test('fails closed for unknown or noncanonical subjects and markdown-shaped text', async () => {
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
    ).rejects.toThrow(/bounded plain text.*available semantic entity.*available semantic entity/)
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

  test('sorts approved contracts at the public filtering seam', () => {
    const approved = filterApprovedSemanticContracts([
      { ...contractFile.contracts[0]!, name: 'zebra', aliases: [] },
      { ...contractFile.contracts[0]!, name: 'archer', aliases: [] },
      { ...contractFile.contracts[0]!, status: 'deprecated', aliases: [] },
    ])

    expect(approved.map((contract) => contract.name)).toEqual(['archer', 'zebra'])
  })
})
