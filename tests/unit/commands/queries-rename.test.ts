import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queriesRename } from '@/commands/queries-rename'

let tmp = ''

describe('queries rename', () => {
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'queries-rename-'))
    await mkdir(join(tmp, '.dbcli/queries'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('renames a local snippet file and updates frontmatter name', async () => {
    const src = join(tmp, '.dbcli/queries/old.sql')
    await writeFile(src, '-- ---\n-- name: Old\n-- ---\nSELECT 1;\n')
    await queriesRename('@old', '@new', { cwd: tmp, force: true })
    const dst = join(tmp, '.dbcli/queries/new.sql')
    expect(await Bun.file(src).exists()).toBe(false)
    const text = await Bun.file(dst).text()
    expect(text).toContain('name: new')
  })

  test('refuses if target already exists', async () => {
    await writeFile(join(tmp, '.dbcli/queries/a.sql'), '-- ---\n-- name: a\n-- ---\nSELECT 1;\n')
    await writeFile(join(tmp, '.dbcli/queries/b.sql'), '-- ---\n-- name: b\n-- ---\nSELECT 1;\n')
    await expect(queriesRename('@a', '@b', { cwd: tmp, force: true })).rejects.toThrow(/exists/)
  })

  test('preserves engine suffix on rename', async () => {
    const src = join(tmp, '.dbcli/queries/x.postgres.sql')
    await writeFile(src, '-- ---\n-- name: x\n-- engine: postgres\n-- ---\nSELECT 1;\n')
    await queriesRename('@x', '@y', { cwd: tmp, force: true })
    expect(await Bun.file(src).exists()).toBe(false)
    expect(await Bun.file(join(tmp, '.dbcli/queries/y.postgres.sql')).exists()).toBe(true)
  })
})
