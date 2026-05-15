/**
 * `dbcli audit` commander subtree (Phase 24).
 *
 * Wave 2 (this plan, 24-03): tail full implementation + show/clear/health placeholder.
 * Wave 3 (24-04, 24-05): replace placeholders with real implementations.
 *
 * Constraints (F decision; T-24-07 mitigation):
 * - Zero `writeAuditEntry` import — `audit` subcommands MUST NOT write audit entries
 *   (audit-on-audit loop + clear self-contradiction).
 * - `getAuditLogger` is NOT imported here either; Wave 3 plan 24-04 introduces it
 *   inside the health subcommand only.
 */
import { join } from 'node:path'
import { Command } from 'commander'

import { t, t_vars } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { configModule, getGlobalConnectionName } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import {
  discoverConnections,
  mergeByTimestamp,
  readEntries,
  tailEntries,
} from '@/core/audit/reader'
import type { AuditEntry } from '@/core/audit/types'

const ALLOWED_FORMATS = ['table', 'json'] as const
const DEFAULT_TAIL_N = 10
const MAX_TAIL_N = 10000
const SHORT_ID_LEN = 8
const MISSING_PLACEHOLDER = '—'

type AuditConfigShape = {
  audit?: { enabled?: boolean }
  effectiveConnectionName?: string
}

interface ResolvedAuditPaths {
  auditDir: string
  connectionName: string
  auditFile: string
}

async function resolveAuditPaths(
  configPath: string,
  config: AuditConfigShape,
): Promise<ResolvedAuditPaths> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const connName =
    config.effectiveConnectionName || getGlobalConnectionName() || 'default'
  const auditDir = join(storagePath, '.dbcli', 'audit')
  const auditFile = join(auditDir, `${connName}.jsonl`)
  return { auditDir, connectionName: connName, auditFile }
}

function isAuditDisabled(config: AuditConfigShape): boolean {
  return config?.audit?.enabled === false
}

function emitDisabledAndExit0(): never {
  console.error(t('audit.disabled_hint'))
  process.exit(0)
}

function parseTailN(raw: unknown): number {
  const requested =
    typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (
    !Number.isFinite(requested) ||
    !Number.isInteger(requested) ||
    requested <= 0
  ) {
    console.error(t('audit.n_must_be_positive'))
    process.exit(1)
  }
  if (requested > MAX_TAIL_N) {
    console.error(
      t_vars('audit.n_capped_warning', {
        requested: String(requested),
        max: String(MAX_TAIL_N),
      }),
    )
    return MAX_TAIL_N
  }
  return requested
}

type BriefEntry = Pick<AuditEntry, 'ts' | 'command' | 'target' | 'success'>

function briefify(entry: AuditEntry): BriefEntry {
  return {
    ts: entry.ts,
    command: entry.command,
    target: entry.target,
    success: entry.success,
  }
}

function shortId(id: string | undefined): string {
  if (!id) return MISSING_PLACEHOLDER
  return id.length <= SHORT_ID_LEN ? id : id.slice(0, SHORT_ID_LEN)
}

function renderTable(rows: string[][], headers: string[]): string {
  const allRows = [headers, ...rows]
  const widths = headers.map((_, col) =>
    Math.max(...allRows.map((r) => (r[col] ?? '').length)),
  )
  const fmt = (r: string[]): string =>
    r.map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0)).join('  ').trimEnd()
  const sep = widths.map((w) => '-'.repeat(w)).join('  ').trimEnd()
  return [fmt(headers), sep, ...rows.map(fmt)].join('\n')
}

function renderTailTable(entries: AuditEntry[]): string {
  const headers = ['ts', 'command', 'target', 'tier', 'success', 'id', 'recovery_ref']
  const rows = entries.map((e) => [
    e.ts,
    e.command,
    e.target,
    e.side_effect_tier,
    String(e.success),
    shortId(e.id),
    shortId(e.recovery_ref),
  ])
  return renderTable(rows, headers)
}

