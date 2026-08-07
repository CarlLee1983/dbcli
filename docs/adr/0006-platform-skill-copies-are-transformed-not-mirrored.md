---
status: accepted
date: 2026-08-07
---

# Platform skill copies are transformed, not mirrored

`assets/SKILL.md` is the single source for every install target, and until now
"install" meant copying it byte for byte. `scripts/sync-plugin-assets.ts`
enforced exactly that, and `bun run plugin:check` passed on all ten copies.

For two of the seven platforms, byte-identical was the bug.

`assets/SKILL.md` is a Claude skill: YAML frontmatter carrying `name` and
`description`, and a body that points at a sibling `reference.md`.

- **Windsurf** does not parse frontmatter. The 2026-08-07 audit confirmed
  `.windsurfrules` was 46,420 bytes starting with `---`, so roughly 900
  characters of `description:` were being read as rule text — instructions
  addressed to a loader that does not exist, at the top of the file where
  attention is most expensive.
- **Cursor** reads `description`, `globs`, and `alwaysApply` from an `.mdc`
  rule. It has no use for `name`, and with `alwaysApply` absent the rule's
  loading mode was never stated by us.
- Both platforms keep `reference.md` somewhere other than beside the primary
  file (`.cursor/skills/dbcli/` and `.windsurf/skills/dbcli/`, while the primary
  file sits in `.cursor/rules/` and the project root). All 13 mentions of
  `reference.md` therefore resolved to nothing, and the progressive disclosure
  the skill is built on dead-ended for those two platforms.

## Decision

`src/core/skill-install/platform-format.ts` shapes the canonical skill per
platform, and both writers — `dbcli skill --install` and the repo sync script —
go through it. The sync script's invariant changes from "target equals source"
to "target equals the expected transform of source".

Cursor is installed as an **Agent Requested** rule (`description` preserved,
`globs:` empty, `alwaysApply: false`) rather than always-on. The rule is 46 KB;
`alwaysApply: true` would spend that on every request, and the usability half of
the same audit found the file already carries more than it should. The cost of
this choice is real and worth stating: the safety baseline — check the
blacklist, never guess a column name — is in scope only when Cursor decides to
pull the rule in.

Windsurf keeps the full body with the frontmatter stripped and the description
promoted to an opening paragraph, so the trigger conditions survive in a form
that platform can read. The audit noted a possible ~6,000-character limit on a
single Windsurf rules file; that figure is **unverified**, and no truncation or
condensed variant is being designed against an unverified number.

## Why record this

A later reader who runs `diff .windsurfrules assets/SKILL.md`, or who reads a
sync script whose whole job used to be byte equality, will read the difference
as drift and "fix" it — restoring the frontmatter leak in one commit. The
transform is deliberate. Reversing it is cheap, which is exactly why it needs to
be visible.

**Falsified if:** `scripts/sync-plugin-assets.ts` compares `.windsurfrules` or
`.cursor/rules/dbcli.mdc` against `assets/SKILL.md` by equality, or
`src/core/skill-install/platform-format.ts` no longer transforms them. Either
means platform copies are mirrors again and this record must be updated in the
same change.
