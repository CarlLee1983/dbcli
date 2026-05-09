import type { GuideStep } from '@/core/guide/types'
import type { RecoveryCode } from './types'
import type { AllowWrite, SkipReason } from './apply-types'
import { parseArgv, ShellParseError } from './apply-shell'
import { isAllowedForCode } from './apply-allowlist'

export type GateKind = 'run' | `skipped:${SkipReason}`

export interface GateDecision {
  kind: GateKind
  reason?: string
  /** Populated when kind === 'run'; the parsed argv, ready for spawn. */
  argv?: string[]
}

const PLACEHOLDER_LITERAL_RE = /<[a-zA-Z][a-zA-Z0-9_-]*>/

/**
 * Classify a step according to the v1.17 precedence:
 *   1. interactive
 *   2. placeholder (declared OR literal `<token>` scan)
 *   3. unsafe-command (parse / allowlist failure)
 *   4. risk + allow-write tier
 */
export function classifyStep(
  step: GuideStep,
  allowWrite: AllowWrite,
  code: RecoveryCode
): GateDecision {
  if (step.interactive === true) {
    return {
      kind: 'skipped:interactive',
      reason: 'Step requires interactive TTY; rerun manually.',
    }
  }

  const hasDeclaredPlaceholders = step.placeholders && step.placeholders.length > 0
  if (hasDeclaredPlaceholders || PLACEHOLDER_LITERAL_RE.test(step.command)) {
    const tokens = hasDeclaredPlaceholders
      ? step.placeholders!
      : Array.from(step.command.matchAll(/<[a-zA-Z][a-zA-Z0-9_-]*>/g)).map((m) => m[0])
    return {
      kind: 'skipped:placeholder',
      reason: `Step contains unresolved placeholders: ${tokens.join(', ')}.`,
    }
  }

  let argv: string[]
  try {
    argv = parseArgv(step.command)
  } catch (err) {
    return {
      kind: 'skipped:unsafe-command',
      reason: `Command failed shell-word validation: ${(err as ShellParseError).message}.`,
    }
  }

  if (!isAllowedForCode(argv, code)) {
    return {
      kind: 'skipped:unsafe-command',
      reason: `Command is not in the allowlist for error.code=${code}.`,
    }
  }

  switch (step.risk) {
    case 'readonly':
    case 'dry-run':
      return { kind: 'run', argv }
    case 'write':
    case 'unknown':
      if (step.dbWrite === true && allowWrite !== 'write-cmd') {
        return {
          kind: 'skipped:risk',
          reason: `Step writes to the database; pass --allow-write=write-cmd to run it.`,
        }
      }
      if (step.dbWrite !== true && allowWrite === 'none') {
        return {
          kind: 'skipped:risk',
          reason: `Step is risk=write; pass --allow-write=readonly-cmd to run it.`,
        }
      }
      return { kind: 'run', argv }
    default:
      return {
        kind: 'skipped:risk',
        reason: `Unrecognised risk='${step.risk}'; refusing to execute.`,
      }
  }
}
