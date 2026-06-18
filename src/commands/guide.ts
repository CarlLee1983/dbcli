import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { configModule } from '@/core/config'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import {
  ALLOWED_GOALS,
  collectGuide,
  describeGoal,
  listGoals,
  renderGoalList,
  renderJson,
  renderMarkdown,
  type GuideGoalId,
} from '@/core/guide'

const ALLOWED_FORMATS = ['json', 'markdown'] as const

function parseGoal(value: string): GuideGoalId {
  const normalized = value.trim() as GuideGoalId
  if (!ALLOWED_GOALS.includes(normalized)) {
    throw new Error(`Unknown guide goal '${value}'. Allowed: ${ALLOWED_GOALS.join(', ')}`)
  }
  return normalized
}

export const guideCommand = new Command()
  .name('guide')
  // Required so `--format` after the `missing-index-for` subcommand binds to that
  // leaf command instead of being absorbed by this parent's same-named `--format`.
  // Commander requires every ancestor in the chain to opt in (program already does).
  .enablePositionalOptions()
  .description(t('guide.description'))
  .argument('[goal]', `Guide goal ID; one of [${ALLOWED_GOALS.join(', ')}]`)
  .option('--format <format>', 'Output format: json (default) or markdown', 'json')
  .option('--brief', 'Trim rationale/expects for compact output', false)
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .option('--list', 'List available guide goals and exit', false)
  .option('--probe', 'Refresh inspect context via live probe (default: cache-first)', false)
  .option(
    '--probe-timeout <ms>',
    'Inspect probe timeout for cheap version/object check (default 1500)',
    (v) => parseInt(v, 10),
    1500
  )
  .action(async (goal: string | undefined, options: Record<string, unknown>, command: Command) => {
    let config: any
    try {
      const forAgent = options.forAgent === true
      const format = forAgent ? 'json' : (options.format as string)
      const brief = forAgent || options.brief === true
      validateFormat(format, ALLOWED_FORMATS, 'guide')

      if (options.list === true) {
        if (format === 'markdown') {
          console.log(renderGoalList())
        } else {
          const payload = {
            schemaVersion: 1,
            goals: listGoals().map((id) => ({ id, description: describeGoal(id) })),
          }
          console.log(JSON.stringify(payload, null, 2))
        }
        return
      }

      if (!goal) {
        console.error('Missing goal. Try `dbcli guide --list` to see available goals.')
        process.exit(1)
      }
      const validated = parseGoal(goal as string)

      const configPath = resolveConfigPath(command, options as { config?: string })
      config = await configModule.read(configPath)

      const snap = await collectGuide({
        workspace: process.cwd(),
        configPath,
        goal: validated,
        probe: options.probe === true,
        brief,
        probeTimeoutMs: options.probeTimeout as number,
      })

      // Phase 25 DOCS-02: embed last N audit entries on agent JSON paths.
      // Top-level placement (NOT inside snap.context) so agents read top_level.audit_recent.
      if (config) {
        const { shouldEmbedRecent, loadRecentAudit } = await import('@/core/audit/recent')
        if (shouldEmbedRecent({ forAgent, format })) {
          snap.audit_recent = await loadRecentAudit(config, configPath)
        }
      }

      const out =
        format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
      console.log(out)

      if (config) {
        await writeAuditEntry(config, 'guide', options, {
          success: true,
          target: goal as string,
        })
      }
    } catch (err) {
      if (config) {
        await writeAuditEntry(config, 'guide', options, {
          success: false,
          target: (goal as string) || '*',
          error: err,
        })
      }
      console.error((err as Error).message)
      process.exit(1)
    }
  })
