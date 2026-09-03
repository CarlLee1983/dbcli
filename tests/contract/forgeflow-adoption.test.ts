import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  collectAdoptionDrift,
  findReadmeDeclarationDrift,
  findRestatedVersionDrift,
  formatAdoptionDrift,
  MARKER_PATH,
  parseAdoptionMarker,
  README_PATH,
  RESTATEMENT_SURFACES,
  type AdoptionMarker,
} from '../../scripts/lib/forgeflow-adoption'
import { readFromRoot } from '../../scripts/check-forgeflow-adoption'

const VERSION = '0.3.2'
const REVISION = '7bbdf443ead484780e23df9abf055095d4c629e2'
const OTHER_REVISION = 'afca7600db01279ddfe74ac030bd226444cc8b11'

const marker: AdoptionMarker = { version: VERSION, revision: REVISION }

const markerFile = (...lines: string[]): string => `${lines.join('\n')}\n`

const readme = (version = VERSION, revision = REVISION): string =>
  [
    '# ForgeFlow Stories',
    '',
    `This repository adopted ForgeFlow ${version} from revision`,
    `\`${revision}\`; \`specs/.forgeflow-adoption\` is the machine-readable record.`,
    '',
  ].join('\n')

/**
 * A fixture repository written under the OS temp directory.
 *
 * The gate reads the files it is protecting, so a test that mutated them to
 * produce a failure would be corrupting the working tree to prove the gate
 * notices corruption. Every drift case here is built in a throwaway tree
 * instead.
 */
const trees: string[] = []

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'forgeflow-adoption-'))
  trees.push(root)
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  return root
}

/** A tree in which every surface agrees, before the case under test edits it. */
function healthyTree(): Record<string, string> {
  const files: Record<string, string> = {
    [MARKER_PATH]: markerFile(`version=${VERSION}`, `revision=${REVISION}`),
    [README_PATH]: readme(),
  }
  for (const surface of RESTATEMENT_SURFACES) {
    files[surface] = '# a surface that mentions no ForgeFlow version\n'
  }
  return files
}

const driftIn = async (files: Record<string, string>): Promise<string[]> =>
  (await collectAdoptionDrift(readFromRoot(await fixtureRepo(files)))).map(formatAdoptionDrift)

