import { Command } from 'commander'
import {
  readVerificationArtifacts,
  filterVerificationArtifacts,
  findVerificationArtifact,
  summarizeVerificationArtifacts,
  toLatestOnlySummary,
  VerificationArtifactSelectionError,
  VERIFICATION_STATUSES,
  VERIFICATION_SUBJECT_KINDS,
  isVerificationSubjectKind,
  pruneVerificationArtifacts,
  parseOlderThanDays,
  type VerificationArtifactFilters,
  type VerificationArtifactRecord,
  type VerificationArtifactSummary,
  type VerificationLatestOnlySummary,
  type VerificationStatus,
  type VerificationSubjectKind,
  type VerificationSubject,
  type PruneCriteria,
  type PruneResult,
} from '@/core/verification'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['json', 'table'] as const
const DEFAULT_LIMIT = 20

/** Parse `--status`; exits 1 with a concise allowed-status message on failure. */
export function parseStatusFilter(raw: string): VerificationStatus {
  if (!(VERIFICATION_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`Invalid --status '${raw}'. Allowed: ${VERIFICATION_STATUSES.join(', ')}`)
  }
  return raw as VerificationStatus
}

/** Parse `--subject` as `<kind>` or `<kind>:<name>`; exits 1 on unknown kind. */
export function parseSubjectFilter(raw: string): { kind: VerificationSubjectKind; name?: string } {
  const idx = raw.indexOf(':')
  const kind = (idx === -1 ? raw : raw.slice(0, idx)).trim()
  const name = idx === -1 ? undefined : raw.slice(idx + 1).trim()
  if (kind.length === 0 || (idx !== -1 && (name ?? '').length === 0)) {
    throw new Error(`Invalid --subject '${raw}'. Use "<kind>" or "<kind>:<name>"`)
  }
  if (!isVerificationSubjectKind(kind)) {
    throw new Error(
      `Unknown subject kind '${kind}'. Allowed: ${VERIFICATION_SUBJECT_KINDS.join(', ')}`
    )
  }
  return name === undefined ? { kind } : { kind, name }
}

/** Build a filter object from raw CLI option strings (or undefined). */
function buildFilters(opts: { status?: string; subject?: string }): VerificationArtifactFilters {
  const filters: VerificationArtifactFilters = {}
  if (opts.status !== undefined) filters.status = parseStatusFilter(opts.status)
  if (opts.subject !== undefined) filters.subject = parseSubjectFilter(opts.subject)
  return filters
}

function subjectLabel(subject: { kind: string; name?: string }): string {
  return subject.name ? `${subject.kind}:${subject.name}` : subject.kind
}

function renderTable(rows: string[][], headers: string[]): string {
  const all = [headers, ...rows]
  const widths = headers.map((_, c) => Math.max(...all.map((r) => (r[c] ?? '').length)))
  const fmt = (r: string[]): string =>
    r
      .map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0))
      .join('   ')
      .trimEnd()
  const sep = widths
    .map((w) => '-'.repeat(w))
    .join('   ')
    .trimEnd()
  return [fmt(headers), sep, ...rows.map(fmt)].join('\n')
}

function listItem(r: VerificationArtifactRecord): Record<string, unknown> {
  return {
    path: r.path,
    filename: r.filename,
    id: r.artifact.id,
    createdAt: r.artifact.createdAt,
    status: r.artifact.status,
    subject: r.artifact.subject,
    summary: r.artifact.summary,
    evidenceCount: r.artifact.evidence.length,
  }
}

function renderShowTable(r: VerificationArtifactRecord): string {
  const a = r.artifact
  const lines = [
    `Id:          ${a.id}`,
    `Created at:  ${a.createdAt}`,
    `Status:      ${a.status}`,
    `Subject:     ${subjectLabel(a.subject)}`,
    `Summary:     ${a.summary}`,
  ]
  if (a.blockedReason) lines.push(`Blocked:     ${a.blockedReason}`)
  lines.push('Evidence:')
  for (const e of a.evidence) {
    const parts = [`kind=${e.kind}`]
    if (e.exitCode !== undefined) parts.push(`exitCode=${e.exitCode}`)
    if (e.command !== undefined) parts.push(`command=${e.command}`)
    if (e.auditRef !== undefined) parts.push(`auditRef=${e.auditRef}`)
    if (e.note !== undefined) parts.push(`note=${e.note}`)
    lines.push(`  - ${parts.join(' ')}`)
  }
  return lines.join('\n')
}

