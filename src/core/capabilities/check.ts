/**
 * Capability requirement checking.
 *
 * Pure: it is handed a context (or a reason there is none) and a requirement
 * list, and returns a report. It never reads a file, an environment variable or
 * a socket — the command layer resolves the context from the local config and
 * passes it in. That separation is what makes "capability check never connects
 * to a database" a property of the module rather than a promise in the docs.
 */

import { permissionAtLeast } from '@/core/permission/rank'
import { findCapability } from './registry'
import {
  CAPABILITY_CONTRACT_SCHEMA_VERSION,
  type CapabilityCheckContext,
  type CapabilityCheckReport,
  type CapabilityCheckResultEntry,
  type CapabilityContextFailure,
} from './types'

export class CapabilityRequirementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityRequirementError'
    Object.setPrototypeOf(this, CapabilityRequirementError.prototype)
  }
}

export interface ParsedRequirements {
  readonly ids: readonly string[]
  readonly warnings: readonly string[]
}

/**
 * Parse `--require a,b,a` into an ordered, unique id list.
 *
 * A repeated id is de-duplicated rather than refused, and the duplication is
 * reported as a warning. Refusing would punish the common case of two Skills
 * concatenating their requirement lists, and answering the same id twice would
 * make `results` a multiset that a consumer has to fold itself. Neither
 * behaviour is guessable, so it is stated here and in the spec.
 *
 * Empty input, or any empty element, is refused: a requirement list that
 * accidentally evaluated to "nothing required" would report `ok: true` and read
 * as a green light.
 */
export function parseRequirements(raw: string): ParsedRequirements {
  const parts = raw.split(',').map((part) => part.trim())

  // `String.split` never yields an empty array, so an all-whitespace input
  // arrives here as a single empty element. One branch covers both.
  if (parts.some((part) => part === '')) {
    throw new CapabilityRequirementError(
      '--require contains an empty capability id; give a comma-separated list such as "schema.read,query.read"'
    )
  }

  const ids: string[] = []
  const duplicates: string[] = []
  for (const part of parts) {
    if (ids.includes(part)) {
      if (!duplicates.includes(part)) duplicates.push(part)
      continue
    }
    ids.push(part)
  }

  return {
    ids,
    warnings: duplicates.map((id) => `Duplicate capability id '${id}' in --require was ignored.`),
  }
}

/**
 * Evaluate one requirement.
 *
 * Blockers are checked least-fixable first, so `reason` names the one that
 * actually stands in the way. Engine cannot be changed at all for this
 * connection; agent mode cannot be lifted from inside the process that is
 * subject to it; permission is a config edit. Reporting `permission` to someone
 * whose engine does not support the operation would send them to fix the wrong
 * thing.
 */
function evaluate(
  id: string,
  context: CapabilityCheckContext | null,
  failure: CapabilityContextFailure
): CapabilityCheckResultEntry {
  const capability = findCapability(id)

  // Fail closed, and never guess. A misspelling that resolved to a neighbouring
  // capability would hand a caller an `available` for something it did not ask
  // for, which is strictly worse than a refusal it can read and correct.
  if (!capability) return { id, status: 'unknown', reason: 'unknown-capability' }

  // Known capability, nothing to evaluate it against. It is not `unknown` —
  // the requirement was understood — and it is emphatically not `available`.
  if (!context) {
    return {
      id,
      status: 'unavailable',
      reason: failure === 'absent' ? 'context-unavailable' : 'context-unresolvable',
    }
  }

  if (!capability.engineIndependent && !capability.engines.includes(context.engine)) {
    return { id, status: 'unavailable', reason: 'engine' }
  }

  if (context.agentMode && capability.mutatesConfiguration) {
    return { id, status: 'unavailable', reason: 'agent-mode' }
  }

  if (!permissionAtLeast(context.permission, capability.minimumPermission)) {
    return { id, status: 'unavailable', reason: 'permission' }
  }

  return { id, status: 'available', reason: null }
}

export function checkCapabilities(
  required: readonly string[],
  context: CapabilityCheckContext | null,
  warnings: readonly string[] = [],
  contextFailure: CapabilityContextFailure = 'absent'
): CapabilityCheckReport {
  const results = required.map((id) => evaluate(id, context, contextFailure))
  const allWarnings = [...warnings]

  if (!context) {
    allWarnings.push(
      contextFailure === 'absent'
        ? 'No dbcli configuration was found here, so engine and permission could not be evaluated.'
        : 'A dbcli configuration exists here but could not be resolved into an engine and a permission, so nothing was evaluated against it.'
    )
  } else if (context.agentMode) {
    allWarnings.push(
      'Agent mode is active (DBCLI_AGENT_MODE=1): configuration, permission and credential changes are refused regardless of permission level.'
    )
  }

  return {
    schemaVersion: CAPABILITY_CONTRACT_SCHEMA_VERSION,
    ok: results.every((result) => result.status === 'available'),
    required: [...required],
    context,
    results,
    warnings: allWarnings,
  }
}
