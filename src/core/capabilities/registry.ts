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
  readonly minimumPermission: Permission
  readonly requiresConnection: boolean
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
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'connection.select',
    key: 'use',
    command: 'use',
    description: 'Switch the default named connection in a v2 configuration.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'connection.status',
    key: 'status',
    command: 'status',
    description:
      'Report the configured engine, permission and blacklist counts without credentials.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'connection.diagnose',
    key: 'doctor',
    command: 'doctor',
    description: 'Run engine-specific connectivity and configuration diagnostics.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.list-tables',
    key: 'list',
    command: 'list',
    description: 'List the tables, collections or indices visible to the connection.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.read',
    key: 'schema',
    command: 'schema',
    description: 'Read visible schema metadata for one object or the whole database.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.read-object',
    key: 'schemaSingle',
    command: 'schema',
    description: 'Read the column or field structure of a single named object.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.scan',
    key: 'schemaFullScan',
    command: 'schema',
    description: 'Scan every visible object and refresh the local schema cache.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.diff',
    key: 'diff',
    command: 'diff',
    description: 'Compare schema snapshots and report structural differences.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'schema.migrate',
    key: 'migrate',
    command: 'migrate',
    description: 'Apply guarded DDL changes such as columns, indexes and constraints.',
    minimumPermission: 'admin',
    requiresConnection: true,
  },
  {
    id: 'query.read',
    key: 'query',
    command: 'query',
    description: 'Run a read query through the permission, blacklist and audit gates.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'query.lint',
    key: 'lint',
    command: 'lint',
    description: 'Statically analyse SQL without connecting to the database.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'query.format',
    key: 'queryOutput',
    command: 'query',
    description: 'Render query results as a table, JSON or CSV.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'query.limit-guard',
    key: 'queryLimitGuard',
    command: 'query',
    description: 'Bound result size automatically and report the limit that was applied.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'query.shell',
    key: 'shell',
    command: 'shell',
    description: 'Open an interactive gated query shell.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'snippet.run',
    key: 'q',
    command: 'q',
    description: 'Execute a saved read-only query snippet with parameters.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'snippet.manage',
    key: 'queries',
    command: 'queries',
    description: 'Create, edit, search and validate saved query snippets.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'data.insert',
    key: 'insert',
    command: 'insert',
    description: 'Insert rows or documents through the write gate.',
    minimumPermission: 'read-write',
    requiresConnection: true,
  },
  {
    id: 'data.update',
    key: 'update',
    command: 'update',
    description: 'Update rows or documents through the write gate.',
    minimumPermission: 'read-write',
    requiresConnection: true,
  },
  {
    id: 'data.delete',
    key: 'delete',
    command: 'delete',
    description: 'Delete rows or documents through the write gate.',
    minimumPermission: 'data-admin',
    requiresConnection: true,
  },
  {
    id: 'data.export',
    key: 'export',
    command: 'export',
    description: 'Export query or object contents to a file, subject to the blacklist.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'data.health-check',
    key: 'check',
    command: 'check',
    description: 'Check data health: nulls, orphans, duplicates and empty strings.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'blacklist.manage',
    key: 'blacklist',
    command: 'blacklist',
    description: 'Inspect and edit the table, column and key rules that hide sensitive data.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'context.inspect',
    key: 'inspect',
    command: 'inspect',
    description: 'Produce a bounded agent context snapshot of the configured database.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'diagnostic.report',
    key: 'report',
    command: 'report',
    description: 'Produce a diagnostic report about the configured database.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'guide.plan',
    key: 'guide',
    command: 'guide',
    description: 'Suggest the next deterministic command for a stated goal.',
    minimumPermission: 'query-only',
    requiresConnection: true,
  },
  {
    id: 'recovery.plan',
    key: 'recover',
    command: 'recover',
    description: 'Read the saved recovery envelope and plan or apply safe remediation steps.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.tail',
    key: 'auditTail',
    command: 'audit tail',
    description: 'Read recent audit entries from the local log.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.show',
    key: 'auditShow',
    command: 'audit show',
    description: 'Look up one audit entry by id prefix or recovery reference.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.health',
    key: 'auditHealth',
    command: 'audit health',
    description: 'Report audit log health and rotation state.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'audit.clear',
    key: 'auditClear',
    command: 'audit clear',
    description: 'Remove the local audit log files for a connection.',
    minimumPermission: 'admin',
    requiresConnection: false,
  },
  {
    id: 'skill.install',
    key: 'skill',
    command: 'skill',
    description: 'Write the dbcli skill and task-pack assets into a platform directory.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'shell-completion.generate',
    key: 'completion',
    command: 'completion',
    description: 'Emit a shell completion script for the current command tree.',
    minimumPermission: 'query-only',
    requiresConnection: false,
  },
  {
    id: 'package.upgrade-check',
    key: 'upgrade',
    command: 'upgrade',
    description: 'Check whether a newer dbcli release is available.',
    minimumPermission: 'query-only',
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
    return { engines: [...DATABASE_SYSTEMS], engineIndependent: true }
  }

  return {
    engines: statuses
      .filter((entry) => entry.status === 'supported' || entry.status === 'limited')
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
 * import graph by `tests/contract/capability-command-parity.test.ts`.
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
    ])
  ) as ReadonlySet<string>,
  evidenceCommands: Object.freeze(new Set<string>()) as ReadonlySet<string>,
})

function build(declaration: CapabilityDeclaration, surface: CommandSurfaceFacts): Capability {
  const { engines, engineIndependent } = enginesFor(declaration.key)
  const sideEffect = sideEffectFor(declaration.key, engines)

  return Object.freeze({
    id: declaration.id,
    description: declaration.description,
    command: declaration.command,
    risk: riskForSideEffect(sideEffect),
    sideEffect,
    engines: Object.freeze([...engines]),
    engineIndependent,
    minimumPermission: declaration.minimumPermission,
    requiresConnection: declaration.requiresConnection,
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
