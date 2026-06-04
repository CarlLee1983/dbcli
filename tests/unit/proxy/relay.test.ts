// tests/unit/proxy/relay.test.ts
import { describe, it, expect } from 'bun:test'
import { TcpRelay } from '@/proxy/relay'
import type { AnalyzerSignal } from '@/proxy/analyzers/types'

function setup(opts?: { throwOnAnalyze?: boolean }) {
  const toClient: Uint8Array[] = []
  const toUpstream: Uint8Array[] = []
  const signals: AnalyzerSignal[] = []
  const relay = new TcpRelay({
    writeToClient: (b) => toClient.push(b),
    writeToUpstream: (b) => toUpstream.push(b),
    analyzer: {
      onData: () => {
        if (opts?.throwOnAnalyze) throw new Error('boom')
      },
    },
    onSignal: (s) => signals.push(s),
  })
  return { relay, toClient, toUpstream, signals }
}

describe('TcpRelay', () => {
  it('forwards client bytes to upstream unchanged and counts them', () => {
    const { relay, toUpstream } = setup()
    relay.fromClient(new Uint8Array([1, 2, 3]))
    expect(Array.from(toUpstream[0]!)).toEqual([1, 2, 3])
    expect(relay.clientBytes).toBe(3)
  })

  it('forwards upstream bytes to client unchanged and counts them', () => {
    const { relay, toClient } = setup()
    relay.fromUpstream(new Uint8Array([9, 8]))
    expect(Array.from(toClient[0]!)).toEqual([9, 8])
    expect(relay.serverBytes).toBe(2)
  })

  it('keeps relaying even when the analyzer throws (emits parse_error)', () => {
    const { relay, toUpstream, signals } = setup({ throwOnAnalyze: true })
    relay.fromClient(new Uint8Array([1]))
    expect(Array.from(toUpstream[0]!)).toEqual([1]) // forwarded despite throw
    expect(signals.some((s) => s.kind === 'parse_error')).toBe(true)
  })
})
