import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DataAccessManifestValidationError,
  loadDataAccessManifest,
  normalizeDataAccessManifest,
} from '@/core/data-access'

const references = new Set(['model:orders', 'field:orders.customer_id', 'metric:active-orders'])

describe('data-access manifest', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dbcli-data-access-'))
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'orders.ts'), 'export {}\n')
  })

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('normalizes valid operations deterministically without reading source contents', async () => {
    const operations = await normalizeDataAccessManifest(
      {
        version: 1,
        operations: [
          {
            name: 'orders.list',
            source: 'src/orders.ts',
            kind: 'read',
            references: ['field:orders.customer_id', 'model:orders'],
            coverage: 'declared',
          },
        ],
      },
      { workspaceRoot: workspace, references }
    )

    expect(operations).toEqual([
      {
        name: 'orders.list',
        source: 'src/orders.ts',
        kind: 'read',
        references: ['field:orders.customer_id', 'model:orders'],
        coverage: 'declared',
      },
    ])
  })

  test('rejects duplicate names, unknown references, and missing declared coverage without exposing protected text', async () => {
    await expect(
      normalizeDataAccessManifest(
        {
          version: 1,
          operations: [
            {
              name: 'orders.list',
              source: 'src/orders.ts',
              kind: 'read',
              references: ['model:orders'],
            },
            {
              name: 'orders.list',
              source: 'src/orders.ts',
              kind: 'write',
              references: ['secret-subject'],
              coverage: 'declared',
            },
          ],
        },
        { workspaceRoot: workspace, references, blockedTerms: ['secret-subject'] }
      )
    ).rejects.toBeInstanceOf(DataAccessManifestValidationError)
    try {
      await normalizeDataAccessManifest(
        {
          version: 1,
          operations: [
            {
              name: 'safe',
              source: 'src/orders.ts',
              kind: 'read',
              references: ['secret-subject'],
              coverage: 'declared',
            },
          ],
        },
        { workspaceRoot: workspace, references, blockedTerms: ['secret-subject'] }
      )
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('secret-subject')
    }
  })

  test('rejects a noncanonical reference even when a caller includes it in the registry', async () => {
    await expect(
      normalizeDataAccessManifest(
        {
          version: 1,
          operations: [
            {
              name: 'invalid',
              source: 'src/orders.ts',
              kind: 'read',
              references: ['not:a-canonical-reference'],
              coverage: 'declared',
            },
          ],
        },
        { workspaceRoot: workspace, references: new Set(['not:a-canonical-reference']) }
      )
    ).rejects.toBeInstanceOf(DataAccessManifestValidationError)
  })

  test('rejects traversal and source symlinks outside the workspace', async () => {
    const external = await mkdtemp(join(tmpdir(), 'dbcli-data-access-external-'))
    try {
      await writeFile(join(external, 'outside.ts'), 'export {}\n')
      await symlink(join(external, 'outside.ts'), join(workspace, 'src', 'outside.ts'))
      for (const source of ['../outside.ts', 'src/outside.ts']) {
        await expect(
          normalizeDataAccessManifest(
            {
              version: 1,
              operations: [
                {
                  name: source,
                  source,
                  kind: 'read',
                  references: ['model:orders'],
                  coverage: 'declared',
                },
              ],
            },
            { workspaceRoot: workspace, references }
          )
        ).rejects.toBeInstanceOf(DataAccessManifestValidationError)
      }
    } finally {
      await rm(external, { recursive: true, force: true })
    }
  })

  test('rejects a manifest symlink before reading an external file', async () => {
    const external = await mkdtemp(join(tmpdir(), 'dbcli-data-access-manifest-'))
    try {
      const externalManifest = join(external, 'manifest.json')
      await writeFile(externalManifest, JSON.stringify({ version: 1, operations: [] }))
      await symlink(externalManifest, join(workspace, 'dbcli.data-access.json'))

      await expect(
        loadDataAccessManifest({ workspaceRoot: workspace, references, missingFile: 'error' })
      ).rejects.toBeInstanceOf(DataAccessManifestValidationError)
    } finally {
      await rm(external, { recursive: true, force: true })
    }
  })

  test('treats the optional missing manifest as empty only when allowed', async () => {
    await expect(loadDataAccessManifest({ workspaceRoot: workspace, references })).resolves.toEqual(
      []
    )
    await expect(
      loadDataAccessManifest({ workspaceRoot: workspace, references, missingFile: 'error' })
    ).rejects.toBeInstanceOf(DataAccessManifestValidationError)
  })
})
