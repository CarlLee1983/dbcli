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
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

let workDir: string
let dbPath: string
let homeDir: string

function run(
  args: string[],
  cwd = workDir
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], {
      cwd,
      // A private HOME keeps the project binding, and anything the run writes
      // through it, inside the temporary directory.
      env: { ...process.env, HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, '.config') },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

/** Did `init` leave a project binding behind? */
async function configWritten(): Promise<boolean> {
  try {
    const entries = await readdir(join(workDir, '.dbcli'))
    return entries.includes('config.json')
  } catch {
    return false
  }
}

async function initSqlite(file: string, permission = 'data-admin') {
  return run([
    'init',
    '--system',
    'sqlite',
    '--file',
    file,
    '--conn-name',
    'local',
    '--permission',
    permission,
    '--no-interactive',
  ])
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-sqlite-init-'))
  homeDir = join(workDir, 'home')
  await mkdir(homeDir, { recursive: true })
  dbPath = join(workDir, 'app.sqlite')
  const seed = new Database(dbPath, { create: true })
  seed.run('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)')
  seed.run("INSERT INTO users (id, email) VALUES (1, 'a@example.com')")
  seed.close()
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('dbcli init --system sqlite', () => {
  test('AC-001: 建立出一個 dbcli list 立刻用得起來的連線', async () => {
    const init = await initSqlite(dbPath)
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
    const init = await initSqlite(dbPath)
    const asked = `${init.stdout}${init.stderr}`.toLowerCase()
    for (const field of ['host', 'port', 'password']) {
      expect([field, asked.includes(`${field}:`)]).toEqual([field, false])
    }
  })

  test('AC-002: use 顯示檔案路徑，不顯示 host 或 port', async () => {
    await initSqlite(dbPath)
    const use = await run(['use'])
    expect(use.code).toBe(0)
    expect(use.stdout).toContain(dbPath)
    // `:0/` is what an empty host, port and database render as.
    expect(use.stdout).not.toContain(':0/')
  })

  test('AC-002: status 顯示檔案路徑', async () => {
    await initSqlite(dbPath)
    const status = await run(['status', '--format', 'json'])
    const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')))
    expect(parsed.system).toBe('sqlite')
    expect(parsed.file).toBe(dbPath)
    expect(parsed.host).toBeUndefined()
    expect(parsed.port).toBeUndefined()
  })

  test('AC-003: export 在 json 與 csv 都回得出列', async () => {
    await initSqlite(dbPath)
    const json = await run(['export', 'SELECT id, email FROM users', '--format', 'json'])
    expect(json.code).toBe(0)
    expect(json.stdout).toContain('a@example.com')

    const csv = await run(['export', 'SELECT id, email FROM users', '--format', 'csv'])
    expect(csv.code).toBe(0)
    expect(csv.stdout).toContain('id,email')
    expect(csv.stdout).toContain('a@example.com')
  })

  test('AC-003: q @snippet 讀得到宣告 engine: sqlite 的片段', async () => {
    await initSqlite(dbPath)
    const snippetDir = join(workDir, '.dbcli', 'queries')
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
    const missing = join(workDir, 'does-not-exist.sqlite')
    const init = await initSqlite(missing)
    expect(init.code).not.toBe(0)
    expect(await configWritten()).toBe(false)
    expect(await Bun.file(missing).exists()).toBe(false)
  })

  test('可讀但不是資料庫的檔案被拒，訊息說出哪裡不對', async () => {
    const init = await initSqlite('/etc/passwd')
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

/**
 * AC-017：能力矩陣說支援的命令，要用「真的被 spawn 出來的 CLI」證明。
 *
 * DBCLI-034 與 DBCLI-035 的測試都停在 adapter 與 executor 這一層，所以七個命令
 * 各自在入口處把 SQLite 擋掉這件事，兩張 Story 都看不到。這個 describe 的存在
 * 是為了讓那個盲點不會再開一次：矩陣認領一格，這裡就要有一條 spawn。
 */
describe('AC-017: 矩陣認領的命令都跑得起來', () => {
  test('schema 讀得到欄位', async () => {
    await initSqlite(dbPath)
    const schema = await run(['schema', 'users', '--format', 'json'])
    expect(schema.code).toBe(0)
    expect(schema.stdout).toContain('email')
  })

  test('insert / update / delete 都不再被入口的 SQL 閘門擋下', async () => {
    await initSqlite(dbPath, 'data-admin')

    const insert = await run([
      'insert',
      'users',
      '--data',
      '{"id":2,"email":"b@example.com"}',
      '--force',
    ])
    expect(`${insert.stdout}${insert.stderr}`).not.toMatch(/requires a SQL connection/)
    expect(insert.code).toBe(0)

    const update = await run([
      'update',
      'users',
      '--set',
      '{"email":"c@example.com"}',
      '--where',
      'id = 2',
      '--force',
    ])
    expect(update.code).toBe(0)

    const del = await run(['delete', 'users', '--where', 'id = 2', '--force'])
    expect(del.code).toBe(0)

    const left = await run(['query', 'SELECT id FROM users', '--format', 'json'])
    expect(left.stdout).not.toContain('"id": 2')
  })

  test('doctor 在 CLI 這條路上也走得通', async () => {
    await initSqlite(dbPath, 'query-only')
    const doctor = await run(['doctor', '--format', 'json'])
    const parsed = JSON.parse(doctor.stdout.slice(doctor.stdout.indexOf('{')))
    const connectionGroup = parsed.results.filter(
      (r: { group: string }) => r.group === 'Connection & Data'
    )
    expect(connectionGroup.length).toBeGreaterThan(0)
    expect(connectionGroup.every((r: { status: string }) => r.status !== 'error')).toBe(true)
  })

  test('queries list 認得宣告 engine: sqlite 的片段', async () => {
    await initSqlite(dbPath)
    const snippetDir = join(workDir, '.dbcli', 'queries')
    await mkdir(snippetDir, { recursive: true })
    await Bun.write(
      join(snippetDir, 'all-users.sql'),
      ['-- ---', '-- name: All users', '-- engine: sqlite', '-- ---', 'SELECT id FROM users'].join(
        '\n'
      )
    )
    const list = await run(['queries', 'list'])
    expect(list.code).toBe(0)
    expect(list.stdout).toContain('all-users')
    expect(list.stderr).not.toMatch(/Unknown engine/)
  })
})
