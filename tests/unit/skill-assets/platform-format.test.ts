/**
 * Content contract: the Cursor and Windsurf install targets are not the Claude
 * skill file verbatim.
 *
 * Both were shipped byte-identical to `assets/SKILL.md`, YAML frontmatter and all.
 * Windsurf does not parse frontmatter, so ~900 characters of `description:` leaked
 * into the rule body; Cursor reads `description` / `globs` / `alwaysApply`, none of
 * which a Claude skill header carries. Both also keep `reference.md` beside the
 * primary file, which for these two platforms it is not.
 */

import { describe, expect, test } from 'bun:test'
import { formatForPlatform } from '../../../src/core/skill-install/platform-format'

const SKILL = `---
name: dbcli
description: Database CLI for AI agents. Read the sibling \`reference.md\` for flags.
---

# dbcli

See [reference.md](reference.md) for the full flag list.
`

describe('formatForPlatform', () => {
  test('leaves a Claude-style skill untouched', () => {
    expect(formatForPlatform('claude', SKILL)).toBe(SKILL)
  })

  describe('cursor', () => {
    const out = formatForPlatform('cursor', SKILL)

    test('replaces the skill header with Cursor rule fields', () => {
      expect(out.startsWith('---\n')).toBe(true)
      expect(out).toContain('alwaysApply: false')
      expect(out).toContain('globs:')
      expect(out).toContain('description: Database CLI for AI agents.')
      expect(out).not.toContain('name: dbcli')
    })

    test('points reference.md at the path Cursor actually installs it to', () => {
      expect(out).toContain('[reference.md](../skills/dbcli/reference.md)')
      expect(out).not.toMatch(/\(reference\.md\)/)
    })
  })

  describe('windsurf', () => {
    const out = formatForPlatform('windsurf', SKILL)

    test('strips the frontmatter it cannot parse', () => {
      expect(out.startsWith('---')).toBe(false)
      expect(out).not.toContain('alwaysApply')
      expect(out).not.toContain('name: dbcli')
    })

    test('keeps the description as prose so the trigger conditions survive', () => {
      expect(out).toContain('Database CLI for AI agents.')
    })

    test('keeps the body and repoints reference.md at the .windsurf copy', () => {
      expect(out).toContain('# dbcli')
      expect(out).toContain('[reference.md](.windsurf/skills/dbcli/reference.md)')
    })

    test('leaves exactly one blank line between the intro and the body', () => {
      expect(out).not.toMatch(/\n{3}/)
    })

    test('drops "sibling", which stops being true once the path moves', () => {
      expect(out).not.toContain('sibling')
      expect(out).toContain('companion `.windsurf/skills/dbcli/reference.md`')
    })
  })

  test('rewrites every mention of reference.md, not just markdown links', () => {
    const source = `---
name: dbcli
description: x
---

Full flags live in reference.md, and the \`reference.md\` Redis section covers Redis.
`
    const out = formatForPlatform('windsurf', source)

    expect(out).not.toMatch(/(^|[^/])reference\.md/m)
    expect(out.match(/\.windsurf\/skills\/dbcli\/reference\.md/g)).toHaveLength(2)
  })

  test('is idempotent — formatting an already-formatted file changes nothing', () => {
    const once = formatForPlatform('cursor', SKILL)

    expect(formatForPlatform('cursor', once)).toBe(once)
  })
})
