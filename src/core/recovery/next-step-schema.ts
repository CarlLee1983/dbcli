import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
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

const FILE_BYTE_CAP = 64 * 1024

export async function loadStepResultSummary(
  arg: string,
  cwd: string
): Promise<ParseResult<StepResultSummary>> {
  if (arg.length === 0) {
    return { ok: false, reason: 'empty --result value' }
  }

  let raw: string
  if (arg.startsWith('@')) {
    const path = resolve(cwd, arg.slice(1))
    try {
      await stat(path)
    } catch {
      return { ok: false, reason: `--result @<file>: ${path} not readable.` }
    }

    let buf: Uint8Array
    try {
      buf = new Uint8Array(await Bun.file(path).arrayBuffer())
    } catch {
      return { ok: false, reason: `--result @<file>: ${path} not readable.` }
    }
    if (buf.byteLength > FILE_BYTE_CAP) {
      return {
        ok: false,
        reason: `--result @<file>: file exceeds 64 KB cap (${buf.byteLength} bytes).`,
      }
    }
    raw = new TextDecoder().decode(buf)
  } else {
    raw = arg
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '--result: not valid JSON.' }
  }
  return parseStepResultSummary(parsed)
}
