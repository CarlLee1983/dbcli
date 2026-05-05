import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queriesExport } from '@/commands/queries-export'

let tmp = ''
let stdoutSpy: any

describe('queries export', () => {
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'queries-export-'))
    await mkdir(join(tmp, '.dbcli-shared/queries/diag'), { recursive: true })
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(((_: any) => true) as any)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    stdoutSpy?.mockRestore?.()
  })

  test('exports single-variant snippet to stdout', async () => {
    await writeFile(
      join(tmp, '.dbcli-shared/queries/x.sql'),
      '-- ---\n-- name: x\n-- engine: postgres\n-- ---\nSELECT 1;\n'
    )
    await queriesExport('@x', { cwd: tmp })
    const written = stdoutSpy.mock.calls.map((c: any[]) => String(c[0])).join('')
    expect(written).toContain('SELECT')
  })

  test('errors on multi-variant snippet without --engine', async () => {
    await writeFile(
      join(tmp, '.dbcli-shared/queries/diag/sample.postgres.sql'),
      '-- ---\n-- engine: postgres\n-- ---\nSELECT 1;\n'
    )
    await writeFile(
      join(tmp, '.dbcli-shared/queries/diag/sample.mysql.sql'),
      '-- ---\n-- engine: mysql\n-- ---\nSELECT 1;\n'
    )
    await expect(queriesExport('@diag/sample', { cwd: tmp })).rejects.toThrow(/engine/i)
  })

  test('exports specific variant with --engine', async () => {
    await writeFile(
      join(tmp, '.dbcli-shared/queries/diag/sample.postgres.sql'),
      '-- ---\n-- engine: postgres\n-- ---\nSELECT pg_only;\n'
    )
    await writeFile(
      join(tmp, '.dbcli-shared/queries/diag/sample.mysql.sql'),
      '-- ---\n-- engine: mysql\n-- ---\nSELECT my_only;\n'
    )
    await queriesExport('@diag/sample', { cwd: tmp, engine: 'postgres' })
    const written = stdoutSpy.mock.calls.map((c: any[]) => String(c[0])).join('')
    expect(written).toContain('pg_only')
  })
})
