import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSemanticContext,
  SemanticValidationError,
  type SemanticSchemaTable,
} from '@/core/semantic'

const schema: Record<string, SemanticSchemaTable> = {
  orders: { columns: [{ name: 'id' }, { name: 'total' }, { name: 'created_at' }] },
}
const snippets = [{ key: '@analytics/revenue' }]
const workspaces: string[] = []

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), 'dbcli-semantic-'))
  workspaces.push(path)
  return path
}

async function writeSemantic(root: string, value: unknown): Promise<string> {
  const path = join(root, 'dbcli.semantic.json')
  await Bun.file(path).write(JSON.stringify(value, null, 2))
  return path
}

const valid = {
  version: 1,
  models: [
    {
      name: 'orders',
      table: 'orders',
      description: 'Completed purchases.',
      aliases: ['purchases'],
      fields: [{ column: 'created_at', aliases: ['order date'] }],
    },
  ],
  metrics: [{ name: 'daily-revenue', description: 'Revenue by day.', query: '@analytics/revenue' }],
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('semantic context', () => {
  test('loads a bounded context from visible schema and saved query names', async () => {
    const root = workspace()
    await writeSemantic(root, valid)

    await expect(loadSemanticContext({ workspaceRoot: root, schema, snippets })).resolves.toEqual({
      version: 1,
      models: [
        {
          name: 'orders',
          table: 'orders',
          description: 'Completed purchases.',
          aliases: ['purchases'],
          fields: [{ column: 'created_at', aliases: ['order date'] }],
        },
      ],
      metrics: [
        { name: 'daily-revenue', description: 'Revenue by day.', query: '@analytics/revenue' },
      ],
    })
  })

  test('allows an absent default file only when requested', async () => {
    const root = workspace()

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets, missingFile: 'allow' })
    ).resolves.toBeNull()
    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toBeInstanceOf(SemanticValidationError)
  })

  test('rejects malformed JSON before interpreting a semantic context', async () => {
    const root = workspace()
    await Bun.file(join(root, 'dbcli.semantic.json')).write('{not-json')

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: '$' })],
    })
  })

  test('rejects unknown and blacklisted table or column references', async () => {
    const root = workspace()
    await writeSemantic(root, {
      ...valid,
      models: [
        { ...valid.models[0], table: 'users', fields: [{ column: 'password', aliases: [] }] },
        { ...valid.models[0], name: 'orders-copy', fields: [{ column: 'secret', aliases: [] }] },
      ],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '$.models[0].table' }),
        expect.objectContaining({ path: '$.models[1].fields[0].column' }),
      ]),
    })
  })

  test('rejects unknown metrics, duplicate field columns, and unsupported properties', async () => {
    const root = workspace()
    await writeSemantic(root, {
      ...valid,
      unexpected: true,
      models: [
        {
          ...valid.models[0],
          fields: [
            { column: 'total', aliases: [] },
            { column: 'total', aliases: [] },
          ],
        },
      ],
      metrics: [{ ...valid.metrics[0], query: '@missing' }],
    })

    await expect(
      loadSemanticContext({ workspaceRoot: root, schema, snippets })
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: '$.unexpected' }),
        expect.objectContaining({
          path: '$.models[0].fields[1].column',
          message: 'must be unique',
        }),
        expect.objectContaining({ path: '$.metrics[0].query' }),
      ]),
    })
  })
})
