/**
 * The dbcli Capability Catalog.
 *
 * Per ADR-0022, `ENGINE_CAPABILITIES` in `src/adapters/capabilities.ts` is the
 * authority for every engine and risk claim here. This module declares only
 * what that matrix cannot know — the capability's id, its description, the CLI
 * command path it maps to, and the permission level below which it is refused —
 * and derives the rest. Nothing in this file may hard-code an engine list.
 */

import {
  COMMAND_CAPABILITY_KEYS,
  ENGINE_CAPABILITIES,
  type CommandCapabilityKey,
  type SideEffectTier,
} from '@/adapters/capabilities'
import { DATABASE_SYSTEMS, type DatabaseSystem } from '@/adapters/types'
import type { Permission } from '@/types'
import { minimumPermissionFor, type StatementType } from '@/core/permission-guard'
import { CAPABILITY_CONTRACT_SCHEMA_VERSION, type Capability, type CapabilityRisk } from './types'

/**
 * Everything the matrix does not carry.
 *
 * `requiresConnection` is declared rather than derived because no existing
 * structure records it: `status` says whether an engine supports the command,
 * not whether running it opens a socket. The claim that matters — a capability
 * saying it does *not* need a connection — is the one a caller would be misled
 * by, so `tests/contract/capability-contract.test.ts` proves it against the
 * command's static import graph rather than trusting this table.
 */
interface CapabilityDeclaration {
  readonly id: string
  readonly key: CommandCapabilityKey
  readonly command: string
  readonly description: string
  /**
   * The SQL statement type this capability's primary path issues, when there is
   * one. Given it, `minimumPermission` is derived from `TIER_GRANTS` — the same
   * table the runtime refusal uses — rather than transcribed here, so the two
   * cannot drift. `permission` is for the capabilities no statement type
   * describes; those are covered by unit tests instead.
   */
  readonly statementType?: StatementType
  readonly permission?: Permission
  readonly requiresConnection: boolean
  /**
   * Whether the capability changes connection identity, permission or
   * credentials. Asserted against the real import graph by
   * `tests/contract/capability-contract.test.ts`, not trusted from here.
   */
  readonly mutatesConfiguration?: boolean
}

/**
 * Declared in source order for readability; the exported catalog is sorted by
 * id, so this order is never observable.
 *
 * Ids read `<domain>.<ability>` and name what the *tool* can do. A job title or
 * a method ("dba.tune", "cqrs.project") would belong to a Skill composing dbcli,
 * never to dbcli itself.
 */