function renderTailAllTable(
  envelopes: Array<{ connection: string; entry: AuditEntry }>,
): string {
  const headers = [
    'connection',
    'ts',
    'command',
    'target',
    'tier',
    'success',
    'id',
    'recovery_ref',
  ]
  const rows = envelopes.map(({ connection, entry: e }) => [
    connection,
    e.ts,
    e.command,
    e.target,
    e.side_effect_tier,
    String(e.success),
    shortId(e.id),
    shortId(e.recovery_ref),
  ])
  return renderTable(rows, headers)
}

export const auditCommand = new Command('audit').description(t('audit.description'))

auditCommand
  .command('tail')
  .description(t('audit.tail.description'))
  .option(
    '--n <number>',
    `Number of recent entries to show (1..${MAX_TAIL_N})`,
    String(DEFAULT_TAIL_N),
  )
  .option('--all', 'Merge entries across all connections', false)
  .option(
    '--format <format>',
    `Output format: ${ALLOWED_FORMATS.join(' | ')} (default: table)`,
    'table',
  )
  .option('--brief', 'Trim each entry to ts/command/target/success', false)
  .option('--no-brief', 'Disable brief mode (override --for-agent default)')
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .action(async (options: Record<string, unknown>, command: Command) => {
    const forAgent = options.forAgent === true
    const format = forAgent ? 'json' : (options.format as string)
    // Distinguish explicit --brief / --no-brief from default false so --for-agent
    // can supply true unless explicitly overridden by --no-brief.
    const briefSource = command.getOptionValueSource('brief')
    const briefExplicit = briefSource !== undefined && briefSource !== 'default'
    const brief = briefExplicit ? options.brief === true : forAgent
    validateFormat(format, ALLOWED_FORMATS, 'audit tail')

    const n = parseTailN(options.n)
    const configPath = resolveConfigPath(command, options as { config?: string })
    const config = (await configModule.read(configPath)) as AuditConfigShape
    if (isAuditDisabled(config)) emitDisabledAndExit0()

    const { auditDir, auditFile } = await resolveAuditPaths(configPath, config)

    if (options.all === true) {
      const conns = await discoverConnections(auditDir)
      const byConn = new Map<string, AuditEntry[]>()
      for (const c of conns) {
        const merged: AuditEntry[] = []
        for (const f of c.files) {
          const part = await readEntries(f)
          merged.push(...part)
        }
        byConn.set(c.connection, merged)
      }
      const envelopes = mergeByTimestamp(byConn).slice(-n)
      if (format === 'json') {
        const payload = envelopes.map((e) => ({
          connection: e.connection,
          entry: brief ? briefify(e.entry) : e.entry,
        }))
        console.log(JSON.stringify(payload, null, 2))
      } else if (envelopes.length === 0) {
        console.error(t('audit.no_entries'))
      } else {
        console.log(renderTailAllTable(envelopes))
      }
      return
    }

    const entries = await readEntries(auditFile, { include_rotated: true })
    const tail = tailEntries(entries, n)
    if (format === 'json') {
      const payload: BriefEntry[] | AuditEntry[] = brief ? tail.map(briefify) : tail
      console.log(JSON.stringify(payload, null, 2))
    } else if (tail.length === 0) {
      console.error(t('audit.no_entries'))
    } else {
      console.log(renderTailTable(tail))
    }
  })

// PLACEHOLDER: implementation lands in Wave 3 plan 24-04
auditCommand
  .command('show [id]')
  .description(t('audit.show.description'))
  .action(async () => {
    console.error('audit show: not yet implemented (Wave 3)')
    process.exit(1)
  })

// PLACEHOLDER: implementation lands in Wave 3 plan 24-05
auditCommand
  .command('clear')
  .description(t('audit.clear.description'))
  .action(async () => {
    console.error('audit clear: not yet implemented (Wave 3)')
    process.exit(1)
  })

// PLACEHOLDER: implementation lands in Wave 3 plan 24-04
auditCommand
  .command('health')
  .description(t('audit.health.description'))
  .action(async () => {
    console.error('audit health: not yet implemented (Wave 3)')
    process.exit(1)
  })
