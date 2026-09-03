/**
 * The dbcli Capability Contract.
 *
 * A capability names an atomic tool ability. Composing those abilities into a
 * job — CRUD engineering, CQRS projection work, DBA operations — is the
 * business of the Skill that calls dbcli, and deliberately not of dbcli. See
 * ADR-0022.
 */

export {
  CAPABILITY_CONTRACT_SCHEMA_VERSION,
  type Capability,
  type CapabilityCatalog,
  type CapabilityRisk,
  type CapabilityCheckContext,
  type CapabilityCheckReport,
  type CapabilityCheckResultEntry,
  type CapabilityCheckStatus,
  type CapabilityUnavailableReason,
} from './types'

export {
  CAPABILITIES,
  buildCapabilityCatalog,
  findCapability,
  listCapabilityIds,
  riskForSideEffect,
  COMMAND_SURFACE,
  CAPABILITY_DECLARATIONS,
  DECLARED_CAPABILITY_KEYS,
} from './registry'

export {
  CapabilityRequirementError,
  checkCapabilities,
  parseRequirements,
  type ParsedRequirements,
} from './check'

export {
  CapabilityContractError,
  parseCapabilityCatalog,
  parseCapabilityCheckReport,
} from './schema'
