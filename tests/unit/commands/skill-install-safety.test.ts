/**
 * Install-safety regression: `--install windsurf` writes the SHARED project-root
 * `.windsurfrules`. If a user already keeps their own rules there, dbcli must not
 * silently destroy it — it backs the file up before writing the skill. Runs
 * against a throwaway HOME + cwd so nothing touches the developer's real config.
 */

import { test, expect, describe, spyOn, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { skillCommand } from '../../../src/commands/skill'

describe('skill --install windsurf preserves an existing user .windsurfrules', () => {
  const origHome = process.env.HOME
  const origCwd = process.cwd()
  let sandbox = ''

  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-windsurf-'))
    process.env.HOME = sandbox
    process.chdir(sandbox)
    logSpy.mockClear()
    errorSpy.mockClear()
    exitSpy.mockClear()
  })

  afterEach(() => {
    process.chdir(origCwd)
    process.env.HOME = origHome
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  test('backs up a pre-existing non-dbcli .windsurfrules before overwriting', async () => {
    const userContent = '# My rules\n\nDo not delete this.\n'
    const rulesPath = join(sandbox, '.windsurfrules')
    await Bun.file(rulesPath).write(userContent)

    await skillCommand({} as any, { install: 'windsurf' })

    // The skill was written to .windsurfrules — without the frontmatter Windsurf
    // cannot parse (ADR 0006), so the check is on the body.
    const written = await Bun.file(rulesPath).text()
    expect(written).toContain('dbcli blacklist list')
    expect(written).not.toContain('name: dbcli')
    // ...but the user's original content survives in a backup.
    const backupPath = join(sandbox, '.windsurfrules.dbcli-backup')
    expect(existsSync(backupPath)).toBe(true)
    expect(await Bun.file(backupPath).text()).toBe(userContent)
  })

  test('creates no backup when there was no pre-existing file', async () => {
    await skillCommand({} as any, { install: 'windsurf' })
    expect(existsSync(join(sandbox, '.windsurfrules.dbcli-backup'))).toBe(false)
  })

  test('creates no backup when the existing .windsurfrules is already the dbcli skill', async () => {
    await skillCommand({} as any, { install: 'windsurf' }) // first install writes our skill
    await skillCommand({} as any, { install: 'windsurf' }) // re-install must not back up our own file
    expect(existsSync(join(sandbox, '.windsurfrules.dbcli-backup'))).toBe(false)
  })
})

afterAll(() => {
  mock.restore()
})
