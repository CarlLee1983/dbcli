/**
 * Skill install smoke tests.
 *
 * `getInstallPath` is unit-tested for path strings elsewhere; this file verifies
 * the END-TO-END `--install` write actually lands the correct FILE SET on disk for
 * every supported platform — especially the cursor/windsurf dual-file layout
 * (root rule file + reference.md in a separate hidden dir), which a path-string
 * test can't catch. Runs against a throwaway HOME + cwd so nothing touches the
 * developer's real config.
 */

import { test, expect, describe, spyOn, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { join, dirname } from 'node:path'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { skillCommand, getInstallPath, SUPPORTED_PLATFORMS } from '../../../src/commands/skill'

/** Where reference.md lands per platform, mirroring writeSkillInstall(). */
function expectedReferencePath(platform: string, primary: string): string {
  if (platform === 'cursor')
    return join(process.cwd(), '.cursor', 'skills', 'dbcli', 'reference.md')
  if (platform === 'windsurf')
    return join(process.cwd(), '.windsurf', 'skills', 'dbcli', 'reference.md')
  return join(dirname(primary), 'reference.md')
}

describe('skill --install smoke (per platform)', () => {
  const origHome = process.env.HOME
  const origCwd = process.cwd()
  let sandbox = ''

  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-install-'))
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

  for (const platform of SUPPORTED_PLATFORMS) {
    test(`writes primary + reference for ${platform}`, async () => {
      await skillCommand({} as any, { install: platform })

      // No error path was taken.
      expect(exitSpy).not.toHaveBeenCalled()

      const primary = getInstallPath(platform)
      const reference = expectedReferencePath(platform, primary)

      expect(existsSync(primary)).toBe(true)
      expect(existsSync(reference)).toBe(true)

      const primaryText = await Bun.file(primary).text()
      const referenceText = await Bun.file(reference).text()
      expect(primaryText).toContain('# dbcli')
      // reference.md is the long command reference; sanity-check it is the ref doc.
      expect(referenceText.length).toBeGreaterThan(primaryText.length / 2)
      expect(referenceText).not.toBe('')

      // Primary and reference must be DISTINCT files (regression: dual-file layout).
      expect(primary).not.toBe(reference)
    })
  }

  test('cursor lands a .mdc rule, not SKILL.md, and reference under .cursor/skills', async () => {
    await skillCommand({} as any, { install: 'cursor' })
    expect(existsSync(join(sandbox, '.cursor', 'rules', 'dbcli.mdc'))).toBe(true)
    expect(existsSync(join(sandbox, '.cursor', 'skills', 'dbcli', 'reference.md'))).toBe(true)
  })

  test('windsurf lands .windsurfrules and reference under .windsurf/skills', async () => {
    await skillCommand({} as any, { install: 'windsurf' })
    expect(existsSync(join(sandbox, '.windsurfrules'))).toBe(true)
    expect(existsSync(join(sandbox, '.windsurf', 'skills', 'dbcli', 'reference.md'))).toBe(true)
  })
})

// Restore spies once this file completes so they don't leak into later test
// files (bun's spyOn persists across files within a process; file order differs
// by OS, so leaked spies can fail unrelated tests on Linux CI).
afterAll(() => {
  mock.restore()
})
