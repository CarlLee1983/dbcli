/**
 * Agent-facing Capability Contract — types.
 *
 * A capability names an *atomic tool ability* dbcli has ("read visible schema
 * metadata"), never a job or a method ("review this migration as a DBA"). Role
 * and method knowledge belongs in the Skills that compose dbcli, not in dbcli.
 *
 * `CAPABILITY_CONTRACT_SCHEMA_VERSION` is the contract's own version and is
 * deliberately independent of the npm package version, matching ADR 0013 for
 * the verification artifact. A consumer pins this number, not `7.x`.
 */

import type { DatabaseSystem } from '@/adapters/types'
import type { SideEffectTier } from '@/adapters/capabilities'
import type { Permission } from '@/types'

export const CAPABILITY_CONTRACT_SCHEMA_VERSION = 1 as const

/**
 * Risk vocabulary, reused verbatim from the Agent Task Pack contract
 * (`AgentTaskRisk`) so a pack's step risk and a capability's risk are the same
 * four words. `sideEffect` carries the finer existing `SideEffectTier` beside
 * it, because collapsing `local-write` and `db-write` into `write` would hide
 * the one distinction a caller most needs.
 */
export type CapabilityRisk = 'readonly' | 'dry-run' | 'write' | 'unknown'

export interface Capability {
  /** Stable dotted id, e.g. `schema.read`. The value external Skills pin. */
  readonly id: string
  readonly description: string
  /** Space-separated live CLI command path, e.g. `audit tail`. */
  readonly command: string
  readonly risk: CapabilityRisk
  /** The precise pre-existing side-effect tier this risk was derived from. */
  readonly sideEffect: SideEffectTier
  /** Engines on which the capability is supported or limited, sorted. */
  readonly engines: readonly DatabaseSystem[]
  /** True when the capability works irrespective of the configured engine. */
  readonly engineIndependent: boolean
  readonly minimumPermission: Permission
  readonly requiresConnection: boolean
  readonly supportsJson: boolean
  readonly supportsEvidence: boolean
}

export interface CapabilityCatalog {
  readonly schemaVersion: typeof CAPABILITY_CONTRACT_SCHEMA_VERSION
  readonly capabilities: readonly Capability[]
}

// ── capabilities check ───────────────────────────────────

export type CapabilityCheckStatus = 'available' | 'unavailable' | 'unknown'

/**
 * Why a capability is not available. `null` only ever accompanies `available`.
 *
 * `context-unavailable` is distinct from `engine`/`permission` on purpose: with
 * no local config there is nothing to evaluate against, and reporting that as
 * an engine mismatch would invent a fact. It is still not `available` — absence
 * of context never reads as permission to act.
 */
export type CapabilityUnavailableReason =
  | 'unknown-capability'
  | 'context-unavailable'
  | 'engine'
  | 'permission'

export interface CapabilityCheckContext {
  readonly engine: DatabaseSystem
  readonly permission: Permission
  /** Named v2 connection in effect, or null for a v1/single-connection config. */
  readonly connectionName: string | null
}

export interface CapabilityCheckResultEntry {
  readonly id: string
  readonly status: CapabilityCheckStatus
  readonly reason: CapabilityUnavailableReason | null
}

export interface CapabilityCheckReport {
  readonly schemaVersion: typeof CAPABILITY_CONTRACT_SCHEMA_VERSION
  readonly ok: boolean
  /** The de-duplicated requirement list, in first-seen order. */
  readonly required: readonly string[]
  readonly context: CapabilityCheckContext | null
  readonly results: readonly CapabilityCheckResultEntry[]
  readonly warnings: readonly string[]
}
