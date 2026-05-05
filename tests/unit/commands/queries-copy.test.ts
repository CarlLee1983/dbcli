import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queriesCopy } from '@/commands/queries-copy'

let tmp = ''

describe('queries copy', () => {
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'queries-copy-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('copies builtin snippet into local with all engine variants', async () => {
    await mkdir(join(tmp, 'assets/snippets/diag'), { recursive: true })
    await writeFile(
      join(tmp, 'assets/snippets/diag/sample.postgres.sql'),
      '-- ---\n-- engine: postgres\n-- ---\nSELECT 1;\n'
    )
    await writeFile(
      join(tmp, 'assets/snippets/diag/sample.mysql.sql'),
      '-- ---\n-- engine: mysql\n-- ---\nSELECT 1;\n'
    )
    await queriesCopy('@diag/sample', '@my/sample', {
      cwd: tmp,
      builtinDirOverride: join(tmp, 'assets/snippets'),
    })
    expect(await Bun.file(join(tmp, '.dbcli/queries/my/sample.postgres.sql')).exists()).toBe(true)
    expect(await Bun.file(join(tmp, '.dbcli/queries/my/sample.mysql.sql')).exists()).toBe(true)
  })

  test('refuses to overwrite existing local target', async () => {
    await mkdir(join(tmp, '.dbcli/queries'), { recursive: true })
    await writeFile(join(tmp, '.dbcli/queries/x.sql'), '-- ---\n-- name: x\n-- ---\nSELECT 1;\n')
    await writeFile(join(tmp, '.dbcli/queries/y.sql'), '-- ---\n-- name: y\n-- ---\nSELECT 1;\n')
    await expect(queriesCopy('@y', '@x', { cwd: tmp })).rejects.toThrow(/exists/)
  })
})
