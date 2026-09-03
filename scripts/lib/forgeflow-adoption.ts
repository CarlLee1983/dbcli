// Drift signals for this repository's recorded ForgeFlow adoption.
//
// `specs/.forgeflow-adoption` is the machine-readable record of which upstream
// ForgeFlow revision this repository's Story contract came from. Every other
// mention of that version lives in prose, and prose drifts silently: the
// handoff spent two merged pull requests claiming 0.3.1 while the marker and
// `specs/stories/README.md` both said 0.3.2. Nothing was wrong with the code —
// the adoption simply had three answers, and the only one a reader is likely to
// hit first was the stale one.
//
// So the marker is the single source of truth and everything else is measured
// against it, on two rules that are deliberately narrow enough not to misread
// history:
//
//   1. `specs/stories/README.md` carries the canonical declaration, in a fixed
//      form naming both the version and the revision. It is the one file that
//      restates the marker, and both values must match it exactly.
//   2. Every other adoption surface — the handoff, the Story template, the
//      local `story-development` Skill — may mention a ForgeFlow version, but
//      not a version DIFFERENT from the marker.
//
// Rule 2 matches only a version written immediately after the word ForgeFlow
// (`ForgeFlow 0.3.1`), never a bare version elsewhere in the sentence. That
// narrowness is the point. These documents legitimately discuss earlier
// releases — "0.3.1 新增上游的 story-check", "It was first adopted at 0.3.0" —
// and a looser pattern would report each of those as drift, which is how a gate
// gets switched off in a week. What it does catch is the failure that actually
// happened: a sentence asserting which ForgeFlow this repository is on.
//
// Nothing here reaches the network. Whether the recorded revision exists
// upstream is not checkable offline and is not claimed; what is checkable is
// that this repository gives one consistent answer about it.

/** The parsed contents of `specs/.forgeflow-adoption`. */
export interface AdoptionMarker {
  version: string
  revision: string
}

/**
 * One disagreement about the adopted ForgeFlow release.
 *
 * `expected` and `actual` are carried separately from the prose so a failure
 * report can always name the value it wanted and the value it found, rather
 * than leaving the reader to diff two sentences by eye.
 */
export interface AdoptionDrift {
  file: string
  field: string
  expected: string
  actual: string
  detail: string
}

/** Keys the marker may declare. An unknown key is drift, not a comment. */
const MARKER_KEYS = ['version', 'revision'] as const

const SEMVER = /^\d+\.\d+\.\d+$/
const REVISION = /^[0-9a-f]{40}$/

/**
 * The canonical declaration in `specs/stories/README.md`.
 *
 * `\s+` spans the line break, because the sentence wraps in the file and a
 * line-oriented pattern would report the wrapped form as missing.
 */
const README_DECLARATION = /adopted ForgeFlow (\d+\.\d+\.\d+) from revision\s+`([0-9a-f]{40})`/

/** A version asserted as the ForgeFlow release in use. See the header note. */
const RESTATED_VERSION = /ForgeFlow\s+v?(\d+\.\d+\.\d+)/g

/** Files that may mention a ForgeFlow version but must not contradict the marker. */
export const RESTATEMENT_SURFACES: readonly string[] = [
  'specs/handoff.md',
  'specs/stories/_template/story.md',
  'specs/stories/_template/acceptance.md',
  'specs/stories/_template/task.md',
  '.agents/skills/story-development/SKILL.md',
]

export const MARKER_PATH = 'specs/.forgeflow-adoption'
export const README_PATH = 'specs/stories/README.md'

const drift = (
  file: string,
  field: string,
  expected: string,
  actual: string,
  detail: string
): AdoptionDrift => ({ file, field, expected, actual, detail })

/**
 * Read the adoption marker.
 *
 * Returns the marker only when every field is present and well formed; a
 * partially parsed marker is not returned, because comparing other files
 * against half an answer produces failures that point at the wrong file.
 */
export function parseAdoptionMarker(
  source: string,
  file: string = MARKER_PATH
): { marker?: AdoptionMarker; drift: AdoptionDrift[] } {
  const found = new Map<string, string>()
  const problems: AdoptionDrift[] = []

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) {
      problems.push(
        drift(
          file,
          `line ${index + 1}`,
          'a `key=value` line',
          line,
          'the marker is a key=value record; a line without `=` declares nothing'
        )
      )
      continue
    }

    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()

    if (!(MARKER_KEYS as readonly string[]).includes(key)) {
      problems.push(
        drift(
          file,
          `line ${index + 1}`,
          `one of ${MARKER_KEYS.join(', ')}`,
          key,
          'an unrecognised key is not read by anything, so it records nothing'
        )
      )
      continue
    }

    if (found.has(key)) {
      problems.push(
        drift(
          file,
          key,
          'exactly one declaration',
          `declared again on line ${index + 1} as "${value}"`,
          'a repeated key leaves which value is authoritative undefined'
        )
      )
      continue
    }

    found.set(key, value)
  }

  const version = found.get('version')
  const revision = found.get('revision')

  if (version === undefined) {
    problems.push(
      drift(file, 'version', 'a semantic version such as 0.3.2', 'absent', 'the field is missing')
    )
  } else if (!SEMVER.test(version)) {
    problems.push(
      drift(
        file,
        'version',
        'a semantic version such as 0.3.2',
        version,
        'the value does not parse as MAJOR.MINOR.PATCH'
      )
    )
  }

  if (revision === undefined) {
    problems.push(
      drift(
        file,
        'revision',
        'a 40-character upstream commit SHA',
        'absent',
        'the field is missing'
      )
    )
  } else if (!REVISION.test(revision)) {
    problems.push(
      drift(
        file,
        'revision',
        'a 40-character upstream commit SHA',
        revision,
        'the value is not a full lowercase hexadecimal SHA, so it does not identify a revision'
      )
    )
  }

  if (problems.length > 0) return { drift: problems }
  return { marker: { version: version as string, revision: revision as string }, drift: [] }
}

