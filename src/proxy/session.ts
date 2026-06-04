// src/proxy/session.ts
import type { AnalyzerSignal } from './analyzers/types'
import type { ProxyEngine, ProxyEvent } from './events'
import { PROXY_EVENT_VERSION } from './events'
import { detectStatement, extractTables } from './sql-metadata'

export interface ProxySessionOptions {
  sessionId: string
  engine: ProxyEngine
  client: string
  target: string
  slowMs: number
  now: () => number
  getBytes: () => { clientBytes: number; serverBytes: number }
  writeEvent: (event: ProxyEvent) => Promise<void>
  warn: (message: string) => void
}

interface ActiveQuery {
  queryId: string
  sql: string
  startedAt: number
  clientBytesAtStart: number
  serverBytesAtStart: number
  tags: string[]
}

export class ProxySession {
  private readonly o: ProxySessionOptions
  private active: ActiveQuery | null = null
  private queryCounter = 0
  private startedAt = 0
  private clientBytesAtBoundary = 0
  private pending: Promise<void> = Promise.resolve()

  constructor(opts: ProxySessionOptions) {
    this.o = opts
  }

  /** Chain a write so flush() can await all in-flight event writes. */
  private enqueue(event: ProxyEvent): void {
    this.pending = this.pending.then(() => this.o.writeEvent(event))
  }

  async start(): Promise<void> {
    this.startedAt = this.o.now()
    this.enqueue({
      version: PROXY_EVENT_VERSION,
      type: 'session_started',
      timestamp: new Date().toISOString(),
      engine: this.o.engine,
      sessionId: this.o.sessionId,
      client: this.o.client,
      target: this.o.target,
    })
    await this.flush()
  }

  onSignal(signal: AnalyzerSignal): void {
    switch (signal.kind) {
      case 'query':
        this.beginQuery(signal.sql, signal.tags ?? [])
        break
      case 'query_end':
        this.completeQuery(signal.rowCount ?? null)
        break
      case 'error':
        this.errorQuery(signal.code, signal.message)
        break
      case 'tag':
        if (this.active && !this.active.tags.includes(signal.tag)) {
          this.active.tags.push(signal.tag)
        }
        break
      case 'parse_error':
        this.enqueue({
          version: PROXY_EVENT_VERSION,
          type: 'parse_error',
          timestamp: new Date().toISOString(),
          engine: this.o.engine,
          sessionId: this.o.sessionId,
          client: this.o.client,
          target: this.o.target,
          message: signal.message,
          tags: [],
        })
        break
    }
  }

  private beginQuery(sql: string, tags: string[]): void {
    const bytes = this.o.getBytes()
    this.queryCounter += 1
    this.active = {
      queryId: `qry_${this.o.sessionId}_${this.queryCounter}`,
      sql,
      startedAt: this.o.now(),
      clientBytesAtStart: this.clientBytesAtBoundary,
      serverBytesAtStart: bytes.serverBytes,
      tags: [...tags],
    }
    this.enqueue({
      version: PROXY_EVENT_VERSION,
      type: 'query_observed',
      timestamp: new Date().toISOString(),
      engine: this.o.engine,
      sessionId: this.o.sessionId,
      queryId: this.active.queryId,
      client: this.o.client,
      target: this.o.target,
      sql,
      statement: detectStatement(sql),
      tables: extractTables(sql),
      tags: this.active.tags,
    })
  }

  private completeQuery(rowCount: number | null): void {
    const q = this.active
    if (!q) return
    const bytes = this.o.getBytes()
    const durationMs = this.o.now() - q.startedAt
    const requestBytes = bytes.clientBytes - q.clientBytesAtStart
    const responseBytes = bytes.serverBytes - q.serverBytesAtStart
    this.enqueue({
      version: PROXY_EVENT_VERSION,
      type: 'query_completed',
      timestamp: new Date().toISOString(),
      engine: this.o.engine,
      sessionId: this.o.sessionId,
      queryId: q.queryId,
      client: this.o.client,
      target: this.o.target,
      sql: q.sql,
      statement: detectStatement(q.sql),
      tables: extractTables(q.sql),
      durationMs,
      requestBytes,
      responseBytes,
      rowCount,
      error: null,
      tags: q.tags,
    })
    if (durationMs >= this.o.slowMs) {
      this.o.warn(`slow query (${durationMs}ms): ${q.sql.slice(0, 80)}`)
    }
    this.clientBytesAtBoundary = bytes.clientBytes
    this.active = null
  }

  private errorQuery(code: string | null, message: string): void {
    const q = this.active
    const bytes = this.o.getBytes()
    const startedAt = q?.startedAt ?? this.o.now()
    this.enqueue({
      version: PROXY_EVENT_VERSION,
      type: 'query_errored',
      timestamp: new Date().toISOString(),
      engine: this.o.engine,
      sessionId: this.o.sessionId,
      queryId: q?.queryId ?? `qry_${this.o.sessionId}_err`,
      client: this.o.client,
      target: this.o.target,
      sql: q?.sql ?? '',
      statement: detectStatement(q?.sql ?? ''),
      tables: extractTables(q?.sql ?? ''),
      durationMs: this.o.now() - startedAt,
      requestBytes: q ? bytes.clientBytes - q.clientBytesAtStart : 0,
      responseBytes: q ? bytes.serverBytes - q.serverBytesAtStart : 0,
      rowCount: null,
      error: { code, message },
      tags: q?.tags ?? [],
    })
    this.clientBytesAtBoundary = bytes.clientBytes
    this.active = null
  }

  async end(reason: 'client_closed' | 'upstream_closed' | 'error'): Promise<void> {
    const bytes = this.o.getBytes()
    this.enqueue({
      version: PROXY_EVENT_VERSION,
      type: 'session_ended',
      timestamp: new Date().toISOString(),
      engine: this.o.engine,
      sessionId: this.o.sessionId,
      client: this.o.client,
      target: this.o.target,
      durationMs: this.o.now() - this.startedAt,
      requestBytes: bytes.clientBytes,
      responseBytes: bytes.serverBytes,
      reason,
    })
    await this.flush()
  }

  /** Await all queued event writes. */
  async flush(): Promise<void> {
    await this.pending
  }
}
