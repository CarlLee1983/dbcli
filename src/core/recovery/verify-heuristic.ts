import type { RecoveryCode } from './types'
import type { ExecOutcome } from './apply-exec'
import type { VerifyStatus } from './apply-types'

/**
 * Map a verifier's exit code + stdout into a heuristic verdict.
 *
 * - `failed`        — verifier exited non-zero or timed out.
 * - `passed`        — verifier exited 0 AND, when applicable, a code-specific
 *                     stdout shape check confirms the original error
 *                     condition is no longer present.
 * - `indeterminate` — verifier exited 0 but the code-specific check could
 *                     not be evaluated (missing field, bad JSON, falsy flag).
 *
 * Heuristic-only by design: we do not re-run the original failing operation.
 * False positives are accepted; the verifier is a hint, not a guarantee.
 */
export function evaluateVerify(code: RecoveryCode, outcome: ExecOutcome): VerifyStatus {
  if (outcome.timedOut) return 'failed'
  if (outcome.exitCode !== 0) return 'failed'

  switch (code) {
    case 'CONFIG_MISSING':
      return checkTruthyPath(outcome.stdout, ['connection', 'name']) ? 'passed' : 'indeterminate'
    case 'SCHEMA_CACHE_MISSING':
      return checkExactValue(outcome.stdout, ['schemaCache', 'available'], true)
        ? 'passed'
        : 'indeterminate'
    default:
      return 'passed'
  }
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function readPath(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function checkTruthyPath(text: string, path: readonly string[]): boolean {
  const obj = parseJsonSafely(text)
  if (obj === undefined) return false
  const v = readPath(obj, path)
  return v !== null && v !== undefined && v !== '' && v !== false
}

function checkExactValue(text: string, path: readonly string[], expected: unknown): boolean {
  const obj = parseJsonSafely(text)
  if (obj === undefined) return false
  return readPath(obj, path) === expected
}