const DECLARATIONS: readonly CapabilityDeclaration[] = [
  {
    id: 'connection.init',
    key: 'init',
    command: 'init',
    description: 'Create or update a local connection configuration interactively.',
    permission: 'query-only',
    requiresConnection: true,
    mutatesConfiguration: true,
  },
  {
    id: 'connection.select',
    key: 'use',
    command: 'use',
    description: 'Switch the default named connection in a v2 configuration.',
    permission: 'query-only',
    requiresConnection: false,
    mutatesConfiguration: true,
  },
  {
    id: 'connection.status',
    key: 'status',
    command: 'status',
    description:
      'Report the configured engine, permission and blacklist counts without credentials.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'connection.diagnose',
    key: 'doctor',
    command: 'doctor',
    description: 'Run engine-specific connectivity and configuration diagnostics.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.list-tables',
    key: 'list',
    command: 'list',
    description: 'List the tables, collections or indices visible to the connection.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.read',
    key: 'schema',
    command: 'schema',
    description: 'Read visible schema metadata for one object or the whole database.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.read-object',
    key: 'schemaSingle',
    command: 'schema',
    description: 'Read the column or field structure of a single named object.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.scan',
    key: 'schemaFullScan',
    command: 'schema',
    description: 'Scan every visible object and refresh the local schema cache.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.diff',
    key: 'diff',
    command: 'diff',
    description: 'Compare schema snapshots and report structural differences.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.migrate',
    key: 'migrate',
    command: 'migrate',
    description: 'Apply guarded DDL changes such as columns, indexes and constraints.',
    statementType: 'ALTER',
    requiresConnection: true,
  },
  {
    id: 'query.read',
    key: 'query',
    command: 'query',
    description: 'Run a read query through the permission, blacklist and audit gates.',
    statementType: 'SELECT',
    requiresConnection: true,
  },
  {
    id: 'query.lint',
    key: 'lint',
    command: 'lint',
    description: 'Statically analyse SQL without connecting to the database.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'query.format',
    key: 'queryOutput',
    command: 'query',
    description: 'Render query results as a table, JSON or CSV.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'query.limit-guard',
    key: 'queryLimitGuard',
    command: 'query',
    description: 'Bound result size automatically and report the limit that was applied.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'query.shell',
    key: 'shell',
    command: 'shell',
    description: 'Open an interactive gated query shell.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'snippet.run',
    key: 'q',
    command: 'q',
    description: 'Execute a saved read-only query snippet with parameters.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'snippet.manage',
    key: 'queries',
    command: 'queries',
    description: 'Create, edit, search and validate saved query snippets.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'data.insert',
    key: 'insert',
    command: 'insert',
    description: 'Insert rows or documents through the write gate.',
    statementType: 'INSERT',
    requiresConnection: true,
  },
  {
    id: 'data.update',
    key: 'update',
    command: 'update',
    description: 'Update rows or documents through the write gate.',
    statementType: 'UPDATE',
    requiresConnection: true,
  },
  {
    id: 'data.delete',
    key: 'delete',
    command: 'delete',
    description: 'Delete rows or documents through the write gate.',
    statementType: 'DELETE',
    requiresConnection: true,
  },
  {
    id: 'data.export',
    key: 'export',
    command: 'export',
    description: 'Export query or object contents to a file, subject to the blacklist.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'data.health-check',
    key: 'check',
    command: 'check',
    description: 'Check data health: nulls, orphans, duplicates and empty strings.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'blacklist.manage',
    key: 'blacklist',
    command: 'blacklist',
    description: 'Inspect and edit the table, column and key rules that hide sensitive data.',
    permission: 'query-only',
    requiresConnection: false,
    mutatesConfiguration: true,
  },
  {
    id: 'context.inspect',
    key: 'inspect',
    command: 'inspect',
    description: 'Produce a bounded agent context snapshot of the configured database.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'diagnostic.report',
    key: 'report',
    command: 'report',
    description: 'Produce a diagnostic report about the configured database.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'guide.plan',
    key: 'guide',
    command: 'guide',
    description: 'Suggest the next deterministic command for a stated goal.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'recovery.plan',
    key: 'recover',
    command: 'recover',
    description: 'Read the saved recovery envelope and plan or apply safe remediation steps.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.tail',
    key: 'auditTail',
    command: 'audit tail',
    description: 'Read recent audit entries from the local log.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.show',
    key: 'auditShow',
    command: 'audit show',
    description: 'Look up one audit entry by id prefix or recovery reference.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.health',
    key: 'auditHealth',
    command: 'audit health',
    description: 'Report audit log health and rotation state.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.clear',
    key: 'auditClear',
    command: 'audit clear',
    description: 'Remove the local audit log files for a connection.',
    permission: 'admin',
    requiresConnection: false,
  },
  {
    id: 'skill.install',
    key: 'skill',
    command: 'skill',
    description: 'Write the dbcli skill and task-pack assets into a platform directory.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'shell-completion.generate',
    key: 'completion',
    command: 'completion',
    description: 'Emit a shell completion script for the current command tree.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'package.upgrade-check',
    key: 'upgrade',
    command: 'upgrade',
    description: 'Check whether a newer dbcli release is available.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'query.explain',
    key: 'explain',
    command: 'explain',
    description: 'Read the engine execution plan for a statement without running it as a write.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'query.plan-risk',
    key: 'plan',
    command: 'plan',
    description: 'Assess the write risk of a statement offline, against the cached schema.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'schema.impact-assess',
    key: 'impactAssess',
    command: 'impact assess',
    description: 'Assess the known effects of a proposed schema change offline.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'data.assert',
    key: 'assert',
    command: 'assert',
    description: 'Check a data expectation and report a pass or fail verdict.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'data.snapshot',
    key: 'snapshot',
    command: 'snapshot',
    description: 'Capture a result fingerprint for later comparison.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'verification.run',
    key: 'verify',
    command: 'verify',
    description: 'Verify a named change scenario and record the outcome.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'verification.inspect',
    key: 'verification',
    command: 'verification',
    description: 'Inspect locally stored verification artifacts.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'verification.prune',
    key: 'verificationPrune',
    command: 'verification prune',
    description: 'Delete locally stored verification artifacts by age or subject.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'evidence.pack',
    key: 'evidence',
    command: 'evidence',
    description: 'Compose, validate and render an evidence pack from local artifacts.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'semantic.context',
    key: 'semantic',
    command: 'semantic',
    description: 'Author and validate governed semantic context over the cached schema.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'semantic.contract',
    key: 'contract',
    command: 'contract',
    description: 'Validate and search governed business contracts offline.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'schema.design',
    key: 'design',
    command: 'design',
    description: 'Author a schema design and compare it against the database or an ORM.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'diagnostic.proxy',
    key: 'proxy',
    command: 'proxy',
    description: 'Run a local observing proxy in front of a supported SQL engine.',
    permission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'diagnostic.proxy-analyze',
    key: 'proxyAnalyze',
    command: 'proxy analyze',
    description: 'Analyse locally recorded proxy events without contacting an engine.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'recovery.codes',
    key: 'recovery',
    command: 'recovery',
    description: 'Describe a recovery code and its remediation steps.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'data.backfill-artifact',
    key: 'backfillArtifact',
    command: 'backfill artifact',
    description: 'Build a backfill artifact from a source manifest and a connection identity.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'connection.rotate-credential',
    key: 'password',
    command: 'password',
    description: 'Change the stored credential for a single connection.',
    permission: 'query-only',
    requiresConnection: true,
    mutatesConfiguration: true,
  },
  {
    id: 'capability.discover',
    key: 'capabilityDiscover',
    command: 'capabilities',
    description: 'List the static capability catalog this build publishes.',
    permission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'capability.check',
    key: 'capabilityCheck',
    command: 'capabilities check',
    description: 'Check whether required capability ids are available in this project.',
    permission: 'query-only',
    requiresConnection: false,
  },
]