/**
 * Check the canonical declaration in `specs/stories/README.md`.
 *
 * A missing declaration fails rather than passing quietly: the README is the
 * file a human reads to learn the adopted version, and one that has stopped
 * declaring it has stopped being checkable.
 */
export function findReadmeDeclarationDrift(
  source: string,
  marker: AdoptionMarker,
  file: string = README_PATH
): AdoptionDrift[] {
  const declaration = source.match(README_DECLARATION)
  if (!declaration) {
    return [
      drift(
        file,
        'adoption declaration',
        `a sentence reading: adopted ForgeFlow ${marker.version} from revision \`${marker.revision}\``,
        'no such sentence',
        'the README is the canonical restatement of the marker and must declare both values'
      ),
    ]
  }

  const [, version, revision] = declaration
  const problems: AdoptionDrift[] = []

  if (version !== marker.version) {
    problems.push(
      drift(
        file,
        'declared version',
        marker.version,
        version as string,
        `disagrees with ${MARKER_PATH}`
      )
    )
  }

  if (revision !== marker.revision) {
    problems.push(
      drift(
        file,
        'declared revision',
        marker.revision,
        revision as string,
        `disagrees with ${MARKER_PATH}`
      )
    )
  }

  return problems
}

/**
 * Check that a document does not assert a ForgeFlow version other than the
 * marker's.
 */
export function findRestatedVersionDrift(
  source: string,
  marker: AdoptionMarker,
  file: string
): AdoptionDrift[] {
  const lines = source.split(/\r?\n/)
  const problems: AdoptionDrift[] = []

  for (const [index, line] of lines.entries()) {
    for (const [, version] of line.matchAll(RESTATED_VERSION)) {
      if (version === marker.version) continue
      problems.push(
        drift(
          file,
          `line ${index + 1}`,
          `ForgeFlow ${marker.version}`,
          `ForgeFlow ${version as string}`,
          `${MARKER_PATH} records ${marker.version}; a sentence naming a different release as the adopted one is the drift this gate exists to catch`
        )
      )
    }
  }

  return problems
}

/** Render one disagreement as a line a reader can act on without opening a diff. */
export function formatAdoptionDrift(item: AdoptionDrift): string {
  return `${item.file} — ${item.field}: expected ${item.expected}, found ${item.actual} (${item.detail})`
}

/** Reads a file from `root`, or `undefined` when it does not exist. */
type ReadFile = (path: string) => Promise<string | undefined>

/**
 * Reconcile every adoption surface against the marker.
 *
 * `read` is injected so this runs against a fixture tree in tests without
 * touching the working copy the gate is protecting.
 */
export async function collectAdoptionDrift(read: ReadFile): Promise<AdoptionDrift[]> {
  const markerSource = await read(MARKER_PATH)
  if (markerSource === undefined) {
    return [
      drift(
        MARKER_PATH,
        'file',
        'a key=value record of the adopted ForgeFlow release',
        'absent',
        'nothing records which upstream revision the Story contract came from'
      ),
    ]
  }

  const { marker, drift: markerDrift } = parseAdoptionMarker(markerSource)
  if (!marker) return markerDrift

  const problems: AdoptionDrift[] = []

  const readme = await read(README_PATH)
  if (readme === undefined) {
    problems.push(
      drift(
        README_PATH,
        'file',
        'the canonical adoption declaration',
        'absent',
        'the Story README is where the adopted version is declared to humans'
      )
    )
  } else {
    problems.push(...findReadmeDeclarationDrift(readme, marker))
  }

  for (const path of RESTATEMENT_SURFACES) {
    const source = await read(path)
    if (source === undefined) {
      problems.push(
        drift(
          path,
          'file',
          'an adoption surface this gate reconciles',
          'absent',
          'a surface that stops existing stops being checked; remove it from RESTATEMENT_SURFACES deliberately'
        )
      )
      continue
    }
    problems.push(...findRestatedVersionDrift(source, marker, path))
  }

  return problems
}
