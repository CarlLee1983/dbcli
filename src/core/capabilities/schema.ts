/**
 * Strict runtime schemas for the capability contract.
 *
 * These exist for the *consumer's* benefit: an external Skill that pins
 * `schemaVersion: 1` can validate what it received rather than trusting a shape
 * it was handed. `.strict()` throughout is the point — an unknown field means
 * the producer is speaking a dialect this reader does not know, and accepting
 * it silently is how a contract stops being one.
 */

import { z } from 'zod'
import { DATABASE_SYSTEMS } from '@/adapters/types'
import { CAPABILITY_CONTRACT_SCHEMA_VERSION } from './types'
import type { CapabilityCatalog, CapabilityCheckReport } from './types'

export class CapabilityContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityContractError'
    Object.setPrototypeOf(this, CapabilityContractError.prototype)
  }
}

const PermissionSchema = z.enum(['query-only', 'read-write', 'data-admin', 'admin'])
const EngineSchema = z.enum(DATABASE_SYSTEMS)
const RiskSchema = z.enum(['readonly', 'dry-run', 'write', 'unknown'])
const SideEffectSchema = z.enum([
  'readonly',
  'dry-run',
  'local-write',
  'db-write',
  'interactive',
  'none',
])

/** Dotted lower-case segments, e.g. `schema.read-object`. */
const CapabilityIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, {
  message: 'capability id must be dotted lower-case segments, e.g. schema.read',
})

export const CapabilitySchema = z
  .object({
    id: CapabilityIdSchema,
    description: z.string().min(1),
    command: z.string().min(1),
    risk: RiskSchema,
    sideEffect: SideEffectSchema,
    engines: z.array(EngineSchema),
    limitedEngines: z.array(EngineSchema),
    engineIndependent: z.boolean(),
    minimumPermission: PermissionSchema,
    requiresConnection: z.boolean(),
    mutatesConfiguration: z.boolean(),
    supportsJson: z.boolean(),
    supportsEvidence: z.boolean(),
  })
  .strict()

export const CapabilityCatalogSchema = z
  .object({
    schemaVersion: z.literal(CAPABILITY_CONTRACT_SCHEMA_VERSION),
    capabilities: z.array(CapabilitySchema),
  })
  .strict()

const CheckContextSchema = z
  .object({
    engine: EngineSchema,
    permission: PermissionSchema,
    // Bounded because it is the one field carrying a user-supplied string
    // straight back out. The value is a connection label the user chose, so it
    // is not untrusted in the usual sense, but an unbounded echo is still an
    // echo.
    connectionName: z.string().max(200).nullable(),
    agentMode: z.boolean(),
  })
  .strict()

const CheckResultSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['available', 'unavailable', 'unknown']),
    reason: z
      .enum([
        'unknown-capability',
        'context-unavailable',
        'context-unresolvable',
        'engine',
        'agent-mode',
        'permission',
      ])
      .nullable(),
  })
  .strict()

export const CapabilityCheckReportSchema = z
  .object({
    schemaVersion: z.literal(CAPABILITY_CONTRACT_SCHEMA_VERSION),
    ok: z.boolean(),
    required: z.array(z.string().min(1)),
    context: CheckContextSchema.nullable(),
    results: z.array(CheckResultSchema),
    warnings: z.array(z.string()),
  })
  .strict()

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new CapabilityContractError(
    `${what} does not match capability contract v${CAPABILITY_CONTRACT_SCHEMA_VERSION}: ${result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')}`
  )
}

export function parseCapabilityCatalog(value: unknown): CapabilityCatalog {
  return parse(CapabilityCatalogSchema, value, 'capability catalog') as CapabilityCatalog
}

export function parseCapabilityCheckReport(value: unknown): CapabilityCheckReport {
  return parse(
    CapabilityCheckReportSchema,
    value,
    'capability check report'
  ) as CapabilityCheckReport
}
