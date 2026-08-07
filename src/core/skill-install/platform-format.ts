/**
 * Per-platform shaping of the canonical skill file.
 *
 * `assets/SKILL.md` is written as a Claude skill: YAML frontmatter with `name` and
 * `description`, and a body that points at a sibling `reference.md`. Most install
 * targets take that verbatim. Two do not:
 *
 *   - **Cursor** reads `.mdc` rules with `description` / `globs` / `alwaysApply`.
 *     A `name` key means nothing to it, and without `alwaysApply` the rule's mode
 *     is unstated. It is installed as an Agent Requested rule: Cursor decides when
 *     to pull it in, using the description.
 *   - **Windsurf** does not parse frontmatter at all, so a Claude header lands in
 *     the rule body as ~900 characters of prose addressed to the wrong reader. The
 *     description still carries the trigger conditions, so it is kept as an opening
 *     paragraph rather than dropped.
 *
 * Both also keep `reference.md` somewhere other than beside the primary file, so
 * every mention of it — markdown link or bare prose — is repointed. Otherwise the
 * progressive disclosure the skill depends on dead-ends.
 */

/** Where each platform's `reference.md` sits, relative to its primary file. */
const REFERENCE_PATH: Record<string, string> = {
  cursor: '../skills/dbcli/reference.md',
  windsurf: '.windsurf/skills/dbcli/reference.md',
}

interface ParsedSkill {
  frontmatter: string
  body: string
}

function parseSkill(source: string): ParsedSkill {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
  if (!match) return { frontmatter: '', body: source }
  return { frontmatter: match[1]!, body: source.slice(match[0].length) }
}

function frontmatterValue(frontmatter: string, key: string): string {
  // Values are single-line in this file; a missing key yields an empty string.
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(frontmatter)
  return match ? match[1]!.trim() : ''
}

function repointReference(text: string, referencePath: string): string {
  return (
    text
      // Markdown links: retarget, but leave the visible label as `reference.md`.
      .replace(/\]\(reference\.md\)/g, `](${referencePath})`)
      // Bare prose and inline-code mentions. A mention already inside a path or a
      // link label is left alone, which is what makes re-formatting a no-op.
      .replace(/(^|[^/[\w-])reference\.md/g, `$1${referencePath}`)
      // The file stops being a sibling once it moves to its own directory.
      .replace(/\bsibling(\s+`)/g, 'companion$1')
  )
}

export function formatForPlatform(platform: string, skillMarkdown: string): string {
  const referencePath = REFERENCE_PATH[platform.toLowerCase()]
  if (!referencePath) return skillMarkdown

  const { frontmatter, body } = parseSkill(skillMarkdown)
  const description = frontmatterValue(frontmatter, 'description')
  const repointedBody = repointReference(body.replace(/^\n+/, ''), referencePath)

  if (platform.toLowerCase() === 'cursor') {
    const header = [
      '---',
      `description: ${repointReference(description, referencePath)}`,
      'globs:',
      'alwaysApply: false',
      '---',
      '',
    ].join('\n')
    return `${header}${repointedBody}`
  }

  // Windsurf: no frontmatter survives, so the description leads as prose.
  const intro = description ? `${repointReference(description, referencePath)}\n\n` : ''
  return `${intro}${repointedBody}`
}
