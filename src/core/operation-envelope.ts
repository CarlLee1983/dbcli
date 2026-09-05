import { z } from 'zod'
import { DATABASE_SYSTEMS, type DatabaseSystem } from '@/adapters/types'
import { CAPABILITY_ID_PATTERN, CapabilityCatalogSchema } from '@/core/capabilities/schema'
import type { CapabilityCatalog } from '@/core/capabilities/types'
import { recoveryEnvelopeSchema } from '@/core/recovery/envelope-schema'
import { CORRELATION_ID_PATTERN } from '@/core/correlation-id'
import type { RecoveryEnvelope } from '@/core/recovery/types'
import type { Permission } from '@/types'

export const OPERATION_ENVELOPE_SCHEMA_VERSION = 1 as const
export const MAX_OPERATION_ENVELOPE_BYTES = 65_536
export const MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH = 160
export const MAX_OPERATION_ENVELOPE_ITEMS = 128

const MAX_MESSAGE_LENGTH = 2_000
const MAX_EVIDENCE_ITEMS = 16

const OPERATION_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/
const CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/

export type OperationEnvelopeOperation = 'capabilities.check' | 'capabilities.list'
export type OperationEnvelopeStatus = 'succeeded' | 'failed'
export type OperationEnvelopeEvidenceKind = 'receipt' | 'audit' | 'verification-artifact'

export interface OperationEnvelopeContext {
  readonly engine: DatabaseSystem
  readonly permission: Permission
  readonly connectionName: string | null
  readonly agentMode: boolean
  readonly correlationId?: string
}

export interface OperationEnvelopeCapabilityResult {
  readonly id: string
  readonly status: 'available' | 'unavailable' | 'unknown'
  readonly reason:
    | 'unknown-capability'
    | 'context-unavailable'
    | 'context-unresolvable'
    | 'engine'
    | 'agent-mode'
    | 'permission'
    | null
}

export interface OperationEnvelopeCapabilitiesCheckData {
  readonly required: readonly string[]
  readonly results: readonly OperationEnvelopeCapabilityResult[]
}

export interface OperationEnvelopeWarning {
  readonly code: string
  readonly message: string
}

export interface OperationEnvelopeEvidenceReference {
  readonly kind: OperationEnvelopeEvidenceKind
  readonly id: string
  readonly digest?: string
}

export interface OperationEnvelopeError {
  readonly code: string
  readonly message: string
}

export interface OperationEnvelope {
  readonly schemaVersion: typeof OPERATION_ENVELOPE_SCHEMA_VERSION
  readonly ok: boolean
  readonly operation: OperationEnvelopeOperation
  readonly status: OperationEnvelopeStatus
  readonly context: OperationEnvelopeContext | null
  readonly data: OperationEnvelopeCapabilitiesCheckData | CapabilityCatalog | null
  readonly warnings: readonly OperationEnvelopeWarning[]
  readonly evidence: readonly OperationEnvelopeEvidenceReference[]
  readonly recovery: RecoveryEnvelope | null
  readonly error: OperationEnvelopeError | null
}

export type OperationEnvelopeParseResult =
  | { readonly ok: true; readonly value: OperationEnvelope }
  | { readonly ok: false; readonly reason: string }

export interface SerializedOperationEnvelope {
  readonly envelope: OperationEnvelope
  readonly output: string
  readonly exceededLimit: boolean
}

export class OperationEnvelopeContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationEnvelopeContractError'
    Object.setPrototypeOf(this, OperationEnvelopeContractError.prototype)
  }
}

const identifierSchema = z.string().min(1).max(MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH)
const capabilityIdSchema = identifierSchema.regex(
  CAPABILITY_ID_PATTERN,
  'capability id must be dotted lower-case segments'
)
const codeSchema = identifierSchema.regex(CODE, 'code must be an uppercase snake-case identifier')
const messageSchema = z.string().min(1).max(MAX_MESSAGE_LENGTH)

const contextSchema = z
  .object({
    engine: z.enum(DATABASE_SYSTEMS),
    permission: z.enum(['query-only', 'read-write', 'data-admin', 'admin']),
    connectionName: identifierSchema.nullable(),
    agentMode: z.boolean(),
    correlationId: z.string().regex(CORRELATION_ID_PATTERN, 'invalid correlation id').optional(),
  })
  .strict()

const resultSchema = z
  .object({
    id: capabilityIdSchema,
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
  .superRefine((result, ctx) => {
    if (result.status === 'available' && result.reason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'available results require reason null',
      })
    }
    if (result.status === 'unknown' && result.reason !== 'unknown-capability') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unknown results require reason unknown-capability',
      })
    }
    if (
      result.status === 'unavailable' &&
      (result.reason === null || result.reason === 'unknown-capability')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unavailable results require an availability reason',
      })
    }
  })

const capabilitiesCheckDataSchema = z
  .object({
    required: z.array(capabilityIdSchema).min(1).max(MAX_OPERATION_ENVELOPE_ITEMS),
    results: z.array(resultSchema).min(1).max(MAX_OPERATION_ENVELOPE_ITEMS),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (new Set(data.required).size !== data.required.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'required capability ids must be unique',
      })
    }
    if (
      data.required.length !== data.results.length ||
      data.required.some((id, index) => data.results[index]?.id !== id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'results must match required capability ids in order',
      })
    }
  })

const warningSchema = z
  .object({
    code: codeSchema,
    message: messageSchema,
  })
  .strict()

const evidenceSchema = z
  .object({
    kind: z.enum(['receipt', 'audit', 'verification-artifact']),
    id: z.string().regex(EVIDENCE_ID, 'invalid evidence id'),
    digest: z.string().regex(SHA256_DIGEST, 'invalid evidence digest').optional(),
  })
  .strict()

