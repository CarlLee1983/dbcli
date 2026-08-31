import { test, expect, mock } from 'bun:test'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'

test('runShell dispatches an Elasticsearch connection to runEsShell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbcli-es-'))
  const cfg = join(dir, '.dbcli')
  writeFileSync(
    cfg,
    JSON.stringify({
      connection: { system: 'elasticsearch', host: 'localhost', port: 9200, database: 'es' },
      permission: 'query-only',
    })
  )
  let called = ''
  mock.module('@/commands/es-shell', () => ({
    runEsShell: async (p: string) => {
      called = p
    },
  }))
  const { runShell } = await import('@/commands/shell')
  await runShell({}, cfg)
  expect(called).toBe(cfg)
})

// 上面那個測試把 `runEsShell` 整個換掉，所以它證明的只有「路由到了這個模組」。
// 規格 176-183 指名要防的失敗形狀是另一件事：enforcement 在 runner 裡寫對、
// 但設定值沒被送進去——那時 runner 的每一個測試都還是綠的。
//
// 因此這裡不 mock 任何東西，改成把整個 CLI 當黑箱跑：一個假的 ES 端點記下它
// 實際收到什麼，config 寫 `permission: query-only`，用管線餵一個寫入請求進去。
// 「有沒有送到叢集」在這個 seam 上是可以直接觀察的，不必問任何內部函式。
test('a query-only config refuses a write in the ES shell, and the cluster receives nothing', async () => {
  // 用 `node:http` 而不是 `Bun.serve`：preload 的 happy-dom 換掉了全域 `Response`，
  // 拿它建出來的物件餵給 `Bun.serve` 會送出空 body，subprocess 收到的是
  // 「連得上但解不出 JSON」——那是測試的假象，不是受測行為。
  const received: string[] = []
  const server = createServer((req, res) => {
    // adapter.connect() 打 `GET /`，那是握手不是請求。
    if (req.url !== '/') received.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ version: { number: '8.0.0' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  try {
    const dir = mkdtempSync(join(tmpdir(), 'dbcli-es-wire-'))
    const cfg = join(dir, '.dbcli')
    writeFileSync(
      cfg,
      JSON.stringify({
        connection: {
          system: 'elasticsearch',
          protocol: 'http',
          host: '127.0.0.1',
          port,
          database: 'es',
        },
        permission: 'query-only',
      })
    )

    const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', '--config', cfg, 'shell'], {
      stdin: new TextEncoder().encode('DELETE /orders\n\n'),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(received).toEqual([])
    expect(stderr).toContain('admin')
    expect(exitCode).toBe(1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 30_000)
