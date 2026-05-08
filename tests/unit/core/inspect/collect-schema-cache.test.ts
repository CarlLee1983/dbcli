import { describe, test, expect, beforeEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSchemaCache } from '@/core/inspect/collect-schema-cache'

describe('collectSchemaCache', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'inspect-cache-'))
  })

  test('absent index.json → unavailable=false, available=false', async () => {
    const out = await collectSchemaCache({ dbcliPath: dir })
    expect(out.section.available).toBe(false)
    expect(out.section.unavailable).toBeUndefined()
  })

  test('fresh index → not stale, totalTables echoed', async () => {
    await mkdir(join(dir, 'schemas'), { recursive: true })
    await writeFile(
      join(dir, 'schemas', 'index.json'),
      JSON.stringify({
        tables: {},
        hotTables: [],
        metadata: {
          version: '1',
          lastRefreshed: new Date().toISOString(),
          totalTables: 12,
        },
      })
    )
    const out = await collectSchemaCache({ dbcliPath: dir })
    expect(out.section.available).toBe(true)
    expect(out.section.stale).toBe(false)
    expect(out.section.totalTables).toBe(12)
  })

  test('old index → stale=true', async () => {
    await mkdir(join(dir, 'schemas'), { recursive: true })
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    await writeFile(
      join(dir, 'schemas', 'index.json'),
      JSON.stringify({
        tables: {},
        hotTables: [],
        metadata: { version: '1', lastRefreshed: old, totalTables: 1 },
      })
    )
    const out = await collectSchemaCache({ dbcliPath: dir })
    expect(out.section.stale).toBe(true)
  })

  test('non-SQL system → unavailable with reason', async () => {
    const out = await collectSchemaCache({ dbcliPath: dir, system: 'redis' })
    expect(out.section.unavailable).toBe(true)
    expect(out.section.reason).toMatch(/not supported|sql-only/i)
  })
})
