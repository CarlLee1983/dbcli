import { describe, test, expect } from 'bun:test'
import { qMongoBranch } from '@/commands/q-mongo'

describe('qMongoBranch', () => {
  test('throws when collection cannot be resolved', async () => {
    const snippet = {
      query: {
        meta: {
          key: '@t',
          name: 't',
          params: [],
          tags: [],
          engine: ['mongodb'],
        },
        sqlBody: '{}',
        file: '/tmp/t.mongodb.sql',
        source: 'shared',
      },
      hasLocalOverride: false,
    } as any
    const prepared = {
      driver: { sql: '{}', values: [] },
      rewrittenBody: '{}',
      warnings: [],
      execHints: {},
    } as any
    await expect(
      qMongoBranch(snippet, prepared, {}, { connection: { system: 'mongodb' } } as any)
    ).rejects.toThrow(/collection/)
  })
})
