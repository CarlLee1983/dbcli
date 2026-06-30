import { writeFileSync, mkdirSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto' // Phase 25 D-51
import { classifyError } from './classify'
import { renderJson } from './render-json'
import { LAST_ENVELOPE_PATH, sanitizeCommandSummary } from './last-envelope'
import type { RecoveryContext, RecoveryEnvelope, RecoveryRenderOptions } from './types'
import type { SavedRecoveryEnvelope } from './apply-types'

export interface EmitOptions extends RecoveryRenderOptions {
  /** Process exit code; defaults to 1. */
  exitCode?: number
  /** Override argv for the saved-command summary; defaults to derived `process.argv`. */
  argv?: string[]
  /** Override cwd for the saved file; defaults to `process.cwd()`. */
  cwd?: string
  /** Phase 25 D-51: pre-generated envelope id. Defaults to crypto.randomUUID() when omitted. */
  envelopeId?: string
  /** Phase 25 D-53: audit entry id captured by caller's writeAuditEntry. Undefined when audit disabled / failed. */
  auditRef?: string
}

/**
 * Print a RecoveryEnvelope to stdout as JSON, persist it to
 * `.dbcli/last-recovery.json` (best-effort, synchronous), and exit non-zero.
 */
export function emitRecoveryEnvelope(
  error: unknown,
  ctx: RecoveryContext,
  options: EmitOptions = {}
): never {
  const envelope = classifyError(error, ctx)
  const cwd = options.cwd ?? process.cwd()
  const argv = options.argv ?? buildArgvFromProcess()
  // Phase 25 D-51 / I1: pre-generate envelope id at entry; caller may also supply one.
  const envelopeId = options.envelopeId ?? randomUUID()
  writeLastEnvelopeSync(cwd, envelope, argv, envelopeId, options.auditRef)
  // D-52: stdout shape is RecoveryEnvelope body, NOT SavedRecoveryEnvelope wrapper. Unchanged.
  // Use a synchronous fd-1 write rather than process.stdout.write: when stdout
  // is a pipe (e.g. a spawned subprocess), Windows can truncate the async
  // buffer on the immediately-following process.exit(), losing the output.
  writeSync(1, renderJson(envelope, { brief: options.brief === true }) + '\n')
  process.exit(options.exitCode ?? 1)
}

function buildArgvFromProcess(): string[] {
  // process.argv is `[bun, script, ...]`; we want a `dbcli ...` shape.
  const userArgs = process.argv.slice(2)
  return ['dbcli', ...userArgs]
}

function writeLastEnvelopeSync(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  id: string, // Phase 25 D-51
  auditRef: string | undefined // Phase 25 D-53
): void {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    id,
    ...(auditRef !== undefined && { audit_ref: auditRef }), // D-53: omit when undefined
    savedAt: new Date().toISOString(),
    command: sanitizeCommandSummary(argv),
    cwd,
    envelope,
  }
  try {
    // Write directly to the target (no temp+rename): this runs immediately
    // before process.exit(), and a plain synchronous writeFileSync is the most
    // portable durable write — the temp+rename dance added Windows fragility for
    // no real benefit on a small best-effort file.
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8')
  } catch {
    // Best-effort: writes are warnings, not errors.
  }
}