afterEach(async () => {
  await Promise.all(trees.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('adoption marker', () => {
  test('parses a well-formed marker', () => {
    const result = parseAdoptionMarker(markerFile(`version=${VERSION}`, `revision=${REVISION}`))
    expect(result.drift).toEqual([])
    expect(result.marker).toEqual(marker)
  })

  test('tolerates comments, blank lines, and surrounding whitespace', () => {
    const result = parseAdoptionMarker(
      markerFile(
        '# the upstream release this contract came from',
        '',
        `  version = ${VERSION} `,
        '',
        `revision=${REVISION}`
      )
    )
    expect(result.drift).toEqual([])
    expect(result.marker).toEqual(marker)
  })

  test('reports a missing version and returns no marker', () => {
    const result = parseAdoptionMarker(markerFile(`revision=${REVISION}`))
    expect(result.marker).toBeUndefined()
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — version: expected a semantic version such as 0.3.2, found absent (the field is missing)',
    ])
  })

  test('reports a missing revision and returns no marker', () => {
    const result = parseAdoptionMarker(markerFile(`version=${VERSION}`))
    expect(result.marker).toBeUndefined()
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — revision: expected a 40-character upstream commit SHA, found absent (the field is missing)',
    ])
  })

  test('rejects a version that is not a semantic version', () => {
    const result = parseAdoptionMarker(markerFile('version=0.3', `revision=${REVISION}`))
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — version: expected a semantic version such as 0.3.2, found 0.3 (the value does not parse as MAJOR.MINOR.PATCH)',
    ])
  })

  // An abbreviated SHA reads like a revision and identifies nothing durable:
  // it is ambiguous by construction and can stop resolving as upstream grows.
  test('rejects an abbreviated revision', () => {
    const result = parseAdoptionMarker(markerFile(`version=${VERSION}`, 'revision=7bbdf44'))
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — revision: expected a 40-character upstream commit SHA, found 7bbdf44 (the value is not a full lowercase hexadecimal SHA, so it does not identify a revision)',
    ])
  })

  test('rejects an unrecognised key rather than ignoring it', () => {
    const result = parseAdoptionMarker(
      markerFile(`version=${VERSION}`, `revision=${REVISION}`, 'upstream=ForgeFlowV2')
    )
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — line 3: expected one of version, revision, found upstream (an unrecognised key is not read by anything, so it records nothing)',
    ])
  })

  test('rejects a repeated key rather than picking one silently', () => {
    const result = parseAdoptionMarker(
      markerFile(`version=${VERSION}`, 'version=0.3.1', `revision=${REVISION}`)
    )
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — version: expected exactly one declaration, found declared again on line 2 as "0.3.1" (a repeated key leaves which value is authoritative undefined)',
    ])
  })

  test('rejects a line that declares nothing', () => {
    const result = parseAdoptionMarker(
      markerFile(`version=${VERSION}`, 'forgeflow 0.3.2', `revision=${REVISION}`)
    )
    expect(result.drift.map(formatAdoptionDrift)).toEqual([
      'specs/.forgeflow-adoption — line 2: expected a `key=value` line, found forgeflow 0.3.2 (the marker is a key=value record; a line without `=` declares nothing)',
    ])
  })

  // A CRLF checkout leaves \r at every line end, which would otherwise land
  // inside the parsed value and fail the SHA pattern for the wrong reason.
  test('reads a marker checked out with CRLF line endings', () => {
    const source = markerFile(`version=${VERSION}`, `revision=${REVISION}`).replaceAll('\n', '\r\n')
    expect(parseAdoptionMarker(source).marker).toEqual(marker)
  })
})

describe('canonical README declaration', () => {
  test('accepts the declaration when both values match the marker', () => {
    expect(findReadmeDeclarationDrift(readme(), marker)).toEqual([])
  })

  test('reports a README declaring a different version', () => {
    expect(findReadmeDeclarationDrift(readme('0.3.1'), marker).map(formatAdoptionDrift)).toEqual([
      'specs/stories/README.md — declared version: expected 0.3.2, found 0.3.1 (disagrees with specs/.forgeflow-adoption)',
    ])
  })

  test('reports a README declaring a different revision', () => {
    expect(
      findReadmeDeclarationDrift(readme(VERSION, OTHER_REVISION), marker).map(formatAdoptionDrift)
    ).toEqual([
      `specs/stories/README.md — declared revision: expected ${REVISION}, found ${OTHER_REVISION} (disagrees with specs/.forgeflow-adoption)`,
    ])
  })

  test('reports a README that has stopped declaring the adoption at all', () => {
    expect(
      findReadmeDeclarationDrift('# ForgeFlow Stories\n\nCopy the template.\n', marker).map(
        formatAdoptionDrift
      )
    ).toEqual([
      `specs/stories/README.md — adoption declaration: expected a sentence reading: adopted ForgeFlow ${VERSION} from revision \`${REVISION}\`, found no such sentence (the README is the canonical restatement of the marker and must declare both values)`,
    ])
  })

  // The sentence wraps in the real file. A line-oriented match would call the
  // wrapped form missing, which is a false failure on the only file that is
  // required to carry it.
  test('accepts a declaration that wraps across a line break', () => {
    const wrapped = `This repository adopted ForgeFlow ${VERSION} from revision\n\`${REVISION}\`.`
    expect(findReadmeDeclarationDrift(wrapped, marker)).toEqual([])
  })

  // The README records the release this contract was FIRST adopted at as well
  // as the current one. That earlier version is history, not a competing claim.
  test('does not read the prior-adoption sentence as a competing declaration', () => {
    const source = `${readme()}\nIt was first adopted at 0.3.0 (\`${OTHER_REVISION}\`).\n`
    expect(findReadmeDeclarationDrift(source, marker)).toEqual([])
    expect(findRestatedVersionDrift(source, marker, README_PATH)).toEqual([])
  })
})

