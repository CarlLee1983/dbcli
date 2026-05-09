import type { GuideStep } from '@/core/guide/types'
import type { RecoveryCode } from './types'
import type { AllowWrite, ApplyTier, SkipReason } from './apply-types'
import { parseArgv, ShellParseError } from './apply-shell'
import { classifyArgvForCode } from './apply-allowlist'

export type GateKind = 'run' | `skipped:${SkipReason}`

export interface GateDecision {
  kind: GateKind
  reason?: string
  /** Populated when kind === 'run'; the parsed argv, ready for spawn. */
  argv?: string[]
  /** Populated when kind === 'run'; the code-owned tier from the allowlist. */
  tier?: ApplyTier
}

const PLACEHOLDER_LITERAL_RE = /<[a-zA-Z][a-zA-Z0-9_-]*>/

/**
 * Classify a step. Precedence (display order — all skips are safe):
 *   1. envelope `interactive: true` hint (early exit; widening only)
 *   2. placeholder (declared OR literal `<token>` scan)
 *   3. unsafe-command (parse failure)
 *   4. unsafe-command (allowlist miss for this error.code)
 *   5. allowlist tier === 'interactive' (defense for falsified envelope)
 *   6. risk + allow-write tier — driven by the **code-owned** allowlist tier.
 *
 * Trust boundary: envelope hints (`risk`, `dbWrite`, `interactive`) only
 * widen safety (skip more steps). They cannot escalate execution. The
 * authoritative tier comes from {@link classifyArgvForCode}.
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

  const cls = classifyArgvForCode(argv, code)
  if (cls.kind === 'unsafe') {
    return { kind: 'skipped:unsafe-command', reason: cls.reason }
  }

  if (cls.tier === 'interactive') {
    return {
      kind: 'skipped:interactive',
      reason: 'Step requires interactive TTY; rerun manually.',
    }
  }

  switch (cls.tier) {
    case 'readonly':
    case 'dry-run':
      return { kind: 'run', argv, tier: cls.tier }
    case 'local-write':
      if (allowWrite === 'none') {
        return {
          kind: 'skipped:risk',
          reason: 'Step writes local config/cache; pass --allow-write=readonly-cmd to run it.',
        }
      }
      return { kind: 'run', argv, tier: cls.tier }
    case 'db-write':
      if (allowWrite !== 'write-cmd') {
        return {
          kind: 'skipped:risk',
          reason: 'Step writes to the database; pass --allow-write=write-cmd to run it.',
        }
      }
      return { kind: 'run', argv, tier: cls.tier }
  }
}
