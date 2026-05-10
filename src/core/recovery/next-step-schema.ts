import { z } from 'zod'
import type { StepResultSummary } from './next-types'
import { STEP_RESULT_SUMMARY_FIELD_CAP } from './next-types'

const stepResultSummarySchema = z
  .object({
    status: z.enum(['ok', 'failed', 'skipped']),
    exitCode: z.number().int().optional(),
    stdoutSummary: z.string().max(STEP_RESULT_SUMMARY_FIELD_CAP).optional(),
    stderrSummary: z.string().max(STEP_RESULT_SUMMARY_FIELD_CAP).optional(),
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

export function parseStepResultSummary(input: unknown): ParseResult<StepResultSummary> {
  const r = stepResultSummarySchema.safeParse(input)
  if (r.success) return { ok: true, value: r.data as StepResultSummary }
  return { ok: false, reason: summarizeZodError(r.error) }
}
