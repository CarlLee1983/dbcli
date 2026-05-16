import { Command } from 'commander'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  EXIT_CODE,
  renderMarkdown,
  runApply,
  type AllowWrite,
  type RecoveryEnvelope,
} from '@/core/recovery'
import { renderApplyMarkdown } from '@/core/recovery/apply-render-markdown'
import { LAST_ENVELOPE_PATH, readLastEnvelopeRaw } from '@/core/recovery/last-envelope'
import {
  looksLikeSavedEnvelope,
  parseRecoveryEnvelope,
  parseSavedRecoveryEnvelope,
} from '@/core/recovery/envelope-schema'
import { nextStepFromEnvelope } from '@/core/recovery/next-step'
import { loadStepResultSummary } from '@/core/recovery/next-step-schema'
import { renderNextJson } from '@/core/recovery/next-render-json'
import { renderNextMarkdown } from '@/core/recovery/next-render-markdown'
import { NEXT_SCHEMA_VERSION, type NextResult } from '@/core/recovery/next-types'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['json', 'markdown'] as const
const ALLOWED_TIERS: AllowWrite[] = ['readonly-cmd', 'write-cmd']

export class RecoverCliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number
  ) {
    super(message)
    this.name = 'RecoverCliError'
    Object.setPrototypeOf(this, RecoverCliError.prototype)
  }
}

interface ResolvedSource {
  kind: 'auto' | 'from'
  path: string
  cwd: string
  envelope: RecoveryEnvelope
  command: string
}

export async function resolveApplySource(opts: {
  from?: string
  cwd: string
}): Promise<ResolvedSource> {
  if (opts.from !== undefined) {
    const path = resolve(opts.cwd, opts.from)
    let raw: string
    try {
      raw = await Bun.file(path).text()
    } catch {
      throw new RecoverCliError(`--from ${opts.from}: file not readable.`, EXIT_CODE.malformed)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new RecoverCliError(`--from ${opts.from}: not valid JSON.`, EXIT_CODE.malformed)
    }
    if (looksLikeSavedEnvelope(parsed)) {
      const r = parseSavedRecoveryEnvelope(parsed)
      if (!r.ok) {
        throw new RecoverCliError(
          `--from ${opts.from}: malformed SavedRecoveryEnvelope (${r.reason}).`,
          EXIT_CODE.malformed
        )
      }
      const saved = r.value!
      try {
        await stat(saved.cwd)
      } catch {
        throw new RecoverCliError(
          `--from ${opts.from}: saved cwd '${saved.cwd}' no longer exists.`,
          EXIT_CODE.malformed
        )
      }
      return {
        kind: 'from',
        path,
        cwd: saved.cwd,
        envelope: saved.envelope,
        command: saved.command,
      }
    }
    const r = parseRecoveryEnvelope(parsed)
    if (!r.ok) {
      throw new RecoverCliError(
        `--from ${opts.from}: not a valid RecoveryEnvelope or SavedRecoveryEnvelope (${r.reason}).`,
        EXIT_CODE.malformed
      )
    }
    return {
      kind: 'from',
      path,
      cwd: process.cwd(),
      envelope: r.value!,
      command: `external --from ${opts.from}`,
    }
  }

  const rawSaved = await readLastEnvelopeRaw(opts.cwd)
  if (rawSaved === null) {
    throw new RecoverCliError(
      `No recovery plan available. Run a command with --recovery to generate one, or pass --from <file>.`,
      EXIT_CODE.malformed
    )
  }
  const r = parseSavedRecoveryEnvelope(rawSaved)
  if (!r.ok) {
    throw new RecoverCliError(
      `Auto-saved ${LAST_ENVELOPE_PATH} is malformed (${r.reason}). Delete the file and re-run with --recovery.`,
      EXIT_CODE.malformed
    )
  }
  const saved = r.value!
  try {
    await stat(saved.cwd)
  } catch {
    throw new RecoverCliError(
      `Auto-saved ${LAST_ENVELOPE_PATH} references cwd '${saved.cwd}' that no longer exists.`,
      EXIT_CODE.malformed
    )
  }
  return {
    kind: 'auto',
    path: LAST_ENVELOPE_PATH,
    cwd: saved.cwd,
    envelope: saved.envelope,
    command: saved.command,
  }
}

function exitCodeFor(finalStatus: 'ok' | 'failed' | 'skipped-only'): number {
  switch (finalStatus) {
    case 'ok':
      return EXIT_CODE.ok
    case 'failed':
      return EXIT_CODE.failed
    case 'skipped-only':
      return EXIT_CODE.skippedOnly
  }
}