describe('restated versions on other surfaces', () => {
  test('accepts a surface that mentions no ForgeFlow version', () => {
    expect(findRestatedVersionDrift('# Handoff\n\nNothing to report.\n', marker, 'f.md')).toEqual(
      []
    )
  })

  test('accepts a surface restating the adopted version', () => {
    expect(
      findRestatedVersionDrift(`採用 ForgeFlow ${VERSION}（見 marker）。\n`, marker, 'f.md')
    ).toEqual([])
  })

  test('reports a handoff declaring an older adoption version', () => {
    expect(
      findRestatedVersionDrift(
        '# Handoff\n\n採用 ForgeFlow 0.3.1（`specs/.forgeflow-adoption`）。\n',
        marker,
        'specs/handoff.md'
      ).map(formatAdoptionDrift)
    ).toEqual([
      'specs/handoff.md — line 3: expected ForgeFlow 0.3.2, found ForgeFlow 0.3.1 (specs/.forgeflow-adoption records 0.3.2; a sentence naming a different release as the adopted one is the drift this gate exists to catch)',
    ])
  })

  test('reports a `v`-prefixed restatement', () => {
    expect(
      findRestatedVersionDrift('Runs on ForgeFlow v0.4.0.\n', marker, 'f.md').map(
        formatAdoptionDrift
      )[0]
    ).toContain('found ForgeFlow 0.4.0')
  })

  // These documents legitimately discuss earlier releases by number. Matching a
  // bare version anywhere in the sentence would report each of them, and a gate
  // that cries wolf on true prose is a gate that gets deleted.
  test.each([
    ['0.3.1 新增上游的 `story-check` 與 `handoff-check`。'],
    ['升級到 0.3.1 時，上游的 `handoff-check` 立刻抓出這份紀錄。'],
    ['It was first adopted at 0.3.0.'],
  ])('does not report a historical version written away from the word ForgeFlow: %s', (line) => {
    expect(findRestatedVersionDrift(`${line}\n`, marker, 'f.md')).toEqual([])
  })

  test('reports every restatement, not only the first', () => {
    const source = 'ForgeFlow 0.3.1 here.\nAnd ForgeFlow 0.2.0 here.\n'
    expect(findRestatedVersionDrift(source, marker, 'f.md').map((item) => item.field)).toEqual([
      'line 1',
      'line 2',
    ])
  })
})

