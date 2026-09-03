/**
 * Bounded, actionable failures for JSON-shaped ORM artifacts.
 *
 * Only the JSON *decode* step of a Drizzle snapshot or a normalized JSON
 * artifact can throw; every shape problem past it — a Drizzle construct outside
 * the supported subset included — degrades to a `blocked:` `unparsed` finding
 * instead. Left unwrapped, those throws reach the user as raw `JSON Parse error`
 * text or a whole Zod issue array, neither of which names the file that failed,
 * so an agent reviewing several artifacts cannot tell which one to fix. Every
 * error raised here names the path and stays a few lines long. The underlying
 * parser text is kept in parentheses deliberately: it is the only thing that
 * says *where* in the file the decode gave up.
 */

import { normalizedSchemaZod, type NormalizedSchema } from '@/core/orm-drift/normalized-schema'
import { isZodError } from '@/utils/config-error-format'

/** How many contract violations a single error reports before summarizing the rest. */
const MAX_REPORTED_ISSUES = 5

const DRIZZLE_SNAPSHOT_PATH = /drizzle[/\\]meta[/\\][^/\\]*snapshot\.json$/i

function invalidJsonReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function malformedDrizzleSnapshot(path: string, error: unknown): Error {
  return new Error(
    `Malformed Drizzle snapshot: ${path} is not valid JSON (${invalidJsonReason(error)}). ` +
      "Regenerate it with 'drizzle-kit generate' and pass drizzle/meta/<NNNN>_snapshot.json."
  )
}

/**
 * Parse a Drizzle snapshot file, naming the regeneration route when it is not JSON.
 */
export function parseDrizzleSnapshotJson(path: string, content: string): unknown {
  try {
    return JSON.parse(content)
  } catch (error) {
    throw malformedDrizzleSnapshot(path, error)
  }
}

/**
 * Parse and validate a normalized JSON schema artifact, reporting failures by field.
 *
 * A snapshot that cannot be decoded also cannot be *detected* as Drizzle —
 * `detectOrmFormat` recognizes one only by parsing it — so an unparsable
 * `drizzle/meta/<NNNN>_snapshot.json` arrives here rather than above. Recognize
 * it by path so auto-detected input still gets the regeneration route.
 */
export function parseNormalizedJsonArtifact(path: string, content: string): NormalizedSchema {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error) {
    if (DRIZZLE_SNAPSHOT_PATH.test(path)) throw malformedDrizzleSnapshot(path, error)
    throw new Error(
      `Malformed normalized JSON schema: ${path} is not valid JSON (${invalidJsonReason(error)}).`
    )
  }

  try {
    return { ...normalizedSchemaZod.parse(raw), source: 'json' as const }
  } catch (error) {
    if (!isZodError(error)) throw error
    // Deliberately not `formatConfigValidationError`: that renderer needs the raw
    // input to resolve the connection unions, which this schema never produces.
    const issues = error.issues.map(
      (issue) => `  - ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`
    )
    const shown = issues.slice(0, MAX_REPORTED_ISSUES)
    const hidden = issues.length - shown.length

    throw new Error(
      [
        `Malformed normalized JSON schema: ${path} does not match the normalized schema contract:`,
        ...shown,
        ...(hidden > 0 ? [`  ... and ${hidden} more issue${hidden === 1 ? '' : 's'}.`] : []),
      ].join('\n')
    )
  }
}
