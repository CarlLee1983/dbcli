import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { containsBlockedSemanticIdentifier } from '@/core/semantic'
import { applyRedaction, type ProxyEvent } from '@/proxy/events'

const MAX_EVENT_LOG_BYTES = 2 * 1024 * 1024
const MAX_EVENT_LINES = 10_000
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type WorkloadEvidenceState = 'available' | 'absent' | 'invalid' | 'unavailable'
export type WorkloadIssue =
  | 'malformed'
  | 'stale'
  | 'redaction-failed'
  | 'redacted-protected-subject'

export interface ObservedWorkload {
  tables: readonly string[]
}

export interface WorkloadTimeframe {
  from: string
  to: string
}

export interface WorkloadEvidence {
  state: WorkloadEvidenceState
  /** A logical origin only. The supplied path is never retained. */
  origin: 'proxy-workload'
  observations: readonly ObservedWorkload[]
  malformedLines: number
  issues: readonly WorkloadIssue[]
  timeframe?: WorkloadTimeframe
}

export interface LoadWorkloadEvidenceOptions {
  path: string
  blockedIdentifiers: readonly string[]
  now?: Date
}

/**
 * Projects one explicitly selected proxy event file into bounded, redacted
 * workload evidence. It deliberately never delegates to the general event
 * reader because that reader retains unbounded event bodies for QueryLens.
 */
export async function loadWorkloadEvidence(
  options: LoadWorkloadEvidenceOptions
): Promise<WorkloadEvidence> {
  const now = options.now ?? new Date()
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(options.path)
  } catch (error) {
    return sourceFailure(
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unavailable'
    )
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_EVENT_LOG_BYTES)
    return sourceFailure('invalid')

  const tables = new Set<string>()
  const timestamps: Date[] = []
  let malformedLines = 0
  let redactionFailed = false
  let redactedProtectedSubject = false
  const cutoff = now.getTime() - MAX_EVENT_AGE_MS

  let lineCount = 0
  try {
    const reader = createInterface({
      input: createReadStream(options.path, { encoding: 'utf8', end: MAX_EVENT_LOG_BYTES - 1 }),
      crlfDelay: Infinity,
    })
    for await (const line of reader) {
      if (!line.trim()) continue
      lineCount += 1
      if (lineCount > MAX_EVENT_LINES) return sourceFailure('invalid')
      const parsed = parseEvent(line)
      if (parsed.kind === 'invalid') {
        malformedLines += 1
        continue
      }
      if (parsed.kind === 'ignored') continue
      const event = parsed.event
      let redacted: ProxyEvent
      try {
        redacted = applyRedaction(event, 'literals')
      } catch {
        redactionFailed = true
        continue
      }
      if (!hasSafeQueryShape(redacted)) {
        redactionFailed = true
        continue
      }
      const timestamp = new Date(redacted.timestamp)
      if (Number.isNaN(timestamp.getTime())) {
        malformedLines += 1
        continue
      }
      if (timestamp.getTime() < cutoff || timestamp.getTime() > now.getTime()) continue
      const tableReferences = [...new Set(redacted.tables)].sort(codePointOrder)
      const safeTables = tableReferences.filter(
        (table) => !containsBlockedSemanticIdentifier(table, options.blockedIdentifiers)
      )
      if (safeTables.length !== tableReferences.length) {
        redactedProtectedSubject = true
      }
      timestamps.push(timestamp)
      for (const table of safeTables) tables.add(table)
    }
  } catch {
    return sourceFailure('unavailable')
  }

  try {
    if ((await lstat(options.path)).size > MAX_EVENT_LOG_BYTES) return sourceFailure('invalid')
  } catch {
    return sourceFailure('unavailable')
  }

  const issues: WorkloadIssue[] = []
  if (malformedLines > 0) issues.push('malformed')
  if (redactionFailed) issues.push('redaction-failed')
  if (redactedProtectedSubject) issues.push('redacted-protected-subject')
  if (timestamps.length === 0) issues.push('stale')
  const sortedTimestamps = timestamps.sort((left, right) => left.getTime() - right.getTime())
  return {
    state: 'available',
    origin: 'proxy-workload',
    observations: tables.size > 0 ? [{ tables: [...tables].sort(codePointOrder) }] : [],
    malformedLines,
    issues,
    ...(sortedTimestamps.length > 0 && {
      timeframe: {
        from: sortedTimestamps[0]!.toISOString(),
        to: sortedTimestamps.at(-1)!.toISOString(),
      },
    }),
  }
}

function sourceFailure(state: Exclude<WorkloadEvidenceState, 'available'>): WorkloadEvidence {
  return { state, origin: 'proxy-workload', observations: [], malformedLines: 0, issues: [] }
}

function parseEvent(
  line: string
): { kind: 'query'; event: ProxyEvent } | { kind: 'ignored' } | { kind: 'invalid' } {
  try {
    const value: unknown = JSON.parse(line)
    if (!isKnownEventEnvelope(value)) return { kind: 'invalid' }
    return hasQueryEnvelope(value) ? { kind: 'query', event: value } : { kind: 'ignored' }
  } catch {
    return { kind: 'invalid' }
  }
}

function isKnownEventEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return (
    event.version === 1 &&
    typeof event.timestamp === 'string' &&
    [
      'proxy_started',
      'session_started',
      'session_ended',
      'query_observed',
      'query_completed',
      'query_errored',
      'parse_error',
    ].includes(String(event.type))
  )
}

function hasSafeQueryShape(value: unknown): value is Extract<ProxyEvent, { sql: string }> {
  return hasQueryEnvelope(value) && value.tables.every((table) => isCanonicalTableReference(table))
}

function hasQueryEnvelope(value: unknown): value is Extract<ProxyEvent, { sql: string }> {
  if (!isKnownEventEnvelope(value)) return false
  const event = value as Record<string, unknown>
  return (
    event.version === 1 &&
    (event.type === 'query_completed' || event.type === 'query_errored') &&
    typeof event.sql === 'string' &&
    typeof event.timestamp === 'string' &&
    Array.isArray(event.tables) &&
    event.tables.every((table) => typeof table === 'string')
  )
}

function isCanonicalTableReference(value: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function codePointOrder(left: string, right: string): number {
  const leftPoints = [...left]
  const rightPoints = [...right]
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}