/**
 * Fold the six-value side-effect tier into the four-value risk vocabulary the
 * Agent Task Pack contract already uses.
 *
 * `local-write` and `db-write` both become `write`; the caller that needs them
 * apart reads `sideEffect`, which is carried unfolded. `interactive` is `write`
 * rather than `unknown` because a REPL's ceiling is whatever the session's
 * permission allows, and describing that as unknown would understate it.
 */
export function riskForSideEffect(tier: SideEffectTier): CapabilityRisk {
  switch (tier) {
    case 'readonly':
    case 'none':
      return 'readonly'
    case 'dry-run':
      return 'dry-run'
    case 'local-write':
    case 'db-write':
    case 'interactive':
      return 'write'
    default:
      return 'unknown'
  }
}

function enginesFor(key: CommandCapabilityKey): {
  engines: readonly DatabaseSystem[]
  limitedEngines: readonly DatabaseSystem[]
  engineIndependent: boolean
} {
  const statuses = DATABASE_SYSTEMS.map((system) => ({
    system,
    status: ENGINE_CAPABILITIES[system][key].status,
  }))

  // `not-applicable` everywhere means the command does not consult the engine
  // at all, so every configured engine can run it. Listing none would read as
  // "supported nowhere", which is the opposite of what the matrix is saying.
  if (statuses.every((entry) => entry.status === 'not-applicable')) {
    return { engines: [...DATABASE_SYSTEMS], limitedEngines: [], engineIndependent: true }
  }

  return {
    engines: statuses
      .filter((entry) => entry.status === 'supported' || entry.status === 'limited')
      .map((entry) => entry.system),
    limitedEngines: statuses
      .filter((entry) => entry.status === 'limited')
      .map((entry) => entry.system),
    engineIndependent: false,
  }
}

/**
 * The tier a capability is published with.
 *
 * A key may carry different tiers per engine. The published risk is the most
 * severe one among the engines that actually support it, so a caller reading
 * the catalog before choosing an engine is never told something is cheaper than
 * it can be.
 */
const TIER_SEVERITY: Readonly<Record<SideEffectTier, number>> = Object.freeze({
  none: 0,
  readonly: 1,
  'dry-run': 2,
  'local-write': 3,
  interactive: 4,
  'db-write': 5,
})

function sideEffectFor(
  key: CommandCapabilityKey,
  engines: readonly DatabaseSystem[]
): SideEffectTier {
  const considered = engines.length > 0 ? engines : DATABASE_SYSTEMS
  let worst: SideEffectTier = 'none'
  for (const system of considered) {
    const tier = ENGINE_CAPABILITIES[system][key].tier
    if (TIER_SEVERITY[tier] > TIER_SEVERITY[worst]) worst = tier
  }
  return worst
}

/**
 * Facts about the command surface that only the CLI layer can answer.
 *
 * Passed in rather than imported so this module stays free of Commander and of
 * the command modules' import graphs: `capabilities` must not drag forty
 * command modules — or a database adapter — into memory to describe itself. The
 * contract test supplies the real values from the live tree.
 */
export interface CommandSurfaceFacts {
  readonly jsonCommands: ReadonlySet<string>
  readonly evidenceCommands: ReadonlySet<string>
}

/**
 * Which command paths expose a JSON output option, and which emit an evidence
 * receipt. Static, and asserted against the live Commander tree and the real
 * import graph by `tests/contract/capability-contract.test.ts`.
 */
