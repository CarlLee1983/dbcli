// src/proxy/server.ts
import { TcpRelay } from './relay'
import { ProxySession } from './session'
import { EventWriter, PROXY_EVENT_VERSION, type ProxyEngine, type RedactMode } from './events'
import { createMysqlAnalyzer } from './analyzers/mysql'
import { createPostgresAnalyzer } from './analyzers/postgresql'
import type { AnalyzerDeps, ProtocolAnalyzer } from './analyzers/types'

export interface ProxyServerOptions {
  engine: ProxyEngine
  listen: { host: string; port: number }
  target: { host: string; port: number }
  eventsPath: string
  slowMs: number
  redact: RedactMode
  warn: (message: string) => void
}

function makeAnalyzer(engine: ProxyEngine, deps: AnalyzerDeps): ProtocolAnalyzer {
  return engine === 'postgresql' ? createPostgresAnalyzer(deps) : createMysqlAnalyzer(deps)
}

interface BunTcpSocket {
  write(data: Uint8Array): number
  end(): void
  readonly remoteAddress?: string
  data?: unknown
}

/**
 * TCP observability proxy. Each inbound client connection opens one upstream
 * connection; bytes relay both ways, the analyzer runs side-band, events are
 * appended to JSONL. Forwarding is the main path and never blocks on analysis.
 */
export class ProxyServer {
  private readonly o: ProxyServerOptions
  private readonly writer: EventWriter
  private listener: { stop: () => void; port?: number } | null = null
  private sessionCounter = 0
  private writeFailed = false

  constructor(opts: ProxyServerOptions) {
    this.o = opts
    this.writer = new EventWriter({ path: opts.eventsPath, redact: opts.redact })
  }

  get port(): number | null {
    return (this.listener as { port?: number } | null)?.port ?? null
  }

  async start(): Promise<void> {
    // Emit proxy_started before accepting connections (fail loud on write error).
    await this.writer.write({
      version: PROXY_EVENT_VERSION,
      type: 'proxy_started',
      timestamp: new Date().toISOString(),
      engine: this.o.engine,
      sessionId: 'pxy_root',
      listen: `${this.o.listen.host}:${this.o.listen.port}`,
      target: `${this.o.target.host}:${this.o.target.port}`,
    })

    this.listener = Bun.listen({
      hostname: this.o.listen.host,
      port: this.o.listen.port,
      socket: {
        // Arrow fn so `this` is the ProxyServer instance (avoids aliasing `this`).
        open: (client: BunTcpSocket) => {
          void this.handleConnection(client)
        },
        data(client: BunTcpSocket, chunk: Uint8Array) {
          const ctx = client.data as { onData?: (c: Uint8Array) => void } | undefined
          ctx?.onData?.(chunk)
        },
        close(client: BunTcpSocket) {
          const ctx = client.data as { onClose?: () => void } | undefined
          ctx?.onClose?.()
        },
        error(client: BunTcpSocket) {
          const ctx = client.data as { onClose?: () => void } | undefined
          ctx?.onClose?.()
        },
      },
    })
  }

  stop(): void {
    this.listener?.stop()
    this.listener = null
  }

  private async handleConnection(client: BunTcpSocket): Promise<void> {
    if (this.writeFailed) {
      client.end()
      return
    }
    this.sessionCounter += 1
    const sessionId = `pxy_${this.sessionCounter}`
    const clientAddr = client.remoteAddress ?? 'unknown'
    const target = `${this.o.target.host}:${this.o.target.port}`

    // Buffer early client bytes that arrive before the upstream connection is ready.
    // The data handler is installed immediately (synchronously, before any await) so
    // no bytes are lost even if the client sends data right on open.
    const earlyBuffer: Uint8Array[] = []
    let relay: TcpRelay | null = null
    client.data = {
      onData: (chunk: Uint8Array) => {
        if (relay) {
          relay.fromClient(chunk)
        } else {
          earlyBuffer.push(chunk)
        }
      },
      onClose: () => {
        // Closed before upstream connected; nothing to clean up yet.
        client.end()
      },
    }

    const session = new ProxySession({
      sessionId,
      engine: this.o.engine,
      client: clientAddr,
      target,
      slowMs: this.o.slowMs,
      now: () => performance.now(),
      getBytes: () => ({
        clientBytes: relay?.clientBytes ?? 0,
        serverBytes: relay?.serverBytes ?? 0,
      }),
      // Authoritative fail-loud handler for event-write failures: flips writeFailed
      // (server stops accepting new sessions) and warns. ProxySession.enqueue also
      // defensively catches — belt-and-suspenders so a rejection can't wedge the
      // session's serialized write chain.
      writeEvent: (e) =>
        this.writer.write(e).catch((err) => {
          this.writeFailed = true
          this.o.warn(`event write failed: ${err instanceof Error ? err.message : String(err)}`)
        }),
      warn: this.o.warn,
    })

    let upstream: BunTcpSocket
    try {
      const analyzer = makeAnalyzer(this.o.engine, { emit: (s) => session.onSignal(s) })
      upstream = await Bun.connect({
        hostname: this.o.target.host,
        port: this.o.target.port,
        socket: {
          data(_s: BunTcpSocket, chunk: Uint8Array) {
            relay?.fromUpstream(chunk)
          },
          close() {
            void session.end('upstream_closed').then(() => client.end())
          },
          error() {
            void session.end('error').then(() => client.end())
          },
        },
      })
      relay = new TcpRelay({
        writeToClient: (b) => {
          client.write(b)
        },
        writeToUpstream: (b) => {
          upstream.write(b)
        },
        analyzer,
        onSignal: (s) => session.onSignal(s),
      })

      // Install the live handlers SYNCHRONOUSLY right after relay construction and
      // BEFORE flushing the early buffer. There must be no `await` between relay
      // construction and this assignment, so no data/close event can interleave and
      // run the stale `onClose` (which would leak the upstream socket).
      const liveUpstream = upstream
      client.data = {
        onData: (chunk: Uint8Array) => relay?.fromClient(chunk),
        onClose: () => void session.end('client_closed').then(() => liveUpstream.end()),
      }

      // Flush any bytes that arrived before the upstream connection was ready.
      for (const chunk of earlyBuffer) {
        relay.fromClient(chunk)
      }
      earlyBuffer.length = 0
    } catch (err) {
      this.o.warn(`upstream connect failed: ${err instanceof Error ? err.message : String(err)}`)
      await session.start()
      await session.end('error')
      client.end()
      return
    }

    // session.start() performs the first EventWriter write; if it throws, both
    // sockets must be closed or the relay would forward forever (socket leak).
    try {
      await session.start()
    } catch (err) {
      this.o.warn(`session start failed: ${err instanceof Error ? err.message : String(err)}`)
      client.end()
      upstream.end()
      return
    }
  }
}
