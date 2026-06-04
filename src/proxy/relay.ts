// src/proxy/relay.ts
import type { AnalyzerSignal, ProtocolAnalyzer } from './analyzers/types'

export interface TcpRelayOptions {
  writeToClient: (bytes: Uint8Array) => void
  writeToUpstream: (bytes: Uint8Array) => void
  analyzer: ProtocolAnalyzer
  onSignal: (signal: AnalyzerSignal) => void
}

/**
 * Relay-first contract: bytes are forwarded BEFORE the analyzer runs, and the
 * analyzer is wrapped so an exception can never interrupt the relay.
 */
export class TcpRelay {
  clientBytes = 0
  serverBytes = 0
  private readonly opts: TcpRelayOptions

  constructor(opts: TcpRelayOptions) {
    this.opts = opts
  }

  fromClient(bytes: Uint8Array): void {
    // Write errors propagate — socket lifecycle is owned by the session/server layer.
    this.opts.writeToUpstream(bytes) // forward first
    this.clientBytes += bytes.length
    this.feed('client_to_server', bytes)
  }

  fromUpstream(bytes: Uint8Array): void {
    // Write errors propagate — socket lifecycle is owned by the session/server layer.
    this.opts.writeToClient(bytes) // forward first
    this.serverBytes += bytes.length
    this.feed('server_to_client', bytes)
  }

  private feed(direction: 'client_to_server' | 'server_to_client', bytes: Uint8Array): void {
    try {
      this.opts.analyzer.onData(direction, bytes)
    } catch (err) {
      this.opts.onSignal({
        kind: 'parse_error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
