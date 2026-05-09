import { writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
  writeLastEnvelopeSync(cwd, envelope, argv)
  process.stdout.write(renderJson(envelope, { brief: options.brief === true }) + '\n')
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
  argv: string[]
): void {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    command: sanitizeCommandSummary(argv),
    cwd,
    envelope,
  }
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, target)
  } catch {
    // Best-effort: writes are warnings, not errors.
  }
}
