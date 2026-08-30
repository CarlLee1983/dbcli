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
import { rm, stat } from 'node:fs/promises'
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
import { getAuditLogger } from '@/core/audit/integration-helper'
import type { AuditHealthReport } from '@/core/audit/logger'
import type { AuditEntry } from '@/core/audit/types'
import {
  GATE_OUTCOMES,
  GATE_REASONS,
  summarizeWriteGate,
  type WriteGateSummary,
} from '@/core/audit/write-gate-summary'
import type { WriteGateReason } from '@/commands/write-gate'
import type { GateOutcome } from '@/commands/write-gate-guard'

/**
 * The summary seeds its tables from hand-copied lists, because `src/core/`
 * cannot import from `src/commands/` where the two unions are defined. Nothing
 * at the definition site fails when a sixth reason is added — and that silence
 * would undo the summary's own argument: a reason absent from the seed list
 * stops being reportable-at-zero and only appears once it has already fired,
 * which is the "answers how often while refusing to answer at all" failure the
 * summary exists to prevent.
 *
 * This layer may import both, so the tie is made here, in the direction the
 * layering allows. Each pair fails to compile on a member missing from the seed
 * list and on one invented there. (It sits here rather than in the summary's own
 * test file for a reason that has since expired: the main `include` used a brace
 * pattern TypeScript does not expand, so no test file was typechecked and a
 * guard put there would have guarded nothing. `tsconfig.tests.json` now covers
 * every test file and CI runs it, so either location would work — this one is
 * kept because the guard belongs with the two unions it ties together (#97).)
 */
type Covers<A, B> = [A] extends [B] ? true : false
const _noInventedReason: Covers<(typeof GATE_REASONS)[number], WriteGateReason> = true
const _noMissingReason: Covers<WriteGateReason, (typeof GATE_REASONS)[number]> = true
const _noInventedOutcome: Covers<(typeof GATE_OUTCOMES)[number], GateOutcome> = true
const _noMissingOutcome: Covers<GateOutcome, (typeof GATE_OUTCOMES)[number]> = true
void [_noInventedReason, _noMissingReason, _noInventedOutcome, _noMissingOutcome]

