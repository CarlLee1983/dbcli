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
  /**
   * The subset of `engines` the matrix marks `limited` rather than `supported`.
   *
   * Carried separately because folding it into `engines` would discard
   * information the matrix already holds: `data.delete` works on Redis, but not
   * the way it works on PostgreSQL, and a caller choosing an engine deserves to
   * know which before it commits.
   */
  readonly limitedEngines: readonly DatabaseSystem[]
  /** True when the capability works irrespective of the configured engine. */
  readonly engineIndependent: boolean
  readonly minimumPermission: Permission
  readonly requiresConnection: boolean
  /**
   * True when the capability changes connection identity, permission or
   * credentials — the class of change `DBCLI_AGENT_MODE=1` refuses outright.
   */
  readonly mutatesConfiguration: boolean
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
 *
 * `context-unresolvable` is a *different* fact from `context-unavailable`, and
 * conflating them was a real defect: a config whose `{"$env": "..."}` password
 * reference points at an unset variable is present and perfectly readable, and
 * reporting "no configuration was readable" there states something false. This
 * command needs no credential, but the one config reader resolves them before
 * it will answer, so the honest report is "a config exists and could not be
 * turned into an evaluable context" — never "there is no config".
 *
 * `agent-mode` is an environment gate, not an execution-time one. Under
 * `DBCLI_AGENT_MODE=1` every configuration, permission and credential change is
 * refused unconditionally, and that is fully knowable without connecting. The
 * "available is not approval" disclaimer does not cover it: blacklist and human
 * consent are decided at execution time, whereas this is decided here, and the
 * contract's primary consumer is exactly the agent the flag describes.
 */
export type CapabilityUnavailableReason =
  | 'unknown-capability'
  | 'context-unavailable'
  | 'context-unresolvable'
  | 'engine'
  | 'agent-mode'
  | 'permission'

export interface CapabilityCheckContext {
  readonly engine: DatabaseSystem
  readonly permission: Permission
  /** Named v2 connection in effect, or null for a v1/single-connection config. */
  readonly connectionName: string | null
  /** `DBCLI_AGENT_MODE=1`: configuration changes are refused unconditionally. */
  readonly agentMode: boolean
}

/**
 * Why there is no context, when there is none.
 *
 * `absent` means nothing is configured here. `unresolvable` means something is,
 * and it could not be turned into an engine and a permission. Only the first
 * justifies telling a caller there is no configuration.
 */
export type CapabilityContextFailure = 'absent' | 'unresolvable'

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
