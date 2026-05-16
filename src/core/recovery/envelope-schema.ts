import { z } from 'zod'
import { RECOVERY_CODES } from './types'
import type { RecoveryEnvelope } from './types'
import type { SavedRecoveryEnvelope } from './apply-types'

const recoveryCodeSchema = z.enum(RECOVERY_CODES)

const recoveryCategorySchema = z.enum([
  'config',
  'connection',
  'permission',
  'blacklist',
  'snippet',
  'schema-cache',
  'unknown',
])

const guideRiskSchema = z.enum(['readonly', 'dry-run', 'write', 'unknown'])

const guideStepSchema = z
  .object({
    order: z.number().int(),
    command: z.string().min(1),
    rationale: z.string(),
    risk: guideRiskSchema,
    expects: z.string(),
    snippet: z.string().optional(),
    intent: z.string().optional(),
    interactive: z.boolean().optional(),
    dbWrite: z.boolean().optional(),
    placeholders: z.array(z.string()).optional(),
  })
  .strict()

export const recoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    ok: z.literal(false),
    error: z
      .object({
        code: recoveryCodeSchema,
        category: recoveryCategorySchema,
        message: z.string(),
        details: z
          .object({
            table: z.string().optional(),
            columns: z.string().optional(),
            requiredPermission: z.string().optional(),
            connectionCode: z.string().optional(),
            snippet: z.string().optional(),
            intent: z.string().optional(),
            paramName: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    recovery: z.array(guideStepSchema),
    verify: guideStepSchema.optional(),
  })
  .strict()

export const savedRecoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().optional(), // Phase 25 D-50
    audit_ref: z.string().optional(), // Phase 25 D-53
    savedAt: z.string().min(1),
    command: z.string(),
    cwd: z.string().min(1),
    envelope: recoveryEnvelopeSchema,
  })
  .strict()

export interface ParseResult<T> {
  ok: boolean
  value?: T
  reason?: string
}

function summarizeZodError(err: z.ZodError): string {
  return err.issues
    .map((iss) => {
      const path = iss.path.join('.') || '<root>'
      return `${path}: ${iss.message}`
    })
    .join('; ')
}

export function parseRecoveryEnvelope(input: unknown): ParseResult<RecoveryEnvelope> {
  const r = recoveryEnvelopeSchema.safeParse(input)
  if (r.success) return { ok: true, value: r.data as RecoveryEnvelope }
  return { ok: false, reason: summarizeZodError(r.error) }
}

export function parseSavedRecoveryEnvelope(input: unknown): ParseResult<SavedRecoveryEnvelope> {
  const r = savedRecoveryEnvelopeSchema.safeParse(input)
  if (r.success) return { ok: true, value: r.data as SavedRecoveryEnvelope }
  return { ok: false, reason: summarizeZodError(r.error) }
}

/** Quick discriminator: looks like a SavedRecoveryEnvelope wrapper. */
export function looksLikeSavedEnvelope(x: unknown): boolean {
  return (
    typeof x === 'object' &&
    x !== null &&
    'envelope' in (x as Record<string, unknown>) &&
    'cwd' in (x as Record<string, unknown>)
  )
}
