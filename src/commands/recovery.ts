import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { validateFormat } from '@/utils/validation'
import {
  RECOVERY_CODES,
  RECOVERY_CODE_METADATA,
  RECOVERY_SCHEMA_VERSION,
  renderCodeList,
  renderJson,
  renderMarkdown,
  stepsForCode,
  type RecoveryCode,
  type RecoveryContext,
  type RecoveryEnvelope,
} from '@/core/recovery'

const ALLOWED_FORMATS = ['json', 'markdown'] as const

function parseCode(value: string): RecoveryCode {
  const normalized = value.trim() as RecoveryCode
  if (!RECOVERY_CODES.includes(normalized)) {
    throw new Error(`Unknown recovery code '${value}'. Allowed: ${RECOVERY_CODES.join(', ')}`)
  }
  return normalized
}

function buildSyntheticEnvelope(code: RecoveryCode, ctx: RecoveryContext): RecoveryEnvelope {
  const details = ctxToDetails(ctx)
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ok: false,
    error: {
      code,
      category: RECOVERY_CODE_METADATA[code].category,
      message: RECOVERY_CODE_METADATA[code].description,
      ...(details ? { details } : {}),
    },
    recovery: stepsForCode(code, ctx),
  }
}

function ctxToDetails(ctx: RecoveryContext): RecoveryEnvelope['error']['details'] | undefined {
  const out: NonNullable<RecoveryEnvelope['error']['details']> = {}
  if (ctx.table) out.table = ctx.table
  if (ctx.snippet) out.snippet = ctx.snippet
  return Object.keys(out).length > 0 ? out : undefined
}

export const recoveryCommand = new Command()
  .name('recovery')
  .description(t('recovery.description'))
  .option('--code <code>', `Recovery code; one of [${RECOVERY_CODES.join(', ')}]`)
  .option('--format <format>', 'Output format: json (default) or markdown', 'json')
  .option('--brief', 'Drop rationale/expects from steps', false)
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .option('--list', 'List available recovery codes and exit', false)
  .option('--hint <text>', 'Hint substituted into placeholder steps (e.g. queries search <hint>)')
  .option('--snippet <name>', 'Snippet name substituted into snippet-flavored steps')
  .option('--table <name>', 'Table name substituted into table-flavored steps')
  .action(async (options: Record<string, unknown>) => {
    try {
      const forAgent = options.forAgent === true
      const format = forAgent ? 'json' : (options.format as string)
      const brief = forAgent || options.brief === true
      validateFormat(format, ALLOWED_FORMATS, 'recovery')

      if (options.list === true) {
        if (format === 'markdown') {
          console.log(renderCodeList())
        } else {
          const payload = {
            schemaVersion: RECOVERY_SCHEMA_VERSION,
            codes: RECOVERY_CODES.map((c) => ({
              code: c,
              category: RECOVERY_CODE_METADATA[c].category,
              description: RECOVERY_CODE_METADATA[c].description,
            })),
          }
          console.log(JSON.stringify(payload, null, 2))
        }
        return
      }

      const codeArg = options.code as string | undefined
      if (!codeArg) {
        console.error(t('recovery.missing_code'))
        process.exit(1)
      }
      const code = parseCode(codeArg)

      const ctx: RecoveryContext = {
        operation: 'recovery',
        ...(options.hint ? { hint: String(options.hint) } : {}),
        ...(options.snippet ? { snippet: String(options.snippet) } : {}),
        ...(options.table ? { table: String(options.table) } : {}),
      }

      const envelope = buildSyntheticEnvelope(code, ctx)
      const out =
        format === 'markdown'
          ? renderMarkdown(envelope, { brief })
          : renderJson(envelope, { brief })
      console.log(out)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