const ALLOWED_FORMATS = ['table', 'json'] as const
const DEFAULT_TAIL_N = 10
const MAX_TAIL_N = 10000
const SHORT_ID_LEN = 8
const MISSING_PLACEHOLDER = '—'
const PREFIX_MIN = 4

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
  config: AuditConfigShape
): Promise<ResolvedAuditPaths> {
  const storagePath = await resolveConfigStoragePath(configPath)
  const connName = config.effectiveConnectionName || getGlobalConnectionName() || 'default'
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
  const requested = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(requested) || !Number.isInteger(requested) || requested <= 0) {
    console.error(t('audit.n_must_be_positive'))
    process.exit(1)
  }
  if (requested > MAX_TAIL_N) {
    console.error(
      t_vars('audit.n_capped_warning', {
        requested: String(requested),
        max: String(MAX_TAIL_N),
      })
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

/**
 * 控制字元換成可見的跳脫寫法。
 *
 * cell 的內容有使用者可控的部分——ES shell 的 target 來自路徑，`%0A` 解碼後
 * 就是真正的換行。JSONL 檔本身安全（`JSON.stringify` 會逃脫），但這裡的表格
 * 不逃脫的話，一列紀錄就能在畫面上長成兩列，其中一列是偽造的。能被偽造的
 * 呈現層跟能被偽造的儲存層一樣糟。
 */
function sanitizeCell(cell: string): string {
  return cell.replace(/[\u0000-\u001f\u007f]/g, (char) => {
    const escapes: Record<string, string> = {
      '\n': '\\n',
      '\r': '\\r',
      '\t': '\\t',
    }
    return escapes[char] ?? `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`
  })
}

function renderTable(rawRows: string[][], headers: string[]): string {
  const rows = rawRows.map((row) => row.map((cell) => sanitizeCell(cell ?? '')))
  const allRows = [headers, ...rows]
  const widths = headers.map((_, col) => Math.max(...allRows.map((r) => (r[col] ?? '').length)))
  const fmt = (r: string[]): string =>
    r
      .map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  const sep = widths
    .map((w) => '-'.repeat(w))
    .join('  ')
    .trimEnd()
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

function renderTailAllTable(envelopes: Array<{ connection: string; entry: AuditEntry }>): string {
  const headers = ['connection', 'ts', 'command', 'target', 'tier', 'success', 'id', 'recovery_ref']
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

// ── show helpers ──────────────────────────────────────────────────────────
type ShowEntry = Omit<AuditEntry, 'metadata' | 'redacted_query'>

function briefifyShow(entry: AuditEntry): ShowEntry {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { metadata, redacted_query, ...rest } = entry
  return rest
}

// Accept Partial<AuditEntry> so brief mode (which strips metadata + redacted_query)
// does not render literal "undefined" lines. Only emit a row when the field is present.
/** cell 同樣要逃脫——`audit show` 與 `audit tail` 讀的是同一批使用者可控字串。 */
function renderEntryTable(entry: Partial<AuditEntry>): string {
  const lines: string[] = []
  if (entry.id !== undefined) lines.push(`Id:                ${sanitizeCell(String(entry.id))}`)
  if (entry.ts !== undefined) lines.push(`Ts:                ${sanitizeCell(String(entry.ts))}`)
  if (entry.session_id !== undefined)
    lines.push(`Session id:        ${sanitizeCell(String(entry.session_id))}`)
  if (entry.engine !== undefined)
    lines.push(`Engine:            ${sanitizeCell(String(entry.engine))}`)
  if (entry.command !== undefined)
    lines.push(`Command:           ${sanitizeCell(String(entry.command))}`)
  if (entry.side_effect_tier !== undefined)
    lines.push(`Side effect tier:  ${sanitizeCell(String(entry.side_effect_tier))}`)
  if (entry.target !== undefined)
    lines.push(`Target:            ${sanitizeCell(String(entry.target))}`)
  if (entry.success !== undefined)
    lines.push(`Success:           ${sanitizeCell(String(entry.success))}`)
  if (entry.recovery_ref !== undefined)
    lines.push(`Recovery ref:      ${sanitizeCell(String(entry.recovery_ref))}`)
  if (entry.redacted_query !== undefined)
    lines.push(`Redacted query:    ${sanitizeCell(String(entry.redacted_query))}`)
  if (entry.redacted_sql !== undefined)
    lines.push(`Redacted SQL:      ${sanitizeCell(String(entry.redacted_sql))}`)
  if (entry.error !== undefined)
    lines.push(`Error:             ${sanitizeCell(String(entry.error))}`)
  if (entry.metadata !== undefined)
    lines.push(`Metadata:          ${JSON.stringify(entry.metadata)}`)
  return lines.join('\n')
}

function renderShowResult(
  hit: { connection: string; entry: AuditEntry },
  opts: { all: boolean; format: string; brief: boolean }
): void {
  if (opts.format === 'json') {
    const entryView: ShowEntry | AuditEntry = opts.brief ? briefifyShow(hit.entry) : hit.entry
    const payload = opts.all ? { connection: hit.connection, entry: entryView } : entryView
    console.log(JSON.stringify(payload, null, 2))
  } else {
    if (opts.all) console.log(`Connection: ${hit.connection}`)
    console.log(renderEntryTable(opts.brief ? briefifyShow(hit.entry) : hit.entry))
  }
}

// ── health helpers ────────────────────────────────────────────────────────
type BriefHealth = Pick<AuditHealthReport, 'enabled' | 'lastWrite' | 'rotationUsage'>

function briefifyHealth(h: AuditHealthReport): BriefHealth {
  return { enabled: h.enabled, lastWrite: h.lastWrite, rotationUsage: h.rotationUsage }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function renderHealthTable(h: AuditHealthReport): string {
  const sizePct = Math.round(h.rotationUsage.bytes.pct)
  const entriesPct = Math.round(h.rotationUsage.entries.pct)
  const lastWrite = h.lastWrite
    ? `${h.lastWrite.ts} (${h.lastWrite.success ? 'success' : 'failed'}${h.lastWrite.error ? `: ${h.lastWrite.error}` : ''})`
    : MISSING_PLACEHOLDER
  const lastError = h.lastError ? `${h.lastError.ts} ${h.lastError.message}` : MISSING_PLACEHOLDER
  const lastRotation = h.rotation.lastRotatedAt
    ? `${h.rotation.lastRotatedAt} (${h.rotation.previousFile ?? MISSING_PLACEHOLDER})`
    : MISSING_PLACEHOLDER
  return [
    `Enabled:        ${h.enabled}`,
    `File:           ${h.currentFile}`,
    `Size:           ${formatBytes(h.currentSizeBytes)} / ${formatBytes(h.rotationUsage.bytes.max)} (${sizePct}%)`,
    `Entries:        ${h.currentEntryCount} / ${h.rotationUsage.entries.max} (${entriesPct}%)`,
    `Lock:           ${h.lock.state}${h.lock.heldByPid !== undefined ? ` (pid ${h.lock.heldByPid})` : ''}`,
    `Last write:     ${lastWrite}`,
    `Last error:     ${lastError}`,
    `Session id:     ${h.sessionId ?? MISSING_PLACEHOLDER}`,
    `Last rotation:  ${lastRotation}`,
  ].join('\n')
}

// ── clear helpers ─────────────────────────────────────────────────────────
function readLineFromStdinWithStderrPrompt(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt)
    const chunks: Buffer[] = []
    let data = ''
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk)
      data = Buffer.concat(chunks).toString()
      const lines = data.split('\n')
      if (lines.length > 1) {
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        process.stdin.removeListener('end', onEnd)
        resolve((lines[0] ?? '').trim())
      }
    }
    const onEnd = (): void => {
      process.stdin.removeListener('data', onData)
      resolve(data.trim())
    }
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.resume()
  })
}

