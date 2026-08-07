// Keeps every in-repo platform copy of the skill in step with `assets/`.
//
// Most targets are byte-identical to their source. Cursor and Windsurf are not:
// their primary file is shaped by `formatForPlatform` (see ADR 0006), so the
// invariant here is "target equals the expected transform of source", and the
// platform tag below is what selects that transform.

import { formatForPlatform } from '../src/core/skill-install/platform-format'

const mappings = [
  ['assets/SKILL.md', 'plugins/dbcli-agent/skills/dbcli/SKILL.md'],
  ['assets/reference.md', 'plugins/dbcli-agent/skills/dbcli/reference.md'],
  ['assets/SKILL.md', 'skills/dbcli/SKILL.md'],
  ['assets/reference.md', 'skills/dbcli/reference.md'],
  ['assets/SKILL.md', '.cursor/rules/dbcli.mdc', 'cursor'],
  ['assets/reference.md', '.cursor/skills/dbcli/reference.md'],
  ['assets/SKILL.md', '.github/skills/dbcli/SKILL.md'],
  ['assets/reference.md', '.github/skills/dbcli/reference.md'],
  ['assets/SKILL.md', '.windsurfrules', 'windsurf'],
  ['assets/reference.md', '.windsurf/skills/dbcli/reference.md'],
] as const

const write = process.argv.includes('--write')
let drift = false

for (const [source, target, platform] of mappings) {
  const sourceText = await Bun.file(source).text()
  const expected = platform ? formatForPlatform(platform, sourceText) : sourceText
  const targetFile = Bun.file(target)
  const targetExists = await targetFile.exists()
  const targetText = targetExists ? await targetFile.text() : ''

  if (expected === targetText) {
    console.log(`ok ${target}`)
    continue
  }

  if (write) {
    await Bun.write(target, expected)
    console.log(`synced ${target}`)
    continue
  }

  drift = true
  console.error(`drift ${target} differs from ${source}${platform ? ` (${platform} format)` : ''}`)
}

if (drift) {
  console.error('Run `bun run plugin:sync` to refresh plugin skill assets.')
  process.exit(1)
}