const errorSchema = z
  .object({
    code: codeSchema,
    message: messageSchema,
  })
  .strict()

function hasOversizedRecoveryString(value: unknown): boolean {
  if (typeof value === 'string') return value.length > MAX_MESSAGE_LENGTH
  if (Array.isArray(value)) return value.some(hasOversizedRecoveryString)
  if (value === null || typeof value !== 'object') return false
  return Object.values(value).some(hasOversizedRecoveryString)
}

const operationEnvelopeFieldSchema = z
  .object({
    schemaVersion: z.literal(OPERATION_ENVELOPE_SCHEMA_VERSION),
    ok: z.boolean(),
    operation: z
      .enum(['capabilities.check', 'capabilities.list'])
      .refine(
        (value) =>
          value.length <= MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH && OPERATION_ID.test(value)
      ),
    status: z.enum(['succeeded', 'failed']),
    context: contextSchema.nullable(),
    data: z.union([capabilitiesCheckDataSchema, CapabilityCatalogSchema]).nullable(),
    warnings: z.array(warningSchema).max(MAX_OPERATION_ENVELOPE_ITEMS),
    evidence: z.array(evidenceSchema).max(MAX_EVIDENCE_ITEMS),
    recovery: recoveryEnvelopeSchema.nullable(),
    error: errorSchema.nullable(),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (envelope.ok !== (envelope.status === 'succeeded')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ok must equal (status === "succeeded")',
      })
    }

    if (envelope.operation === 'capabilities.check') {
      if (envelope.status === 'succeeded') {
        if (envelope.error !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful envelopes require error null',
          })
        }
        if (envelope.data === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful capabilities.check envelopes require data',
          })
        } else if ('results' in envelope.data) {
          if (envelope.data.results.some((result) => result.status !== 'available')) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'successful capabilities.check results must all be available',
            })
          }
        } else {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'capabilities.check requires capabilitiesCheckDataSchema shape',
          })
        }
      } else if (envelope.error === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'failed envelopes require an error' })
      }

      const completedNegative = envelope.error?.code === 'CAPABILITY_REQUIREMENTS_UNMET'
      if (envelope.status === 'failed' && completedNegative !== (envelope.data !== null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'only completed negative capability results retain data',
        })
      }
      if (
        completedNegative &&
        envelope.data !== null &&
        'results' in envelope.data &&
        envelope.data.results.every((result) => result.status === 'available')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'completed negative capability results require an unmet result',
        })
      }
    } else if (envelope.operation === 'capabilities.list') {
      if (envelope.status === 'succeeded') {
        if (envelope.context !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful capabilities.list envelopes require context null',
          })
        }
        if (envelope.warnings.length !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful capabilities.list envelopes require warnings empty',
          })
        }
        if (envelope.evidence.length !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful capabilities.list envelopes require evidence empty',
          })
        }
        if (envelope.recovery !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful capabilities.list envelopes require recovery null',
          })
        }
        if (envelope.error !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful envelopes require error null',
          })
        }
        if (envelope.data === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'successful capabilities.list envelopes require data',
          })
        } else if (!('capabilities' in envelope.data)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'capabilities.list requires CapabilityCatalogSchema shape',
          })
        }
      } else {
        if (envelope.error === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'failed envelopes require an error',
          })
        }
        if (envelope.data !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'failed capabilities.list envelopes require data null',
          })
        }
      }
    }

    if (envelope.recovery !== null) {
      if (
        envelope.error === null ||
        envelope.recovery.error.code !== envelope.error.code ||
        envelope.recovery.error.message !== envelope.error.message
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'recovery error code and message must match the envelope error',
        })
      }
      if (hasOversizedRecoveryString(envelope.recovery)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `recovery strings must be at most ${MAX_MESSAGE_LENGTH} characters`,
        })
      }
    }
  })

function summarize(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

function encode(envelope: OperationEnvelope): string {
  return `${JSON.stringify(envelope)}\n`
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function parseOperationEnvelope(input: unknown): OperationEnvelopeParseResult {
  const parsed = operationEnvelopeFieldSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: summarize(parsed.error) }

  const value = parsed.data as OperationEnvelope
  const size = byteLength(encode(value))
  if (size > MAX_OPERATION_ENVELOPE_BYTES) {
    return {
      ok: false,
      reason: `<root>: serialized envelope is ${size} bytes; cap is ${MAX_OPERATION_ENVELOPE_BYTES}`,
    }
  }
  return { ok: true, value }
}

export function serializeOperationEnvelope(input: unknown): SerializedOperationEnvelope {
  const parsed = operationEnvelopeFieldSchema.safeParse(input)
  if (!parsed.success) {
    throw new OperationEnvelopeContractError(
      `Invalid Operation Envelope: ${summarize(parsed.error)}`
    )
  }

  const envelope = parsed.data as OperationEnvelope
  const output = encode(envelope)
  if (byteLength(output) <= MAX_OPERATION_ENVELOPE_BYTES) {
    return { envelope, output, exceededLimit: false }
  }

  const fallback: OperationEnvelope = {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: false,
    operation: envelope.operation,
    status: 'failed',
    context: null,
    data: null,
    warnings: [],
    evidence: [],
    recovery: null,
    error: {
      code: 'AGENT_OUTPUT_LIMIT_EXCEEDED',
      message: 'Agent output exceeded the 65,536-byte limit.',
    },
  }
  return { envelope: fallback, output: encode(fallback), exceededLimit: true }
}
