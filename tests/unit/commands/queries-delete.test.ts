import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queriesDelete } from '@/commands/queries-delete'

let tmp = ''

describe('queries delete', () => {
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'queries-delete-'))
    await mkdir(join(tmp, '.dbcli/queries'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('removes a local snippet file', async () => {
    const file = join(tmp, '.dbcli/queries/foo.sql')
    await writeFile(file, '-- ---\n-- name: foo\n-- ---\nSELECT 1;\n')
    await queriesDelete('@foo', { force: true, cwd: tmp })
    expect(await Bun.file(file).exists()).toBe(false)
  })

  test('refuses to delete shared snippet', async () => {
    await mkdir(join(tmp, '.dbcli-shared/queries'), { recursive: true })
    await writeFile(
      join(tmp, '.dbcli-shared/queries/bar.sql'),
      '-- ---\n-- name: bar\n-- ---\nSELECT 1;\n'
    )
    await rm(join(tmp, '.dbcli/queries'), { recursive: true, force: true })
    await expect(queriesDelete('@bar', { force: true, cwd: tmp })).rejects.toThrow(/local/i)
  })
})
