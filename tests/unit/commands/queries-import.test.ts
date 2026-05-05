import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queriesImport } from '@/commands/queries-import'

let tmp = ''
let extDir = ''

describe('queries import', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'queries-import-'))
    extDir = mkdtempSync(join(tmpdir(), 'queries-import-ext-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(extDir, { recursive: true, force: true })
  })

  test('imports a valid sql file into local with derived name', async () => {
    const src = join(extDir, 'my-snippet.sql')
    await writeFile(src, '-- ---\n-- name: External\n-- engine: postgres\n-- ---\nSELECT 1;\n')
    await queriesImport(src, { cwd: tmp, force: true })
    expect(await Bun.file(join(tmp, '.dbcli/queries/my-snippet.sql')).exists()).toBe(true)
  })

  test('rejects file with invalid frontmatter', async () => {
    const src = join(extDir, 'bad.sql')
    await writeFile(src, 'INSERT INTO foo VALUES (1);')
    await expect(queriesImport(src, { cwd: tmp, force: true })).rejects.toThrow(/SELECT/i)
  })
})
