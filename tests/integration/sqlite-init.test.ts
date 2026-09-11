/**
 * SQLite 連線的建立與顯示（DBCLI-036 / AC-001、AC-002、AC-008、AC-009）
 *
 * 這裡跑的是真的 CLI 程序，不是被匯出的函式。理由是 DBCLI-034 與 DBCLI-035 都
 * 在函式層通過了測試，卻沒有人發現七個命令各自在入口處用一份寫死的
 * `['postgresql', 'mysql', 'mariadb']` 把 SQLite 擋在外面——能力矩陣說支援，
 * 命令說不支援，而兩張 Story 的測試都問不到那個問題。
 *
 * 安全 fixture 矩陣的四列裡有三列在這裡：`:memory:`、不存在的路徑、
 * `/etc/passwd`。三列都要求「拒絕，而且 config.json 沒有被寫出來」，所以每一條
 * 都同時斷言結束碼與檔案系統。
 *
 * 夾具與 spawn 在 `sqlite-cli/harness.ts`。DBCLI-036 原本放在這個檔案尾端的
 * 「矩陣認領的命令都跑得起來」回歸區塊，已由 DBCLI-040 改成對矩陣逐格對帳的
 * 情境登記表（`sqlite-cli/scenarios.ts`），不再是一份靠人記住的清單。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  bindingWritten,
  createWorkspace,
  destroyWorkspace,
  initSqlite as initWorkspace,
  runCli,
  type Workspace,
} from './sqlite-cli/harness'

let ws: Workspace

const run = (args: string[]) => runCli(ws, args)
const configWritten = () => bindingWritten(ws)
const initSqlite = (
  file: string,
  permission: 'query-only' | 'read-write' | 'data-admin' = 'data-admin'
) => initWorkspace(ws, { file, permission })

beforeEach(async () => {
  ws = await createWorkspace('dbcli-sqlite-init-')
})

afterEach(async () => {
  await destroyWorkspace(ws)
})

describe('dbcli init --system sqlite', () => {
  test('AC-001: 建立出一個 dbcli list 立刻用得起來的連線', async () => {
    const init = await initSqlite(ws.dbPath)
    expect(init.code).toBe(0)
    expect(await configWritten()).toBe(true)

    const list = await run(['list', '--format', 'json'])
    expect(list.code).toBe(0)
    const tables = JSON.parse(
      list.stdout.slice(list.stdout.indexOf('['), list.stdout.lastIndexOf(']') + 1)
    )
    expect(tables.map((t: { name: string }) => t.name)).toContain('users')
  })

  test('AC-001: 沒問 host、port、user、password 或 database', async () => {
    const init = await initSqlite(ws.dbPath)
    const asked = `${init.stdout}${init.stderr}`.toLowerCase()
    for (const field of ['host', 'port', 'password']) {
      expect([field, asked.includes(`${field}:`)]).toEqual([field, false])
    }
  })

  test('AC-002: use 顯示檔案路徑，不顯示 host 或 port', async () => {
    await initSqlite(ws.dbPath)
    const use = await run(['use'])
    expect(use.code).toBe(0)
    expect(use.stdout).toContain(ws.dbPath)
    // `:0/` is what an empty host, port and database render as.
    expect(use.stdout).not.toContain(':0/')
  })

  test('AC-002: status 顯示檔案路徑', async () => {
    await initSqlite(ws.dbPath)
    const status = await run(['status', '--format', 'json'])
    const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')))
    expect(parsed.system).toBe('sqlite')
    expect(parsed.file).toBe(ws.dbPath)
    expect(parsed.host).toBeUndefined()
    expect(parsed.port).toBeUndefined()
  })

  test('AC-003: export 在 json 與 csv 都回得出列', async () => {
    await initSqlite(ws.dbPath)
    const json = await run(['export', 'SELECT id, email FROM users', '--format', 'json'])
    expect(json.code).toBe(0)
    expect(json.stdout).toContain('a@example.com')

    const csv = await run(['export', 'SELECT id, email FROM users', '--format', 'csv'])
    expect(csv.code).toBe(0)
    expect(csv.stdout).toContain('id,email')
    expect(csv.stdout).toContain('a@example.com')
  })

  test('AC-003: q @snippet 讀得到宣告 engine: sqlite 的片段', async () => {
    await initSqlite(ws.dbPath)
    const snippetDir = join(ws.workDir, '.dbcli', 'queries')
    await mkdir(snippetDir, { recursive: true })
    await Bun.write(
      join(snippetDir, 'all-users.sql'),
      [
        '-- ---',
        '-- name: All users',
        '-- description: every user',
        '-- engine: sqlite',
        '-- intent: audit.users',
        '-- ---',
        'SELECT id, email FROM users ORDER BY id',
      ].join('\n')
    )

    const q = await run(['q', '@all-users', '--format', 'json'])
    expect(q.code).toBe(0)
    expect(q.stdout).toContain('a@example.com')
    expect(q.stderr).not.toMatch(/Unknown engine/)
  })
})

describe('security fixture matrix — 每一列都要在寫入之前被拒', () => {
  test('AC-009: :memory: 被拒，理由與 schema 給的相同', async () => {
    const init = await initSqlite(':memory:')
    expect(init.code).not.toBe(0)
    expect(`${init.stdout}${init.stderr}`).toMatch(/in-memory|ADR-0038/)
    expect(await configWritten()).toBe(false)
  })

  test('AC-009: file::memory:?cache=shared 這種寫法也被拒', async () => {
    const init = await initSqlite('file::memory:?cache=shared')
    expect(init.code).not.toBe(0)
    expect(await configWritten()).toBe(false)
  })

  test('AC-008: 不存在的路徑被拒，而且沒有建立出資料庫檔', async () => {
    const missing = join(ws.workDir, 'does-not-exist.sqlite')
    const init = await initSqlite(missing)
    expect(init.code).not.toBe(0)
    expect(await configWritten()).toBe(false)
    expect(await Bun.file(missing).exists()).toBe(false)
  })

  test('可讀但不是資料庫的檔案被拒，訊息說出哪裡不對', async () => {
    const notADatabase = join(ws.workDir, 'notes.txt')
    await Bun.write(notADatabase, 'this is a text file, not a SQLite database\n')
    const init = await initSqlite(notADatabase)
    expect(init.code).not.toBe(0)
    expect(`${init.stdout}${init.stderr}`).toMatch(/Not a SQLite database|header/i)
    expect(await configWritten()).toBe(false)
  })
})

describe('AC-014: 沒有任何命令從旗標或引數收 SQLite 路徑', () => {
  test('query --help 沒有指向資料庫檔的選項', async () => {
    const help = await run(['query', '--help'])
    // `--query-file` reads query *text*; it is not a database path.
    expect(help.stdout).not.toMatch(/--file\b/)
    expect(help.stdout).not.toMatch(/--database-file/)
  })

  test('export --help 沒有指向資料庫檔的選項', async () => {
    const help = await run(['export', '--help'])
    expect(help.stdout).not.toMatch(/--file\b/)
  })
})
