/**
 * Print one version's `CHANGELOG.md` section, for the GitHub Release notes.
 *
 * Usage: `bun run scripts/changelog-section.ts <version> [changelog-path]`
 *
 * The body is everything under `## [X.Y.Z]` up to the next `## [` heading, with
 * the heading line itself left out. A missing or empty section exits non-zero:
 * the release workflow runs this after the package is already on npm, and a
 * Release with blank notes would pass unnoticed where a red job gets read.
 */

/** Body of the `## [version]` section, trimmed. Throws when it is missing or empty. */
export function extractChangelogSection(changelog: string, version: string): string {
  const wanted = version.replace(/^v/, '')
  const lines = changelog.split(/\r?\n/)

  const isHeading = (line: string) => line.startsWith('## [')
  const start = lines.findIndex((line) => isHeading(line) && line.slice(4).startsWith(`${wanted}]`))
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${wanted}]" section`)

  const rest = lines.slice(start + 1)
  const end = rest.findIndex(isHeading)
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
  if (body === '') throw new Error(`CHANGELOG.md section "## [${wanted}]" is empty`)

  return body
}

if (import.meta.main) {
  const [version, changelogPath = `${import.meta.dir}/../CHANGELOG.md`] = process.argv.slice(2)
  if (!version) {
    console.error('usage: bun run scripts/changelog-section.ts <version> [changelog-path]')
    process.exit(2)
  }

  try {
    console.log(extractChangelogSection(await Bun.file(changelogPath).text(), version))
  } catch (error) {
    console.error(`changelog-section: ${(error as Error).message}`)
    process.exit(1)
  }
}
