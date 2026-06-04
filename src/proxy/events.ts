// src/proxy/events.ts
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { rotate, shouldRotate } from '@/utils/jsonl-rotation'
import { redactLiterals, type StatementType } from './sql-metadata'

export const PROXY_EVENT_VERSION = 1 as const
export type ProxyEngine = 'mysql' | 'mariadb' | 'postgresql'
export type RedactMode = 'none' | 'literals'

interface BaseEvent {
  version: 1
  type: string
  timestamp: string
  engine: ProxyEngine
  sessionId: string
}

export interface ProxyStartedEvent extends BaseEvent {
  type: 'proxy_started'
  listen: string
  target: string
}

export interface SessionStartedEvent extends BaseEvent {
  type: 'session_started'
  client: string
  target: string
}

export interface SessionEndedEvent extends BaseEvent {
  type: 'session_ended'
  client: string
  target: string
  durationMs: number
  requestBytes: number
  responseBytes: number
  reason: 'client_closed' | 'upstream_closed' | 'error'
}

export interface QueryObservedEvent extends BaseEvent {
  type: 'query_observed'
  queryId: string
  client: string
  target: string
  sql: string
  statement: StatementType
  tables: string[]
  tags: string[]
}

export interface QueryCompletedEvent extends BaseEvent {
  type: 'query_completed'
  queryId: string
  client: string
  target: string
  sql: string
  statement: StatementType
  tables: string[]
  durationMs: number
  requestBytes: number
  responseBytes: number
  rowCount: number | null
  /** True when durationMs >= the configured --slow-ms threshold. */
  slow: boolean
  error: null
  tags: string[]
}

export interface QueryErroredEvent extends BaseEvent {
  type: 'query_errored'
  queryId: string
  client: string
  target: string
  sql: string
  statement: StatementType
  tables: string[]
  durationMs: number
  requestBytes: number
  responseBytes: number
  rowCount: null
  error: { code: string | null; message: string }
  tags: string[]
}

export interface ParseErrorEvent extends BaseEvent {
  type: 'parse_error'
  client: string
  target: string
  message: string
  tags: string[]
}

export type ProxyEvent =
  | ProxyStartedEvent
  | SessionStartedEvent
  | SessionEndedEvent
  | QueryObservedEvent
  | QueryCompletedEvent
  | QueryErroredEvent
  | ParseErrorEvent

/** Events that carry an `sql` field subject to redaction. */
function hasSql(e: ProxyEvent): e is QueryObservedEvent | QueryCompletedEvent | QueryErroredEvent {
  return e.type === 'query_observed' || e.type === 'query_completed' || e.type === 'query_errored'
}

/** Redaction boundary — returns a new event; never mutates the input. */
export function applyRedaction<E extends ProxyEvent>(event: E, mode: RedactMode): E {
  if (mode === 'none' || !hasSql(event)) return event
  return { ...event, sql: redactLiterals(event.sql) }
}

/** Rotation caps for the proxy event log. One rolling segment is kept (`<path>.1`). */
export interface RotationOptions {
  maxBytes: number
  maxEntries: number
}

/** Worst-case on-disk footprint is 2x maxBytes (current + one rolling segment). */
export const DEFAULT_ROTATION: RotationOptions = {
  maxBytes: 50 * 1024 * 1024, // 50 MiB
  maxEntries: 200_000,
}

export interface EventWriterOptions {
  path: string
  redact: RedactMode
  /** Defaults to DEFAULT_ROTATION. */
  rotation?: RotationOptions
}

/**
 * Append-only JSONL writer. Creates the parent directory on first write.
 *
 * Concurrency: every write is serialized through a single in-process promise
 * chain so the many ProxySessions (plus the root proxy_started write) sharing
 * one writer can never interleave partial lines or race the rotation counters.
 * A rejected write is isolated to its own caller — the chain itself swallows it
 * so one failure can't wedge all later writes — while the caller still sees the
 * rejection (fail loud; the server stops accepting new sessions on write error).
 *
 * Rotation: when the next line would meet/exceed either cap, the current file is
 * renamed to `<path>.1` (overwriting any prior segment) and a fresh file begins,
 * bounding unbounded growth. Counters are re-synced from disk on first write so
 * a process restart over an existing log rotates at the right point.
 */
export class EventWriter {
  private readonly path: string
  private readonly previousPath: string
  private readonly redact: RedactMode
  private readonly maxBytes: number
  private readonly maxEntries: number
  private dirEnsured = false
  private initialized = false
  private currentSizeBytes = 0
  private currentEntryCount = 0
  private writeChain: Promise<void> = Promise.resolve()

  constructor(opts: EventWriterOptions) {
    this.path = opts.path
    this.previousPath = `${opts.path}.1`
    this.redact = opts.redact
    this.maxBytes = opts.rotation?.maxBytes ?? DEFAULT_ROTATION.maxBytes
    this.maxEntries = opts.rotation?.maxEntries ?? DEFAULT_ROTATION.maxEntries
  }

  write(event: ProxyEvent): Promise<void> {
    const op = this.writeChain.then(() => this.writeInternal(event))
    // Keep the chain alive even if this write rejects; the rejection still
    // propagates to the returned `op` so the caller sees it (fail loud).
    this.writeChain = op.then(
      () => undefined,
      () => undefined
    )
    return op
  }

  private async writeInternal(event: ProxyEvent): Promise<void> {
    if (!this.dirEnsured) {
      await mkdir(dirname(this.path), { recursive: true })
      this.dirEnsured = true
    }
    if (!this.initialized) {
      await this.syncCountersFromDisk()
      this.initialized = true
    }
    const redacted = applyRedaction(event, this.redact)
    const line = JSON.stringify(redacted) + '\n'
    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (
      shouldRotate(
        { currentSizeBytes: this.currentSizeBytes, currentEntryCount: this.currentEntryCount },
        { maxBytes: this.maxBytes, maxEntries: this.maxEntries },
        lineBytes
      )
    ) {
      await rotate(this.path, this.previousPath)
      this.currentSizeBytes = 0
      this.currentEntryCount = 0
    }
    await appendFile(this.path, line, { encoding: 'utf8' })
    this.currentSizeBytes += lineBytes
    this.currentEntryCount += 1
  }

  /** Resync counters from an existing log so restarts rotate at the right point. */
  private async syncCountersFromDisk(): Promise<void> {
    try {
      const s = await stat(this.path)
      this.currentSizeBytes = s.size
      const raw = await readFile(this.path, 'utf8')
      this.currentEntryCount = raw.split('\n').filter(Boolean).length
    } catch {
      // File doesn't exist yet — counters stay at 0.
      this.currentSizeBytes = 0
      this.currentEntryCount = 0
    }
  }
}