describe('whole-repository reconciliation', () => {
  test('passes on a tree where every surface agrees', async () => {
    expect(await driftIn(healthyTree())).toEqual([])
  })

  test('reports an absent marker', async () => {
    const files = healthyTree()
    delete files[MARKER_PATH]
    expect(await driftIn(files)).toEqual([
      'specs/.forgeflow-adoption — file: expected a key=value record of the adopted ForgeFlow release, found absent (nothing records which upstream revision the Story contract came from)',
    ])
  })

  // A marker that does not parse cannot be compared against; reporting the
  // other files too would point the reader at four innocent files.
  test('reports only the marker when the marker itself is unreadable', async () => {
    const files = healthyTree()
    files[MARKER_PATH] = markerFile(`revision=${REVISION}`)
    files[README_PATH] = readme('0.3.1')
    const drift = await driftIn(files)
    expect(drift).toHaveLength(1)
    expect(drift[0]).toContain('specs/.forgeflow-adoption — version')
  })

  test('reports a README version that drifted from the marker', async () => {
    const files = healthyTree()
    files[README_PATH] = readme('0.3.1')
    expect(await driftIn(files)).toEqual([
      'specs/stories/README.md — declared version: expected 0.3.2, found 0.3.1 (disagrees with specs/.forgeflow-adoption)',
    ])
  })

  test('reports a README revision that drifted from the marker', async () => {
    const files = healthyTree()
    files[README_PATH] = readme(VERSION, OTHER_REVISION)
    expect(await driftIn(files)).toEqual([
      `specs/stories/README.md — declared revision: expected ${REVISION}, found ${OTHER_REVISION} (disagrees with specs/.forgeflow-adoption)`,
    ])
  })

  test('reports a handoff that still declares the previous adoption version', async () => {
    const files = healthyTree()
    files['specs/handoff.md'] = '# Handoff\n\n採用 ForgeFlow 0.3.1。\n'
    expect(await driftIn(files)).toEqual([
      'specs/handoff.md — line 3: expected ForgeFlow 0.3.2, found ForgeFlow 0.3.1 (specs/.forgeflow-adoption records 0.3.2; a sentence naming a different release as the adopted one is the drift this gate exists to catch)',
    ])
  })

  test('reports undisclosed drift in the Story template', async () => {
    const files = healthyTree()
    files['specs/stories/_template/story.md'] = '# Story\n\nWritten against ForgeFlow 0.3.0.\n'
    expect(await driftIn(files)).toEqual([
      'specs/stories/_template/story.md — line 3: expected ForgeFlow 0.3.2, found ForgeFlow 0.3.0 (specs/.forgeflow-adoption records 0.3.2; a sentence naming a different release as the adopted one is the drift this gate exists to catch)',
    ])
  })

  test('reports undisclosed drift in the local story-development Skill', async () => {
    const files = healthyTree()
    files['.agents/skills/story-development/SKILL.md'] = 'Implements ForgeFlow 0.3.1 Stories.\n'
    expect(await driftIn(files)).toEqual([
      '.agents/skills/story-development/SKILL.md — line 1: expected ForgeFlow 0.3.2, found ForgeFlow 0.3.1 (specs/.forgeflow-adoption records 0.3.2; a sentence naming a different release as the adopted one is the drift this gate exists to catch)',
    ])
  })

  // A surface that quietly stops existing stops being reconciled, which is the
  // same silent-drift failure one level up.
  test('reports a surface that has been deleted', async () => {
    const files = healthyTree()
    delete files['.agents/skills/story-development/SKILL.md']
    expect(await driftIn(files)).toEqual([
      '.agents/skills/story-development/SKILL.md — file: expected an adoption surface this gate reconciles, found absent (a surface that stops existing stops being checked; remove it from RESTATEMENT_SURFACES deliberately)',
    ])
  })
})

describe('failure output is actionable', () => {
  // The whole value of this gate is that a reader can fix the drift without
  // opening a diff, so every message must name a locatable place and both
  // values. A message like "adoption drift detected" would pass a length
  // assertion and be useless.
  test('every drift names a file, a locator, an expected value, and an actual value', async () => {
    const cases: Record<string, string>[] = [
      { ...healthyTree(), [MARKER_PATH]: markerFile(`version=${VERSION}`) },
      { ...healthyTree(), [README_PATH]: readme('0.3.1') },
      { ...healthyTree(), 'specs/handoff.md': '採用 ForgeFlow 0.1.0。\n' },
    ]

    for (const files of cases) {
      const root = await fixtureRepo(files)
      const drift = await collectAdoptionDrift(readFromRoot(root))
      expect(drift.length).toBeGreaterThan(0)
      for (const item of drift) {
        expect(item.file).toMatch(/\.(md|forgeflow-adoption)$/)
        expect(item.field).not.toBe('')
        expect(item.expected).not.toBe('')
        expect(item.actual).not.toBe('')
        // "unknown", "invalid" and friends tell a reader nothing they can act on.
        expect(formatAdoptionDrift(item)).not.toMatch(/\b(unknown|invalid|something|somewhere)\b/i)
        expect(formatAdoptionDrift(item)).toContain(item.file)
      }
    }
  })
})

describe('the working tree itself', () => {
  // The unit cases above run on fixtures, so nothing there would notice the
  // real repository drifting. This is the one case that reads it — read-only.
  test('the repository under test has no adoption drift', async () => {
    const root = join(import.meta.dir, '..', '..')
    expect((await collectAdoptionDrift(readFromRoot(root))).map(formatAdoptionDrift)).toEqual([])
  })
})