export const COMMAND_SURFACE: CommandSurfaceFacts = Object.freeze({
  jsonCommands: Object.freeze(
    // Exactly the paths whose own Commander node offers `--format json` or
    // `--json`. `blacklist`, `migrate` and `queries` are absent on purpose:
    // JSON lives on their subcommands, and a capability may only claim what
    // the path it names actually offers. The contract test derives this same
    // set from the live tree and fails on any disagreement.
    new Set([
      'use',
      'status',
      'doctor',
      'list',
      'schema',
      'diff',
      'query',
      'lint',
      'q',
      'insert',
      'update',
      'delete',
      'export',
      'check',
      'inspect',
      'report',
      'guide',
      'recover',
      'audit tail',
      'audit show',
      'audit health',
      // DBCLI-PLAT-011. `verify`, `semantic`, `design`, `evidence`, `contract`
      // and `backfill artifact` are absent for the same reason `blacklist` and
      // `migrate` are: their own node offers no `--format`, only their
      // subcommands do, and a capability may claim only what the path it names
      // actually offers.
      'explain',
      'plan',
      'impact assess',
      'assert',
      'snapshot',
      'verification prune',
      'proxy',
      'proxy analyze',
      'recovery',
      'password',
      'capabilities',
      'capabilities check',
    ])
  ) as ReadonlySet<string>,
  evidenceCommands: Object.freeze(
    // A command emits a receipt when it writes a verification artifact or an
    // evidence pack. Empty until DBCLI-PLAT-011 audited the sixteen commands
    // the catalog did not cover — and `recover`, which was catalogued all
    // along and has written an artifact under `--write-verification-artifact`
    // since before the contract existed.
    new Set([
      'assert',
      'insert',
      'update',
      'delete',
      'verify',
      'recover',
      'evidence',
      'inspect',
      'report',
      'schema',
      'plan',
      'lint',
      'explain',
      'impact assess',
    ])
  ) as ReadonlySet<string>,
})

/**
 * The permission below which the capability is refused.
 *
 * Derived from `minimumPermissionFor` — the same `TIER_GRANTS` table the runtime
 * refusal consults — whenever the capability maps to a SQL statement type.
 * Transcribing those four levels here would be a second permission ladder, and
 * a second ladder diverges the first time a tier is added.
 */
function minimumPermissionOf(declaration: CapabilityDeclaration): Permission {
  if (declaration.statementType) return minimumPermissionFor(declaration.statementType)
  if (declaration.permission) return declaration.permission
  throw new Error(`capability ${declaration.id} declares neither statementType nor permission`)
}

function build(declaration: CapabilityDeclaration, surface: CommandSurfaceFacts): Capability {
  const { engines, limitedEngines, engineIndependent } = enginesFor(declaration.key)
  const sideEffect = sideEffectFor(declaration.key, engines)

  return Object.freeze({
    id: declaration.id,
    description: declaration.description,
    command: declaration.command,
    risk: riskForSideEffect(sideEffect),
    sideEffect,
    engines: Object.freeze([...engines]),
    limitedEngines: Object.freeze([...limitedEngines]),
    engineIndependent,
    minimumPermission: minimumPermissionOf(declaration),
    requiresConnection: declaration.requiresConnection,
    mutatesConfiguration: declaration.mutatesConfiguration ?? false,
    supportsJson: surface.jsonCommands.has(declaration.command),
    supportsEvidence: surface.evidenceCommands.has(declaration.command),
  })
}

/**
 * Every capability, sorted by id.
 *
 * Sorting is the whole determinism guarantee: two builds of the same version
 * emit byte-identical catalogs regardless of declaration order, so a consumer
 * can diff two outputs and see only real changes.
 */
export const CAPABILITIES: readonly Capability[] = Object.freeze(
  DECLARATIONS.map((declaration) => build(declaration, COMMAND_SURFACE)).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  )
)

const BY_ID: ReadonlyMap<string, Capability> = new Map(
  CAPABILITIES.map((capability) => [capability.id, capability])
)

export function findCapability(id: string): Capability | undefined {
  return BY_ID.get(id)
}

export function listCapabilityIds(): readonly string[] {
  return CAPABILITIES.map((capability) => capability.id)
}

/** The catalog as an external consumer receives it. */
export function buildCapabilityCatalog(): {
  schemaVersion: typeof CAPABILITY_CONTRACT_SCHEMA_VERSION
  capabilities: readonly Capability[]
} {
  return { schemaVersion: CAPABILITY_CONTRACT_SCHEMA_VERSION, capabilities: CAPABILITIES }
}

/** The declaration table, exposed so contract tests can check key coverage. */
export const CAPABILITY_DECLARATIONS = DECLARATIONS
export const DECLARED_CAPABILITY_KEYS: readonly CommandCapabilityKey[] =
  Object.freeze(COMMAND_CAPABILITY_KEYS)
