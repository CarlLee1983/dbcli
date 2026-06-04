// src/proxy/analyzers/mysql.ts
import {
  FrameBuffer,
  type AnalyzerDeps,
  type PacketDirection,
  type ProtocolAnalyzer,
} from './types'

const COM_QUERY = 0x03
const COM_STMT_PREPARE = 0x16
const COM_STMT_EXECUTE = 0x17
const HEADER = 4

/**
 * Best-effort MySQL/MariaDB analyzer. Frames packets per direction; never throws
 * fatally — unexpected shapes are skipped or surfaced as a parse_error signal.
 */
export function createMysqlAnalyzer(deps: AnalyzerDeps): ProtocolAnalyzer {
  const clientBuf = new FrameBuffer()
  const serverBuf = new FrameBuffer()
  let awaitingResponse = false

  function handleClientPacket(payloadStart: number, payloadLen: number): void {
    const cmd = clientBuf.byteAt(payloadStart)
    if (cmd === undefined) return
    if (cmd === COM_QUERY) {
      const sql = clientBuf.text(payloadStart + 1, payloadStart + payloadLen)
      deps.emit({ kind: 'query', sql })
      awaitingResponse = true
    } else if (cmd === COM_STMT_PREPARE) {
      // SQL text IS present in the prepare packet; tag it on the query signal.
      const sql = clientBuf.text(payloadStart + 1, payloadStart + payloadLen)
      deps.emit({ kind: 'query', sql, tags: ['prepared_statement'] })
      awaitingResponse = true
    } else if (cmd === COM_STMT_EXECUTE) {
      // No SQL text is available in the execute packet (only bound params), so
      // we emit a tag rather than a query signal.
      deps.emit({ kind: 'tag', tag: 'prepared_statement' })
      awaitingResponse = true
    }
  }

  // Best-effort (v1): awaitingResponse is a single boolean, so pipelined queries
  // can conflate responses, and result-set responses emit parse_partial + query_end
  // on the first server packet rather than tracking column-count -> EOF. The relay
  // forwards bytes regardless; analysis precision is not a correctness requirement.
  function handleServerPacket(payloadStart: number, payloadLen: number): void {
    if (!awaitingResponse) return
    const first = serverBuf.byteAt(payloadStart)
    if (first === undefined) return
    if (first === 0xff) {
      const code = serverBuf.readUInt16LE(payloadStart + 1)
      let msgStart = payloadStart + 3
      if (serverBuf.byteAt(msgStart) === 0x23 /* '#' */) {
        msgStart += 6 // '#' + 5-char sqlstate
      }
      const message = serverBuf.text(msgStart, payloadStart + payloadLen)
      deps.emit({ kind: 'error', code: String(code), message })
      awaitingResponse = false
    } else if (first === 0x00) {
      deps.emit({ kind: 'query_end', rowCount: null })
      awaitingResponse = false
    } else {
      deps.emit({ kind: 'tag', tag: 'parse_partial' })
      deps.emit({ kind: 'query_end', rowCount: null })
      awaitingResponse = false
    }
  }

  function drain(buf: FrameBuffer, onPacket: (start: number, len: number) => void): void {
    while (buf.length >= HEADER) {
      const payloadLen = buf.readUInt24LE(0)
      if (buf.length < HEADER + payloadLen) break
      onPacket(HEADER, payloadLen)
      buf.consume(HEADER + payloadLen)
    }
  }

  return {
    onData(direction: PacketDirection, chunk: Uint8Array): void {
      try {
        if (direction === 'client_to_server') {
          clientBuf.push(chunk)
          drain(clientBuf, handleClientPacket)
        } else {
          serverBuf.push(chunk)
          drain(serverBuf, handleServerPacket)
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
