import { classifyError } from './classify'
import { renderJson } from './render-json'
import type { RecoveryContext, RecoveryRenderOptions } from './types'

export interface EmitOptions extends RecoveryRenderOptions {
  /** Process exit code; defaults to 1. */
  exitCode?: number
}

/**
 * Print a RecoveryEnvelope to stdout as JSON and exit non-zero.
 *
 * Suppresses the human stderr message — callers should only invoke this when
 * the agent has explicitly opted in (e.g. via `--recovery`). The envelope is
 * agent-readable; we deliberately do not duplicate it on stderr.
 */
export function emitRecoveryEnvelope(
  error: unknown,
  ctx: RecoveryContext,
  options: EmitOptions = {}
): never {
  const envelope = classifyError(error, ctx)
  process.stdout.write(renderJson(envelope, { brief: options.brief === true }) + '\n')
  process.exit(options.exitCode ?? 1)
}
