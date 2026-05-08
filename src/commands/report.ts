import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import {
  ALLOWED_SECTIONS,
  collectReport,
  renderJson,
  renderMarkdown,
  type ReportSectionId,
} from '@/core/report'

const ALLOWED_FORMATS = ['json', 'markdown'] as const

function parseSections(value: string): ReportSectionId[] {
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const p of parts) {
    if (!ALLOWED_SECTIONS.includes(p as ReportSectionId)) {
      throw new Error(`Unknown report section '${p}'. Allowed: ${ALLOWED_SECTIONS.join(', ')}`)
    }
  }
  return parts as ReportSectionId[]
}

export const reportCommand = new Command()
  .name('report')
  .description(t('report.description'))
  .option('--format <format>', 'Output format: json (default) or markdown', 'json')
  .option(
    '--section <list>',
    `Comma-separated subset of [${ALLOWED_SECTIONS.join(', ')}] (default: all)`,
    parseSections
  )
  .option('--brief', 'Trim evidence rows for compact output', false)
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .option('--no-connect', 'Emit context-only snapshot (skip diagnostics)')
  .option(
    '--per-snippet-timeout <ms>',
    'Hard timeout per diagnostic snippet (default 3000)',
    (v) => parseInt(v, 10),
    3000
  )
  .option(
    '--max-rows-per-evidence <n>',
    'Cap rows kept per evidence (default 50)',
    (v) => parseInt(v, 10),
    50
  )
  .option(
    '--probe-timeout <ms>',
    'Inspect probe timeout for cheap version/object check (default 1500)',
    (v) => parseInt(v, 10),
    1500
  )
  .action(async (options: Record<string, unknown>, command: Command) => {
    try {
      const forAgent = options.forAgent === true
      const format = forAgent ? 'json' : (options.format as string)
      const brief = forAgent || options.brief === true
      validateFormat(format, ALLOWED_FORMATS, 'report')

      const configPath = resolveConfigPath(command, options as { config?: string })
      const snap = await collectReport({
        workspace: process.cwd(),
        configPath,
        sections: options.section as ReportSectionId[] | undefined,
        noConnect: options.connect === false,
        brief,
        perSnippetTimeoutMs: options.perSnippetTimeout as number,
        maxRowsPerEvidence: options.maxRowsPerEvidence as number,
        probeTimeoutMs: options.probeTimeout as number,
      })

      const out =
        format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
      console.log(out)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
