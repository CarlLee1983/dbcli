/**
 * 管線輸入下，請求送得出去就必須留得下 audit。
 *
 * 第五輪對抗式複查的 CRITICAL：`printf 'GET /_cat/indices\n\n' | dbcli shell`
 * 會把請求送到叢集，然後在 audit 寫完之前 `process.exit(0)`。權限與 blacklist
 * 都在送出前同步跑完，所以檢查通過、封包出去，唯一沒發生的是稽核——一個只看
 * 「有沒有被擋下」的測試永遠看不到它。
 *
 * 這個測試釘的是**接線**而不是機制。`createSubmitQueue` 自己的單元測試再完整，
 * 也擋不住有人把 `queue.drain()` 從 `'close'` handler 拿掉，而 bug 本來就在那裡。
 * 所以這裡跑真正的 CLI、真正的管線 stdin、真正的 audit 檔。
 *
 * stub 叢集起在獨立行程：`bun test` 會註冊全域 happy-dom，行程內的 `Bun.serve`
 * 回應到了 child 手上就解不開（#109 是同一個成因）。獨立行程整個繞開它，
 * 而且不需要 Docker，也不碰任何真實資料庫。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STUB_SERVER = `
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url)
    console.log('HIT ' + req.method + ' ' + pathname)
    const body =
      pathname === '/'
        ? { version: { number: '8.13.0' } }
        : [{ index: 'orders', 'docs.count': '1' }]
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    })
  },
})
console.log('PORT ' + server.port)
`

describe('ES shell 管線輸入的 audit', () => {
  let sandbox = ''
  let stub: ReturnType<typeof Bun.spawn> | undefined
  let port = 0

  beforeEach(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-es-shell-pipe-'))
    writeFileSync(join(sandbox, 'stub-cluster.ts'), STUB_SERVER)

    stub = Bun.spawn(['bun', 'run', join(sandbox, 'stub-cluster.ts')], {
      cwd: sandbox,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    port = await readPort(stub.stdout as ReadableStream<Uint8Array>)

    mkdirSync(join(sandbox, '.dbcli'), { recursive: true })
    writeFileSync(
      join(sandbox, '.dbcli', 'config.json'),
      JSON.stringify({
        connection: {
          system: 'elasticsearch',
          protocol: 'http',
          host: 'localhost',
          port,
          user: '',
          password: '',
          database: '',
        },
        permission: 'query-only',
        blacklist: { tables: [], columns: {} },
      })
    )
  })

  afterEach(() => {
    stub?.kill()
    rmSync(sandbox, { recursive: true, force: true })
  })

  /** 讀到 stub 印出的 `PORT <n>` 為止，其餘輸出留給 `hits()`。 */
  let buffered = ''
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  async function readPort(stream: ReadableStream<Uint8Array>): Promise<number> {
    buffered = ''
    reader = stream.getReader()
    const decoder = new TextDecoder()
    while (!/PORT (\d+)/.test(buffered)) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`stub cluster exited before reporting a port: ${buffered}`)
      buffered += decoder.decode(value, { stream: true })
    }
    return Number(/PORT (\d+)/.exec(buffered)![1])
  }

  /** 把 stub 到目前為止收到的請求讀出來。 */
  async function hits(): Promise<string[]> {
    const decoder = new TextDecoder()
    // 把已經到達的 chunk 收乾為止：stub 的每個請求各自成 chunk，只讀一次會
    // 剛好看到 connect 的那一筆，讓測試對真正要驗的那筆假綠。
    for (;;) {
      const next = await Promise.race([
        reader!.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
      ])
      if (!next || next.done || !next.value) break
      buffered += decoder.decode(next.value, { stream: true })
    }
    return buffered
      .split('\n')
      .filter((l) => l.startsWith('HIT '))
      .map((l) => l.slice(4))
  }

  /** 遞迴找，不綁死 audit 目錄相對於 config 的巢狀層數。 */
  function auditRows(dir = sandbox): Record<string, unknown>[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return auditRows(path)
      if (!entry.name.endsWith('.jsonl') || !dir.endsWith('audit')) return []
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    })
  }

  /**
   * 第六輪：第五輪把 `rl.on('line', async ...)` 改成 `queue.enqueue(submit)`，
   * 而 `submit` 是在**任務跑起來時**才讀 `blockLines`。readline 會在同一個
   * tick 把管線的所有行同步發完，所以快照被推遲到微任務之後，中間的行全部
   * 灌進同一個 buffer：兩個命令被合併成一個 block，`parseEsRequest` 拿第二行
   * 當 body 去 parse，兩個命令一個都沒送出，audit 零列，exit code 仍是 0。
   *
   * 上面那個單命令測試對此是綠的——這就是為什麼要有這一個。
   */
  test('管線送兩個命令，兩個都要送出並各自留下 audit', async () => {
    const proc = Bun.spawn(
      ['bun', 'run', join(process.cwd(), 'src/cli.ts'), '--config', '.dbcli', 'shell'],
      {
        cwd: sandbox,
        stdin: new TextEncoder().encode('GET /_cat/indices\n\nGET /orders/_search\n\n'),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )
    await proc.exited
    const stderr = await new Response(proc.stderr).text()

    const seen = await hits()
    expect(seen, stderr).toContain('GET /_cat/indices')
    expect(seen, stderr).toContain('GET /orders/_search')

    // 每個請求一組 attempt / outcome。
    expect(auditRows().length, stderr).toBe(4)
  }, 30_000)

  /** 快照改動最可能傷到的就是多行 block：header 之後的行是 body,不是下一個命令。 */
  test('多行 block 的 body 仍然跟著它的 header 一起送出', async () => {
    const proc = Bun.spawn(
      ['bun', 'run', join(process.cwd(), 'src/cli.ts'), '--config', '.dbcli', 'shell'],
      {
        cwd: sandbox,
        stdin: new TextEncoder().encode(
          'POST /orders/_search\n{"query":{"match_all":{}}}\n\nGET /_cat/indices\n\n'
        ),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )
    await proc.exited
    const stderr = await new Response(proc.stderr).text()

    const seen = await hits()
    expect(seen, stderr).toContain('POST /orders/_search')
    expect(seen, stderr).toContain('GET /_cat/indices')
    expect(stderr).not.toMatch(/JSON Parse error/)
  }, 30_000)

  test('EOF 前送出的請求，其 audit 在行程結束前寫完', async () => {
    const proc = Bun.spawn(
      ['bun', 'run', join(process.cwd(), 'src/cli.ts'), '--config', '.dbcli', 'shell'],
      {
        cwd: sandbox,
        stdin: new TextEncoder().encode('GET /_cat/indices\n\n'),
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )
    await proc.exited
    const stderr = await new Response(proc.stderr).text()

    // 請求真的送出了——否則這個測試斷言的是「什麼都沒發生」，會假綠。
    expect(await hits(), stderr).toContain('GET /_cat/indices')

    const rows = auditRows()
    expect(rows.length, stderr).toBeGreaterThan(0)
  }, 30_000)
})