async function runNext(
  options: Record<string, unknown>,
  source: ResolvedSource
): Promise<NextResult> {
  const afterStepRaw = options.afterStep
  if (afterStepRaw === undefined) {
    throw new RecoverCliError('--next requires --after-step <n>.', EXIT_CODE.malformed)
  }
  const afterStep = Number(afterStepRaw)
  if (!Number.isInteger(afterStep)) {
    throw new RecoverCliError(
      `--after-step must be an integer (got '${afterStepRaw}').`,
      EXIT_CODE.malformed
    )
  }

  const resultArg = options.result as string | undefined
  if (resultArg === undefined) {
    throw new RecoverCliError('--next requires --result <json|@file>.', EXIT_CODE.malformed)
  }
  const parsed = await loadStepResultSummary(resultArg, process.cwd())
  if (!parsed.ok) {
    throw new RecoverCliError(parsed.reason ?? '--result invalid.', EXIT_CODE.malformed)
  }

  const env = source.envelope
  let outcome
  try {
    outcome = nextStepFromEnvelope(env, afterStep, parsed.value!)
  } catch (e) {
    throw new RecoverCliError((e as Error).message, EXIT_CODE.malformed)
  }

  const totalSteps = env.recovery.length
  if (outcome.kind === 'done') {
    return {
      schemaVersion: NEXT_SCHEMA_VERSION,
      kind: 'done',
      source: { kind: source.kind, path: source.path },
      errorCode: env.error.code,
      cursor: totalSteps,
      totalSteps,
    }
  }
  return {
    schemaVersion: NEXT_SCHEMA_VERSION,
    kind: 'step',
    source: { kind: source.kind, path: source.path },
    errorCode: env.error.code,
    cursor: outcome.step.order,
    totalSteps,
    step: outcome.step,
  }
}

export const recoverCommand = new Command()
  .name('recover')
  .description('Inspect or apply the last recovery plan')
  .option('--apply', 'Execute the recovery plan under risk gating', false)
  .option('--from <path>', 'Read the envelope from a file instead of .dbcli/last-recovery.json')
  .option(
    '--allow-write <tier>',
    `Open the risk gate one tier; values: ${ALLOWED_TIERS.join(' | ')}`
  )
  .option('--no-verify', 'Skip the verify step appended after a successful --apply')
  .option('--next', 'Look up the single next step in the multi-turn protocol', false)
  .option('--after-step <n>', 'For --next: 1-based order of the step the agent just executed')
  .option('--result <value>', 'For --next: JSON StepResultSummary (or @<path> to read from a file)')
  .option(
    '--format <format>',
    'Output format: markdown | json (default: markdown for inspect, json for --apply / --next)'
  )
  .action(async (options: Record<string, unknown>) => {
    try {
      // Mutual exclusion check runs before any I/O so the contract holds even
      // when no recovery file exists.
      if (options.next === true && options.apply === true) {
        throw new RecoverCliError('--next and --apply cannot be combined.', EXIT_CODE.malformed)
      }

      const explicitFormat = options.format as string | undefined
      const format =
        explicitFormat ?? (options.apply === true || options.next === true ? 'json' : 'markdown')
      validateFormat(format, ALLOWED_FORMATS, 'recover')

      // --next is a pure lookup: --allow-write / --no-verify are orthogonal and
      // silently ignored, so we only validate --allow-write outside --next mode.
      let allowWrite: AllowWrite = 'none'
      if (options.next !== true) {
        const allowWriteRaw = options.allowWrite as string | undefined
        if (allowWriteRaw !== undefined) {
          if (!ALLOWED_TIERS.includes(allowWriteRaw as AllowWrite)) {
            throw new RecoverCliError(
              `Invalid --allow-write value '${allowWriteRaw}'. Allowed: ${ALLOWED_TIERS.join(', ')}`,
              EXIT_CODE.malformed
            )
          }
          allowWrite = allowWriteRaw as AllowWrite
        }
      }

      const source = await resolveApplySource({
        from: options.from as string | undefined,
        cwd: process.cwd(),
      })

      // Phase 25 DOCS-02: load audit_recent ONCE for both no-apply + --apply branches.
      // Only when output format is json (D-57; recover has no --for-agent flag per L6).
      // --next branch is OUT OF SCOPE (L2) — do not inject there.
      let audit_recent: import('@/core/audit/types').AuditEntryBrief[] = []
      if (format === 'json' && options.next !== true) {
        try {
          const { configModule } = await import('@/core/config')
          const configPath = `${process.cwd()}/.dbcli`
          const config = await configModule.read(configPath)
          if (config) {
            const { loadRecentAudit } = await import('@/core/audit/recent')
            audit_recent = await loadRecentAudit(config, configPath)
          }
        } catch {
          audit_recent = [] // D-60: never block recover on audit lookup failures
        }
      }

      if (options.next === true) {
        const result = await runNext(options, source)
        const out = format === 'markdown' ? renderNextMarkdown(result) : renderNextJson(result)
        console.log(out)
        return
      }

      if (options.apply !== true) {
        if (format === 'markdown') {
          console.log(renderMarkdown(source.envelope))
        } else {
          // Phase 25 DOCS-02: wrap envelope with audit_recent at the PRINT site.
          // D-52 forbids embedding audit_recent in RecoveryEnvelope body, so build
          // the composite object inline rather than passing it through renderJson.
          console.log(JSON.stringify({ ...source.envelope, audit_recent }, null, 2))
        }
        return
      }

      const noVerify = options.verify === false
      const result = await runApply(
        {
          envelope: source.envelope,
          cwd: source.cwd,
          source: { kind: source.kind, path: source.path },
        },
        { allowWrite, noVerify }
      )

      if (format === 'markdown') {
        console.log(renderApplyMarkdown(result))
      } else {
        // Phase 25 DOCS-02: same pattern as no-apply branch — wrap at print site
        // so ApplyResult type stays clean (mirrors D-52 separation for symmetry).
        console.log(JSON.stringify({ ...result, audit_recent }, null, 2))
      }
      process.exit(exitCodeFor(result.finalStatus))
    } catch (err) {
      if (err instanceof RecoverCliError) {
        console.error(err.message)
        process.exit(err.exitCode)
      }
      console.error((err as Error).message)
      process.exit(EXIT_CODE.failed)
    }
  })
