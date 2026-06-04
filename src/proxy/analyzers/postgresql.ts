// src/proxy/analyzers/postgresql.ts
import {
  FrameBuffer,
  type AnalyzerDeps,
  type PacketDirection,
  type ProtocolAnalyzer,
} from './types'

/** Parse "SELECT 3" / "INSERT 0 5" command tags to a best-effort row count. */
function rowCountFromTag(tag: string): number | null {
  const parts = tag.trim().split(/\s+/)
  const last = parts[parts.length - 1]
  if (last === undefined) return null
  const n = Number(last)
  return Number.isInteger(n) ? n : null
}

export function createPostgresAnalyzer(deps: AnalyzerDeps): ProtocolAnalyzer {
  const clientBuf = new FrameBuffer()
  const serverBuf = new FrameBuffer()
  let startupSeen = false
  let awaitingResponse = false

  function readCString(buf: FrameBuffer, start: number, end: number): string {
    let i = start
    while (i < end && buf.byteAt(i) !== 0) i++
    return buf.text(start, i)
  }

  function handleClientMessage(type: number, bodyStart: number, bodyEnd: number): void {
    const t = String.fromCharCode(type)
    if (t === 'Q') {
      const sql = readCString(clientBuf, bodyStart, bodyEnd)
      deps.emit({ kind: 'query', sql })
      awaitingResponse = true
    } else if (t === 'P' || t === 'B' || t === 'E' || t === 'S' || t === 'D') {
      deps.emit({ kind: 'tag', tag: 'extended_protocol' })
      if (t === 'P') {
        const nameEnd = bodyStart + readCString(clientBuf, bodyStart, bodyEnd).length + 1
        const sql = readCString(clientBuf, nameEnd, bodyEnd)
        if (sql) deps.emit({ kind: 'query', sql, tags: ['extended_protocol'] })
        awaitingResponse = true
      }
    }
  }

  function handleServerMessage(type: number, bodyStart: number, bodyEnd: number): void {
    const t = String.fromCharCode(type)
    if (t === 'E') {
      let code: string | null = null
      let message = ''
      let i = bodyStart
      while (i < bodyEnd) {
        const fieldType = serverBuf.byteAt(i)
        if (fieldType === undefined || fieldType === 0) break
        i += 1
        const value = readCString(serverBuf, i, bodyEnd)
        i += value.length + 1
        if (fieldType === 0x43 /* 'C' */) code = value
        else if (fieldType === 0x4d /* 'M' */) message = value
      }
      deps.emit({ kind: 'error', code, message })
      awaitingResponse = false
    } else if (t === 'C') {
      const tag = readCString(serverBuf, bodyStart, bodyEnd)
      deps.emit({ kind: 'query_end', rowCount: rowCountFromTag(tag) })
      awaitingResponse = false
    }
  }

  function drain(
    buf: FrameBuffer,
    isClient: boolean,
    onMessage: (type: number, bodyStart: number, bodyEnd: number) => void
  ): void {
    if (isClient && !startupSeen) {
      if (buf.length < 4) return
      const len = buf.readUInt32BE(0)
      // A real startup packet's length must fit within the buffer and be >= 4.
      // If the length field is implausible (> buffer length or > 10000), the
      // first byte is likely a message-type byte, not a length MSB — treat
      // startup as already seen and fall through to typed-message processing.
      if (len >= 4 && len <= buf.length && len <= 10000) {
        startupSeen = true
        buf.consume(len)
      } else {
        startupSeen = true
      }
    }
    while (buf.length >= 5) {
      const type = buf.byteAt(0)!
      const len = buf.readUInt32BE(1)
      const total = 1 + len
      if (buf.length < total) break
      onMessage(type, 5, total)
      buf.consume(total)
    }
  }

  return {
    onData(direction: PacketDirection, chunk: Uint8Array): void {
      try {
        if (direction === 'client_to_server') {
          clientBuf.push(chunk)
          drain(clientBuf, true, handleClientMessage)
        } else {
          serverBuf.push(chunk)
          drain(serverBuf, false, handleServerMessage)
        }
      } catch (err) {
        deps.emit({
          kind: 'parse_error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }
}
