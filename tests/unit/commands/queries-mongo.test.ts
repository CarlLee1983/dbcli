import { describe, test, expect } from 'bun:test'
import { listSnippetsForEngine } from '@/commands/queries'

const make = (key: string, engine: string) => ({
  query: {
    meta: { key, name: key, engine: [engine], params: [], tags: [] },
    sqlBody: '{}',
    file: `/tmp/${key}.${engine}.sql`,
    source: 'builtin',
  },
  hasLocalOverride: false,
})

describe('queries listing for mongo', () => {
  test('list returns mongo snippets when engine=mongodb', () => {
    const snippets = new Map<string, any[]>([
      ['@a', [make('@a', 'mongodb')]],
      ['@b', [make('@b', 'mysql')]],
    ])
    const out = listSnippetsForEngine(snippets, 'mongodb' as any)
    expect(out.map((s) => s.query.meta.key)).toEqual(['@a'])
  })

  test('list returns mysql snippets when engine=mysql', () => {
    const snippets = new Map<string, any[]>([
      ['@a', [make('@a', 'mongodb')]],
      ['@b', [make('@b', 'mysql')]],
    ])
    const out = listSnippetsForEngine(snippets, 'mysql' as any)
    expect(out.map((s) => s.query.meta.key)).toEqual(['@b'])
  })
})
