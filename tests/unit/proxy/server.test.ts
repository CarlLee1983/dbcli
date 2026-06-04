// tests/unit/proxy/server.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProxyServer } from '@/proxy/server'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

/** Start a trivial echo TCP server, return its port + stop fn. */
function startEchoServer(): { port: number; stop: () => void } {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket: any, data: Uint8Array) {
        socket.write(data) // echo back
      },
    },
  })
  return { port: server.port, stop: () => server.stop() }
}

async function tcpRoundtrip(host: string, port: number, payload: Uint8Array): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    const chunks: number[] = []
    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s: any) {
          s.write(payload)
        },
        data(s: any, d: Uint8Array) {
          chunks.push(...Array.from(d))
          s.end()
          resolve(new Uint8Array(chunks))
        },
        error(_s: any, e: unknown) {
          reject(e)
        },
      },
    })
  })
}

describe('ProxyServer (loopback)', () => {
  it('relays bytes through to upstream and writes lifecycle events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxy-srv-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const eventsPath = join(dir, 'events.jsonl')

    const echo = startEchoServer()
    cleanups.push(() => echo.stop())

    const server = new ProxyServer({
      engine: 'mysql',
      listen: { host: '127.0.0.1', port: 0 },
      target: { host: '127.0.0.1', port: echo.port },
      eventsPath,
      slowMs: 1000,
      redact: 'none',
      warn: () => {},
    })
    await server.start()
    cleanups.push(() => server.stop())

    // Use the public port getter
    const listenPort = server.port!

    const echoed = await tcpRoundtrip('127.0.0.1', listenPort, new Uint8Array([10, 20, 30]))
    expect(Array.from(echoed)).toEqual([10, 20, 30]) // bytes survived the relay unchanged

    // Allow async event writes to flush (client called s.end(), so the close
    // lifecycle should also have been recorded by now).
    await Bun.sleep(100)
    expect(existsSync(eventsPath)).toBe(true)
    const types = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).type as string)
    expect(types).toContain('proxy_started')
    expect(types).toContain('session_started')
    expect(types).toContain('session_ended')
  })
})
