// src/proxy/events.ts
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
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

export interface EventWriterOptions {
  path: string
  redact: RedactMode
}

/**
 * Append-only JSONL writer. Creates the parent directory on first write.
 * Write failures are surfaced to the caller (fail loud) rather than swallowed —
 * the server stops accepting new sessions on write error per the spec.
 */
export class EventWriter {
  private readonly path: string
  private readonly redact: RedactMode
  private dirEnsured = false

  constructor(opts: EventWriterOptions) {
    this.path = opts.path
    this.redact = opts.redact
  }

  async write(event: ProxyEvent): Promise<void> {
    if (!this.dirEnsured) {
      await mkdir(dirname(this.path), { recursive: true })
      this.dirEnsured = true
    }
    const redacted = applyRedaction(event, this.redact)
    await appendFile(this.path, JSON.stringify(redacted) + '\n', { encoding: 'utf8' })
  }
}