/** `declined 3, refused 1` — the outcome breakdown as one line. */
function formatOutcomeCounts(outcomes: Record<string, number>): string {
  const seen = Object.entries(outcomes).filter(([, count]) => count > 0)
  if (seen.length === 0) return MISSING_PLACEHOLDER
  return seen.map(([name, count]) => `${name} ${count}`).join(', ')
}

function renderWriteGateSummary(summary: WriteGateSummary, connections: string[]): string {
  const lines: string[] = []
  lines.push(
    t_vars('audit.write_gate.header', {
      conn: connections.length > 0 ? connections.join(', ') : MISSING_PLACEHOLDER,
    })
  )
  // No window line when nothing was scanned: `— → —` reads as a measurement
  // over an unknown interval, when in fact no interval was measured.
  if (summary.window) {
    lines.push(
      t_vars('audit.write_gate.window', {
        scanned: String(summary.scanned),
        from: summary.window.from,
        to: summary.window.to,
      })
    )
  }

  if (summary.total === 0) {
    // Zero is a result, not an empty table. ADR 0010 says an untouched tier two
    // falsifies the criterion rather than the gate, so the summary has to say
    // which of those two readings the data supports instead of printing blanks.
    lines.push('')
    lines.push(
      summary.scanned === 0 ? t('audit.write_gate.no_entries') : t('audit.write_gate.no_decisions')
    )
    if (summary.tierOne.total > 0) {
      lines.push(
        t_vars('audit.write_gate.tier_one', {
          count: String(summary.tierOne.total),
          outcomes: formatOutcomeCounts(summary.tierOne.outcomes),
        })
      )
    }
    return lines.join('\n')
  }

  lines.push(
    t_vars('audit.write_gate.decisions', {
      count: String(summary.total),
      from: summary.range?.from ?? MISSING_PLACEHOLDER,
      to: summary.range?.to ?? MISSING_PLACEHOLDER,
    })
  )
  lines.push('')
  lines.push(
    renderTable(
      Object.entries(summary.outcomes).map(([name, count]) => [name, String(count)]),
      ['outcome', 'count']
    )
  )
  lines.push('')
  lines.push(
    renderTable(
      Object.entries(summary.reasons).map(([name, count]) => [name, String(count)]),
      ['reason', 'count']
    )
  )
  lines.push('')
  lines.push(
    t_vars('audit.write_gate.tier_one', {
      count: String(summary.tierOne.total),
      outcomes: formatOutcomeCounts(summary.tierOne.outcomes),
    })
  )
  return lines.join('\n')
}

