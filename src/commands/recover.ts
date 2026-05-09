import { Command } from 'commander'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  EXIT_CODE,
  readLastEnvelope,
  renderJson,
  renderMarkdown,
  runApply,
  type AllowWrite,
  type RecoveryEnvelope,
  type SavedRecoveryEnvelope,
} from '@/core/recovery'
import { renderApplyJson } from '@/core/recovery/apply-render-json'
import { renderApplyMarkdown } from '@/core/recovery/apply-render-markdown'
import { LAST_ENVELOPE_PATH } from '@/core/recovery/last-envelope'
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
      throw new RecoverCliError(
        `--from ${opts.from}: file not readable.`,
        EXIT_CODE.malformed
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new RecoverCliError(
        `--from ${opts.from}: not valid JSON.`,
        EXIT_CODE.malformed
      )
    }
    if (looksSaved(parsed)) {
      const saved = parsed as SavedRecoveryEnvelope
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
    if (looksEnvelope(parsed)) {
      return {
        kind: 'from',
        path,
        cwd: process.cwd(),
        envelope: parsed as RecoveryEnvelope,
        command: `external --from ${opts.from}`,
      }
    }
    throw new RecoverCliError(
      `--from ${opts.from}: not a RecoveryEnvelope or SavedRecoveryEnvelope.`,
      EXIT_CODE.malformed
    )
  }

  const saved = await readLastEnvelope(opts.cwd)
  if (!saved) {
    throw new RecoverCliError(
      `No recovery plan available. Run a command with --recovery to generate one, or pass --from <file>.`,
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

function looksSaved(x: unknown): boolean {
  return (
    typeof x === 'object' &&
    x !== null &&
    'envelope' in (x as Record<string, unknown>) &&
    'cwd' in (x as Record<string, unknown>)
  )
}

function looksEnvelope(x: unknown): boolean {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as Record<string, unknown>).ok === false &&
    typeof (x as Record<string, unknown>).schemaVersion === 'number' &&
    'error' in (x as Record<string, unknown>)
  )
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

export const recoverCommand = new Command()
  .name('recover')
  .description('Inspect or apply the last recovery plan')
  .option('--apply', 'Execute the recovery plan under risk gating', false)
  .option('--from <path>', 'Read the envelope from a file instead of .dbcli/last-recovery.json')
  .option(
    '--allow-write <tier>',
    `Open the risk gate one tier; values: ${ALLOWED_TIERS.join(' | ')}`
  )
  .option('--format <format>', 'Output format: markdown (default) or json', 'markdown')
  .action(async (options: Record<string, unknown>) => {
    try {
      const format = String(options.format ?? 'markdown')
      validateFormat(format, ALLOWED_FORMATS, 'recover')

      const allowWriteRaw = options.allowWrite as string | undefined
      let allowWrite: AllowWrite = 'none'
      if (allowWriteRaw !== undefined) {
        if (!ALLOWED_TIERS.includes(allowWriteRaw as AllowWrite)) {
          throw new RecoverCliError(
            `Invalid --allow-write value '${allowWriteRaw}'. Allowed: ${ALLOWED_TIERS.join(', ')}`,
            EXIT_CODE.malformed
          )
        }
        allowWrite = allowWriteRaw as AllowWrite
      }

      const source = await resolveApplySource({
        from: options.from as string | undefined,
        cwd: process.cwd(),
      })

      if (options.apply !== true) {
        const out =
          format === 'markdown'
            ? renderMarkdown(source.envelope)
            : renderJson(source.envelope)
        console.log(out)
        return
      }

      const result = await runApply(
        {
          envelope: source.envelope,
          cwd: source.cwd,
          source: { kind: source.kind, path: source.path },
        },
        { allowWrite }
      )

      const out =
        format === 'markdown' ? renderApplyMarkdown(result) : renderApplyJson(result)
      console.log(out)
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