function renderSummaryTable(s: VerificationArtifactSummary): string {
  const lines: string[] = []
  lines.push(`Storage dir: ${s.storageDir}`)
  if (s.latest) {
    lines.push(`Latest:      ${s.latest.id} (${s.latest.status}) ${s.latest.createdAt}`)
    lines.push(`             ${subjectLabel(s.latest.subject)} — ${s.latest.summary}`)
  } else {
    lines.push('Latest:      (none)')
  }
  lines.push(
    `Counts:      total=${s.counts.total} verified=${s.counts.verified} ` +
      `not_verified=${s.counts.not_verified} indeterminate=${s.counts.indeterminate} ` +
      `blocked=${s.counts.blocked} invalid=${s.counts.invalid}`
  )
  if (s.subjects.length > 0) {
    lines.push('Subjects:')
    for (const sub of s.subjects) {
      lines.push(
        `  - ${subjectLabel(sub.subject)}: total=${sub.total} ` +
          `latest=${sub.latestStatus} (${sub.latestCreatedAt})`
      )
    }
  }
  return lines.join('\n')
}

function renderLatestOnlyTable(s: VerificationLatestOnlySummary): string {
  const lines: string[] = [`Storage dir: ${s.storageDir}`]
  if (s.latest) {
    lines.push(`Latest:      ${s.latest.id} (${s.latest.status}) ${s.latest.createdAt}`)
    lines.push(`             ${subjectLabel(s.latest.subject)} — ${s.latest.summary}`)
  } else {
    lines.push('Latest:      (none)')
  }
  lines.push(
    `Counts:      total=${s.counts.total} verified=${s.counts.verified} ` +
      `not_verified=${s.counts.not_verified} indeterminate=${s.counts.indeterminate} ` +
      `blocked=${s.counts.blocked} invalid=${s.counts.invalid}`
  )
  return lines.join('\n')
}

function pruneSubjectLabel(subject: VerificationSubject | null): string {
  if (!subject) return '-'
  return subject.name ? `${subject.kind}:${subject.name}` : subject.kind
}

function renderPruneTable(result: PruneResult): string {
  const mode = result.dryRun ? 'dry-run' : 'execute'
  const header = renderTable(
    [
      [
        mode,
        result.cutoff,
        String(result.candidates.length),
        String(result.protected.length),
        String(result.deleted.length),
        String(result.skipped.length),
      ],
    ],
    ['mode', 'cutoff', 'candidates', 'protected', 'deleted', 'skipped']
  )

  if (result.dryRun) {
    if (result.candidates.length === 0) return header
    const rows = result.candidates.map((c) => [
      c.createdAt ?? '(invalid)',
      c.status ?? '-',
      pruneSubjectLabel(c.subject),
      c.id ?? '-',
      c.filename,
    ])
    const body = renderTable(rows, ['createdAt', 'status', 'subject', 'id', 'filename'])
    return `${header}\n\ncandidates\n${body}`
  }

  // Execute mode: surface file-level accountability for what was deleted and skipped.
  const sections = [header]
  if (result.deleted.length > 0) {
    const rows = result.deleted.map((d) => [d.id ?? '-', d.filename])
    sections.push(`deleted\n${renderTable(rows, ['id', 'filename'])}`)
  }
  if (result.skipped.length > 0) {
    const rows = result.skipped.map((s) => [s.reason, s.id ?? '-', s.filename])
    sections.push(`skipped\n${renderTable(rows, ['reason', 'id', 'filename'])}`)
  }
  return sections.join('\n\n')
}

export const verificationCommand = new Command('verification').description(
  'Inspect and manage local verification artifacts under .dbcli/verification/'
)

