import { Command } from 'commander'
import {
  readVerificationArtifacts,
  filterVerificationArtifacts,
  VERIFICATION_STATUSES,
  VERIFICATION_SUBJECT_KINDS,
  isVerificationSubjectKind,
  type VerificationArtifactFilters,
  type VerificationArtifactRecord,
  type VerificationStatus,
  type VerificationSubjectKind,
} from '@/core/verification'
import { validateFormat } from '@/utils/validation'

const ALLOWED_FORMATS = ['json', 'table'] as const
const DEFAULT_LIMIT = 20

/** Parse `--status`; exits 1 with a concise allowed-status message on failure. */
export function parseStatusFilter(raw: string): VerificationStatus {
  if (!(VERIFICATION_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid --status '${raw}'. Allowed: ${VERIFICATION_STATUSES.join(', ')}`
    )
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
    r.map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0)).join('   ').trimEnd()
  const sep = widths.map((w) => '-'.repeat(w)).join('   ').trimEnd()
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

export const verificationCommand = new Command('verification').description(
  'Read-only inspection of verification artifacts under .dbcli/verification/'
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
      const limit = Math.max(0, parseInt(String(options.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
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
