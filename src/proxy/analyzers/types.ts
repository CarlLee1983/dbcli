// src/proxy/analyzers/types.ts

export type PacketDirection = 'client_to_server' | 'server_to_client'

/** High-level signals an analyzer emits; the session turns these into ProxyEvents. */
export type AnalyzerSignal =
  | { kind: 'query'; sql: string; tags?: string[] }
  | { kind: 'query_end'; rowCount?: number | null }
  | { kind: 'error'; code: string | null; message: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'parse_error'; message: string }

export interface AnalyzerDeps {
  emit: (signal: AnalyzerSignal) => void
}

export interface ProtocolAnalyzer {
  onData(direction: PacketDirection, chunk: Uint8Array): void
}

export type AnalyzerFactory = (deps: AnalyzerDeps) => ProtocolAnalyzer

/**
 * Byte accumulator with packet-framing helpers. Defensive by design:
 * callers peek/read before consuming so partial packets stay buffered until complete.
 */
export class FrameBuffer {
  private buf: Uint8Array = new Uint8Array(0)

  get length(): number {
    return this.buf.length
  }

  push(chunk: Uint8Array): void {
    if (this.buf.length === 0) {
      this.buf = chunk.slice()
      return
    }
    const next = new Uint8Array(this.buf.length + chunk.length)
    next.set(this.buf, 0)
    next.set(chunk, this.buf.length)
    this.buf = next
  }

  /** View of the first n bytes (clamped to available length). */
  peek(n: number): Uint8Array {
    return this.buf.subarray(0, Math.min(n, this.buf.length))
  }

  byteAt(offset: number): number | undefined {
    return this.buf[offset]
  }

  consume(n: number): void {
    this.buf = this.buf.subarray(Math.min(n, this.buf.length))
  }

  readUInt24LE(offset: number): number {
    const b0 = this.buf[offset] ?? 0
    const b1 = this.buf[offset + 1] ?? 0
    const b2 = this.buf[offset + 2] ?? 0
    return b0 | (b1 << 8) | (b2 << 16)
  }

  readUInt16LE(offset: number): number {
    const b0 = this.buf[offset] ?? 0
    const b1 = this.buf[offset + 1] ?? 0
    return b0 | (b1 << 8)
  }

  readUInt32BE(offset: number): number {
    const b0 = this.buf[offset] ?? 0
    const b1 = this.buf[offset + 1] ?? 0
    const b2 = this.buf[offset + 2] ?? 0
    const b3 = this.buf[offset + 3] ?? 0
    return (b0 << 24 >>> 0) + (b1 << 16) + (b2 << 8) + b3
  }

  /** UTF-8 decode a slice. */
  text(start: number, end: number): string {
    return new TextDecoder().decode(this.buf.subarray(start, end))
  }
}