async function statAuditFile(file: string): Promise<{ entries: number; size: string } | null> {
  try {
    const s = await stat(file)
    const entries = (await readEntries(file)).length
    return { entries, size: formatBytes(s.size) }
  } catch {
    return null
  }
}

export const auditCommand = new Command('audit').description(t('audit.description'))

auditCommand
  .command('tail')
  .description(t('audit.tail.description'))
  .option(
    '--n <number>',
    `Number of recent entries to show (1..${MAX_TAIL_N})`,
    String(DEFAULT_TAIL_N)
  )
  .option('--all', 'Merge entries across all connections', false)
  .option(
    '--format <format>',
    `Output format: ${ALLOWED_FORMATS.join(' | ')} (default: table)`,
    'table'
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

auditCommand
  .command('show [id]')
  .description(t('audit.show.description'))
  .option('--all', 'Search across all connections', false)
  .option('--recovery-ref <ref>', 'Look up by entry.recovery_ref (exact match)')
  .option(
    '--format <format>',
    `Output format: ${ALLOWED_FORMATS.join(' | ')} (default: table)`,
    'table'
  )
  .option('--brief', 'Trim metadata + redacted_query', false)
  .option('--no-brief', 'Disable brief mode (override --for-agent default)')
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .action(async (id: string | undefined, options: Record<string, unknown>, command: Command) => {
    // (1) Mutex / required check (D-38)
    if (id && options.recoveryRef) {
      console.error(t('audit.show_mutex_violation'))
      process.exit(1)
    }
    if (!id && !options.recoveryRef) {
      console.error(t('audit.show_mutex_violation'))
      process.exit(1)
    }

    // (2) Format / brief
    const forAgent = options.forAgent === true
    const format = forAgent ? 'json' : (options.format as string)
    const briefSource = command.getOptionValueSource('brief')
    const briefExplicit = briefSource !== undefined && briefSource !== 'default'
    const brief = briefExplicit ? options.brief === true : forAgent
    validateFormat(format, ALLOWED_FORMATS, 'audit show')

    const configPath = resolveConfigPath(command, options as { config?: string })
    const config = (await configModule.read(configPath)) as AuditConfigShape
    if (isAuditDisabled(config)) emitDisabledAndExit0()

    const { auditDir, auditFile, connectionName } = await resolveAuditPaths(configPath, config)
    const all = options.all === true

    // (3) Recovery-ref path (D-37)
    if (options.recoveryRef) {
      const ref = String(options.recoveryRef)
      const matches: Array<{ connection: string; entry: AuditEntry }> = []
      if (all) {
        const conns = await discoverConnections(auditDir)
        for (const c of conns) {
          for (const f of c.files) {
            for (const e of await readEntries(f)) {
              if (e.recovery_ref === ref) matches.push({ connection: c.connection, entry: e })
            }
          }
        }
      } else {
        for (const e of await readEntries(auditFile, { include_rotated: true })) {
          if (e.recovery_ref === ref) matches.push({ connection: connectionName, entry: e })
        }
      }
      if (matches.length === 0) {
        console.error(t_vars('audit.show_recovery_no_match', { ref }))
        process.exit(1)
      }
      if (matches.length > 1) {
        console.error(
          t_vars('audit.show_recovery_ambiguous', {
            ref,
            count: String(matches.length),
          })
        )
        process.exit(1)
      }
      renderShowResult(matches[0]!, { all, format, brief })
      return
    }

    // (4) <id> path: prefix length guard (D-35)
    const lookup = String(id)
    if (lookup.length < PREFIX_MIN) {
      console.error(t('audit.show_prefix_too_short'))
      process.exit(1)
    }
    const matches: Array<{ connection: string; entry: AuditEntry }> = []
    if (all) {
      const conns = await discoverConnections(auditDir)
      for (const c of conns) {
        for (const f of c.files) {
          for (const e of await readEntries(f)) {
            if (e.id === lookup || e.id.startsWith(lookup))
              matches.push({ connection: c.connection, entry: e })
          }
        }
      }
    } else {
      for (const e of await readEntries(auditFile, { include_rotated: true })) {
        if (e.id === lookup || e.id.startsWith(lookup))
          matches.push({ connection: connectionName, entry: e })
      }
    }
    if (matches.length === 0) {
      console.error(t_vars('audit.show_no_match', { prefix: lookup }))
      process.exit(1)
    }
    if (matches.length > 1) {
      console.error(
        t_vars('audit.show_ambiguous', {
          prefix: lookup,
          count: String(matches.length),
        })
      )
      process.exit(1)
    }
    renderShowResult(matches[0]!, { all, format, brief })
  })

auditCommand
  .command('clear')
  .description(t('audit.clear.description'))
  .option('--yes', 'Skip confirmation prompt and delete immediately', false)
  .action(async (options: Record<string, unknown>, command: Command) => {
    const configPath = resolveConfigPath(command, options as { config?: string })
    const config = (await configModule.read(configPath)) as AuditConfigShape
    // NOTE: clear does NOT short-circuit on audit.enabled=false;
    // clearing existing history is a valid op even when writer is disabled.

    const { auditFile, connectionName } = await resolveAuditPaths(configPath, config)
    const rotatedFile = `${auditFile}.1`
    const lockFile = `${auditFile}.lock`

    const currentInfo = await statAuditFile(auditFile)
    const rotatedInfo = await statAuditFile(rotatedFile)

    if (currentInfo === null && rotatedInfo === null) {
      process.stderr.write(t('audit.clear.summary_nothing') + '\n')
      process.exit(0)
    }

    // Confirm path (D-45 / D-46)
    if (options.yes !== true) {
      if (!process.stdin.isTTY) {
        console.error(t('audit.clear.requires_tty_or_yes'))
        process.exit(1)
      }
      process.stderr.write(t_vars('audit.clear.prompt_header', { conn: connectionName }) + '\n')
      if (currentInfo) {
        process.stderr.write(
          t_vars('audit.clear.prompt_file_line', {
            file: auditFile,
            entries: String(currentInfo.entries),
            size: currentInfo.size,
          }) + '\n'
        )
      }
      if (rotatedInfo) {
        process.stderr.write(
          t_vars('audit.clear.prompt_file_line', {
            file: rotatedFile,
            entries: String(rotatedInfo.entries),
            size: rotatedInfo.size,
          }) + '\n'
        )
      }
      const answer = await readLineFromStdinWithStderrPrompt(t('audit.clear.prompt_continue'))
      const lower = answer.toLowerCase()
      const proceed = lower === 'y' || lower === 'yes'
      if (!proceed) {
        process.stderr.write(t('audit.clear.summary_nothing') + '\n')
        process.exit(0)
      }
    }

    // Delete files (D-47): both .jsonl + .jsonl.1 + leftover .lock; ignore missing.
    let cleared = 0
    try {
      if (currentInfo) cleared += currentInfo.entries
      if (rotatedInfo) cleared += rotatedInfo.entries
      await rm(auditFile, { force: true })
      await rm(rotatedFile, { force: true })
      await rm(lockFile, { force: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(t_vars('audit.clear.summary_failed', { message: msg }) + '\n')
      process.exit(1)
    }

    process.stderr.write(
      t_vars('audit.clear.summary_cleared', {
        count: String(cleared),
        conn: connectionName,
      }) + '\n'
    )
    // F decision: NO writeAuditEntry / NO logger.write here.
    // D-48: NO touch on .dbcli/last-session-id.
    process.exit(0)
  })

auditCommand
  .command('write-gate')
  .description(t('audit.write_gate.description'))
  .option('--all', 'Summarize across all connections', false)
  .option(
    '--format <format>',
    `Output format: ${ALLOWED_FORMATS.join(' | ')} (default: table)`,
    'table'
  )
  .option('--for-agent', 'Shortcut for --format json', false)
  .action(async (options: Record<string, unknown>, command: Command) => {
    const format = options.forAgent === true ? 'json' : (options.format as string)
    validateFormat(format, ALLOWED_FORMATS, 'audit write-gate')

    const configPath = resolveConfigPath(command, options as { config?: string })
    const config = (await configModule.read(configPath)) as AuditConfigShape
    if (isAuditDisabled(config)) emitDisabledAndExit0()

    const { auditDir, auditFile, connectionName } = await resolveAuditPaths(configPath, config)

    // Rotated files included throughout: the measurement is over the whole
    // retained history, and a gate decision that rotated out of the current file
    // is still a decision the criterion made.
    let entries: AuditEntry[] = []
    let connections: string[] = [connectionName]
    if (options.all === true) {
      const discovered = await discoverConnections(auditDir)
      connections = discovered.map((c) => c.connection)
      for (const c of discovered) {
        for (const file of c.files) entries.push(...(await readEntries(file)))
      }
    } else {
      entries = await readEntries(auditFile, { include_rotated: true })
    }

    const summary = summarizeWriteGate(entries)
    if (format === 'json') {
      console.log(JSON.stringify({ connections, summary }, null, 2))
      return
    }
    console.log(renderWriteGateSummary(summary, connections))
  })

auditCommand
  .command('health')
  .description(t('audit.health.description'))
  .option(
    '--format <format>',
    `Output format: ${ALLOWED_FORMATS.join(' | ')} (default: table)`,
    'table'
  )
  .option('--brief', 'Trim to enabled / lastWrite / rotationUsage', false)
  .option('--no-brief', 'Disable brief mode (override --for-agent default)')
  .option('--for-agent', 'Shortcut for --format json --brief', false)
  .action(async (options: Record<string, unknown>, command: Command) => {
    const forAgent = options.forAgent === true
    const format = forAgent ? 'json' : (options.format as string)
    const briefSource = command.getOptionValueSource('brief')
    const briefExplicit = briefSource !== undefined && briefSource !== 'default'
    const brief = briefExplicit ? options.brief === true : forAgent
    validateFormat(format, ALLOWED_FORMATS, 'audit health')

    const configPath = resolveConfigPath(command, options as { config?: string })
    const config = (await configModule.read(configPath)) as AuditConfigShape
    // E exception: health does NOT short-circuit on audit.enabled=false;
    // health is exactly the tool to observe the enabled-state.

    const logger = await getAuditLogger(config as never, configPath)
    const health = logger.getHealth()
    if (format === 'json') {
      const payload: AuditHealthReport | BriefHealth = brief ? briefifyHealth(health) : health
      console.log(JSON.stringify(payload, null, 2))
    } else if (brief) {
      const sizePct = Math.round(health.rotationUsage.bytes.pct)
      const entriesPct = Math.round(health.rotationUsage.entries.pct)
      const lastWriteLine = health.lastWrite
        ? `${health.lastWrite.ts} (${health.lastWrite.success ? 'success' : 'failed'})`
        : MISSING_PLACEHOLDER
      console.log(`Enabled:        ${health.enabled}`)
      console.log(`Last write:     ${lastWriteLine}`)
      console.log(`Rotation usage: ${sizePct}% bytes, ${entriesPct}% entries`)
    } else {
      console.log(renderHealthTable(health))
    }
  })