verificationCommand
  .command('list')
  .description('List verification artifacts, latest-first')
  .option('--format <format>', `Output format: ${ALLOWED_FORMATS.join(' | ')}`, 'json')
  .option('--limit <n>', 'Maximum valid artifacts to return', String(DEFAULT_LIMIT))
  .option('--status <status>', 'Filter by verification status')
  .option('--subject <kind:name>', 'Filter by subject kind and optional name')
  .option('--include-invalid', 'Include bounded invalid-file metadata in JSON output', false)
  .action(async (options: Record<string, unknown>) => {
    try {
      const format = options.format as string
      validateFormat(format, ALLOWED_FORMATS, 'verification list')
      const parsedLimit = parseInt(String(options.limit ?? DEFAULT_LIMIT), 10)
      const limit = Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : Math.max(0, parsedLimit)
      const filters = buildFilters({
        status: options.status as string | undefined,
        subject: options.subject as string | undefined,
      })

      const read = await readVerificationArtifacts(process.cwd())
      const filtered = filterVerificationArtifacts(read.artifacts, filters).slice(0, limit)

      if (format === 'json') {
        console.log(
          JSON.stringify(
            {
              storageDir: read.storageDir,
              artifacts: filtered.map(listItem),
              invalid: options.includeInvalid === true ? read.invalid : [],
            },
            null,
            2
          )
        )
        return
      }

      if (filtered.length === 0) {
        console.error('No verification artifacts found.')
        return
      }
      const rows = filtered.map((r) => [
        r.artifact.createdAt,
        r.artifact.status,
        subjectLabel(r.artifact.subject),
        r.artifact.id,
      ])
      console.log(renderTable(rows, ['createdAt', 'status', 'subject', 'id']))
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

verificationCommand
  .command('show <selector>')
  .description('Print one verification artifact by id, prefix, filename, or path')
  .option('--format <format>', `Output format: ${ALLOWED_FORMATS.join(' | ')}`, 'json')
  .action(async (selector: string, options: Record<string, unknown>) => {
    try {
      const format = options.format as string
      validateFormat(format, ALLOWED_FORMATS, 'verification show')
      const read = await readVerificationArtifacts(process.cwd())
      let record: VerificationArtifactRecord
      try {
        record = findVerificationArtifact(read, selector)
      } catch (e) {
        if (e instanceof VerificationArtifactSelectionError) {
          console.error(e.message)
          process.exit(1)
        }
        throw e
      }
      if (format === 'json') {
        console.log(JSON.stringify({ path: record.path, artifact: record.artifact }, null, 2))
      } else {
        console.log(renderShowTable(record))
      }
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

verificationCommand
  .command('summary')
  .description('Summarize verification evidence for handoff')
  .option('--format <format>', `Output format: ${ALLOWED_FORMATS.join(' | ')}`, 'json')
  .option('--subject <kind:name>', 'Summarize only matching subject artifacts')
  .option('--status <status>', 'Summarize only matching status artifacts')
  .option('--latest-only', 'Print only the latest matching artifact and status counts', false)
  .action(async (options: Record<string, unknown>) => {
    try {
      const format = options.format as string
      validateFormat(format, ALLOWED_FORMATS, 'verification summary')
      const filters = buildFilters({
        status: options.status as string | undefined,
        subject: options.subject as string | undefined,
      })
      const read = await readVerificationArtifacts(process.cwd())
      const summary = summarizeVerificationArtifacts(read, filters)
      if (options.latestOnly === true) {
        const latestOnly = toLatestOnlySummary(summary)
        if (format === 'json') {
          console.log(JSON.stringify(latestOnly, null, 2))
        } else {
          console.log(renderLatestOnlyTable(latestOnly))
        }
        return
      }
      if (format === 'json') {
        console.log(JSON.stringify(summary, null, 2))
      } else {
        console.log(renderSummaryTable(summary))
      }
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })

verificationCommand
  .command('prune')
  .description(
    'Preview or delete local verification artifacts by retention criteria (dry-run by default)'
  )
  .option('--format <format>', `Output format: ${ALLOWED_FORMATS.join(' | ')}`, 'json')
  .option('--older-than <duration>', 'Minimum artifact age in whole days, e.g. 7d, 30d (required)')
  .option(
    '--keep-latest <n>',
    'Always protect the latest N valid artifacts across all subjects/statuses before filters',
    String(DEFAULT_LIMIT)
  )
  .option('--status <status>', 'Select only valid artifacts with this status')
  .option('--subject <kind:name>', 'Select only valid artifacts with this subject')
  .option(
    '--include-invalid',
    'Allow malformed verification-*.json files to be selected by file mtime',
    false
  )
  .option('--execute', 'Delete selected candidates instead of previewing (requires --force)', false)
  .option('--force', 'Acknowledge deletion; required together with --execute', false)
  .action(async (options: Record<string, unknown>) => {
    try {
      const format = options.format as string
      validateFormat(format, ALLOWED_FORMATS, 'verification prune')

      const olderThanRaw = options.olderThan as string | undefined
      if (olderThanRaw === undefined) {
        throw new Error('--older-than is required (e.g. --older-than 30d).')
      }
      const olderThanDays = parseOlderThanDays(olderThanRaw)

      const rawKeep = parseInt(String(options.keepLatest ?? DEFAULT_LIMIT), 10)
      const keepLatest = Number.isFinite(rawKeep) && rawKeep >= 0 ? rawKeep : DEFAULT_LIMIT

      const execute = options.execute === true
      const force = options.force === true
      if (execute && !force) {
        throw new Error('Refusing to delete without --force. Re-run with --execute --force.')
      }

      const filters = buildFilters({
        status: options.status as string | undefined,
        subject: options.subject as string | undefined,
      })
      const criteria: PruneCriteria = {
        olderThanDays,
        keepLatest,
        includeInvalid: options.includeInvalid === true,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.subject ? { subject: filters.subject } : {}),
      }

      const result = await pruneVerificationArtifacts(process.cwd(), criteria, {
        execute: execute && force,
      })

      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(renderPruneTable(result))
      }
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  })
