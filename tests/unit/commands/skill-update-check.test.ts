/**
 * checkSkillUpdates() regression coverage.
 *
 * checkSkillUpdates() powers the "Skill updates available" reminder that fires
 * after every non-quiet command (cli.ts postAction) and inside `dbcli upgrade`.
 * A skill installed with `--lang zh-TW` must NOT be flagged as outdated just
 * because it differs from the English SKILL.md source — otherwise zh-TW users
 * get a permanent, un-clearable reminder. Runs against a throwaway HOME + cwd so
 * nothing touches the developer's real config.
 */

import { test, expect, describe, spyOn, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { skillCommand, getInstallPath, checkSkillUpdates } from '../../../src/commands/skill'

describe('checkSkillUpdates', () => {
  const origHome = process.env.HOME
  const origCwd = process.cwd()
  let sandbox = ''

  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-update-'))
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

  test('a freshly installed zh-TW skill is NOT reported outdated', async () => {
    await skillCommand({} as any, { install: 'claude', lang: 'zh-TW' })
    expect(existsSync(getInstallPath('claude'))).toBe(true)

    const outdated = await checkSkillUpdates()
    expect(outdated).not.toContain('claude')
  })

  test('a freshly installed en skill is NOT reported outdated', async () => {
    await skillCommand({} as any, { install: 'claude', lang: 'en' })
    expect(existsSync(getInstallPath('claude'))).toBe(true)

    const outdated = await checkSkillUpdates()
    expect(outdated).not.toContain('claude')
  })

  test('a modified/stale install IS reported outdated', async () => {
    await skillCommand({} as any, { install: 'claude', lang: 'en' })
    // Simulate an older skill version left on disk. Keep the `name: dbcli`
    // frontmatter — a real stale skill still carries it; that marker is how we
    // tell an actual (outdated) dbcli skill apart from an unrelated file.
    await Bun.file(getInstallPath('claude')).write(
      '---\nname: dbcli\n---\n\n# dbcli\n\nstale content from an old release\n'
    )

    const outdated = await checkSkillUpdates()
    expect(outdated).toContain('claude')
  })

  test("a user's own .windsurfrules (not a dbcli skill) is NOT reported outdated", async () => {
    // windsurf installs to the shared project-root .windsurfrules. A user's own
    // rules file must not be mistaken for a stale dbcli skill (which would nag
    // them to reinstall — and overwrite their file if they comply).
    await Bun.file(join(sandbox, '.windsurfrules')).write(
      '# My project rules\n\nAlways write tests first.\n'
    )

    const outdated = await checkSkillUpdates()
    expect(outdated).not.toContain('windsurf')
  })
})

afterAll(() => {
  mock.restore()
})
