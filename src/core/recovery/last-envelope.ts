import { writeFile, readFile, rename, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto' // Phase 25
import type { RecoveryEnvelope } from './types'
import type { SavedRecoveryEnvelope } from './apply-types'

export const LAST_ENVELOPE_PATH = '.dbcli/last-recovery.json'

const SQL_SUBCOMMANDS = new Set(['query', 'export'])
const REDACTED_VALUE_FLAGS = new Set([
  '--where',
  '--set',
  '--data',
  '--param',
  '--param-file',
  '--config',
  '--use',
])
const KEEP_VALUE_FLAGS = new Set(['--format'])

/**
 * Sanitize argv into a stable summary suitable for saving to disk.
 */
export function sanitizeCommandSummary(argv: string[]): string {
  if (argv.length === 0) return '<unknown>'
  const out: string[] = [argv[0]!]
  if (argv.length === 1) return out.join(' ')

  const sub = argv[1]!
  out.push(sub)

  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!
    if (tok.startsWith('--')) {
      const [name, inlineValue] = tok.split('=') as [string, string | undefined]
      if (REDACTED_VALUE_FLAGS.has(name)) {
        out.push(`${name} <redacted>`)
        if (inlineValue === undefined) i++
        continue
      }
      if (KEEP_VALUE_FLAGS.has(name)) {
        if (inlineValue !== undefined) {
          out.push(tok)
        } else {
          out.push(name)
          if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
            out.push(argv[++i]!)
          }
        }
        continue
      }
      out.push(tok)
      continue
    }
    if (i === 2 && SQL_SUBCOMMANDS.has(sub)) {
      out.push('<sql>')
      continue
    }
    out.push(tok)
  }
  return out.join(' ')
}

export async function writeLastEnvelope(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  now: () => Date = () => new Date(),
  id: string = randomUUID(), // Phase 25 D-51: default so test callers don't have to pre-gen
  auditRef?: string // Phase 25 D-53
): Promise<void> {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    id,
    ...(auditRef !== undefined && { audit_ref: auditRef }),
    savedAt: now().toISOString(),
    command: sanitizeCommandSummary(argv),
    cwd,
    envelope,
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, target)
  } catch {
    // Best-effort: writes are warnings, not errors.
  }
}

export async function readLastEnvelope(cwd: string): Promise<SavedRecoveryEnvelope | null> {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  try {
    await stat(target)
  } catch {
    return null
  }
  try {
    const raw = await readFile(target, 'utf8')
    return JSON.parse(raw) as SavedRecoveryEnvelope
  } catch {
    return null
  }
}

/**
 * Read `.dbcli/last-recovery.json` as `unknown` for downstream schema validation.
 * Returns `null` only when the file is missing or unreadable. Malformed JSON also
 * yields `null` (so callers can surface a stable "no envelope" message); strict
 * shape validation belongs in the caller (`parseSavedRecoveryEnvelope`).
 */
export async function readLastEnvelopeRaw(cwd: string): Promise<unknown | null> {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  try {
    await stat(target)
  } catch {
    return null
  }
  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    // Malformed JSON: surface as a structured "malformed" via the schema parser
    // rather than collapsing to "missing". Caller decides how to message.
    return { __malformedJson: true, raw }
  }
}
