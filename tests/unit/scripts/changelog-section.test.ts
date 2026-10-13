/**
 * The release job turns one CHANGELOG section into the GitHub Release notes.
 * A release published with empty or wrong notes is worse than a failed job, so
 * a missing or empty section must throw rather than yield an empty string.
 */

import { describe, test, expect } from 'bun:test'
import { extractChangelogSection } from '../../../scripts/changelog-section'

const CHANGELOG = `# Changelog

## [Unreleased]

### Changed

- not released yet

## [9.1.2] - 2026-10-01

### Fixed

- the fix

## [9.1.1] - 2026-09-20

Nothing notable here.

## [9.1.0] - 2026-09-01

## [9.0.0] - 2026-08-01

### Added

- the last section

## License

MIT
`

describe('extractChangelogSection', () => {
  test('returns the body without the heading line', () => {
    const body = extractChangelogSection(CHANGELOG, '9.1.2')
    expect(body).toBe('### Fixed\n\n- the fix')
    expect(body).not.toContain('## [9.1.2]')
  })

  test('stops at the next `## [` heading', () => {
    const body = extractChangelogSection(CHANGELOG, '9.1.1')
    expect(body).toBe('Nothing notable here.')
  })

  test('reads the last section in the file to its end', () => {
    expect(extractChangelogSection(CHANGELOG, '9.0.0')).toBe('### Added\n\n- the last section')
  })

  test('ends at a non-version `## ` heading such as License', () => {
    expect(extractChangelogSection(CHANGELOG, '9.0.0')).not.toContain('License')
  })

  test('accepts a leading v', () => {
    expect(extractChangelogSection(CHANGELOG, 'v9.1.2')).toBe(
      extractChangelogSection(CHANGELOG, '9.1.2')
    )
  })

  test('throws when the version has no section', () => {
    expect(() => extractChangelogSection(CHANGELOG, '9.9.9')).toThrow(/9\.9\.9/)
  })

  test('does not match a version that is only a prefix', () => {
    expect(() => extractChangelogSection(CHANGELOG, '9.1')).toThrow()
  })

  test('throws when the section is empty', () => {
    expect(() => extractChangelogSection(CHANGELOG, '9.1.0')).toThrow(/empty/)
  })
})
