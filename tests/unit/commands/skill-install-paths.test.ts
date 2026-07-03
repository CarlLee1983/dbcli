/**
 * getInstallPath must return the exact documented path per platform. The smoke
 * test in skill-install.test.ts uses getInstallPath() as its OWN oracle, so a
 * wrong path (e.g. `.claud`) would still pass there. This pins the literals so a
 * typo in any platform path is caught.
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { getInstallPath } from '../../../src/commands/skill'

describe('getInstallPath literal paths', () => {
  const origHome = process.env.HOME
  const HOME = join('/tmp', 'dbcli-home-fixture')

  beforeEach(() => {
    process.env.HOME = HOME
  })
  afterEach(() => {
    process.env.HOME = origHome
  })

  // HOME-based (user-global) installs
  test('claude', () => {
    expect(getInstallPath('claude')).toBe(join(HOME, '.claude', 'skills', 'dbcli', 'SKILL.md'))
  })
  test('gemini', () => {
    expect(getInstallPath('gemini')).toBe(join(HOME, '.gemini', 'skills', 'dbcli', 'SKILL.md'))
  })
  test('antigravity', () => {
    expect(getInstallPath('antigravity')).toBe(
      join(HOME, '.gemini', 'antigravity-cli', 'skills', 'dbcli', 'SKILL.md')
    )
  })
  test('codex', () => {
    expect(getInstallPath('codex')).toBe(join(HOME, '.codex', 'skills', 'dbcli', 'SKILL.md'))
  })

  // cwd-based (repo-local) installs
  test('copilot', () => {
    expect(getInstallPath('copilot')).toBe(
      join(process.cwd(), '.github', 'skills', 'dbcli', 'SKILL.md')
    )
  })
  test('cursor (.mdc rule)', () => {
    expect(getInstallPath('cursor')).toBe(join(process.cwd(), '.cursor', 'rules', 'dbcli.mdc'))
  })
  test('windsurf (root rules file)', () => {
    expect(getInstallPath('windsurf')).toBe(join(process.cwd(), '.windsurfrules'))
  })

  test('case-insensitive platform name', () => {
    expect(getInstallPath('CLAUDE')).toBe(join(HOME, '.claude', 'skills', 'dbcli', 'SKILL.md'))
  })
})
