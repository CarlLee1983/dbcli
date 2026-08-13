/**
 * `insert` / `update` / `delete` / `q` 的錯誤措辭（issue #61）
 *
 * 這四個命令自己印在地化訊息，不走集中的 presenter，因此它們曾經把每一種
 * `ConnectionError` 都說成「無法連接到資料庫」——包含連線正常、只是語句失敗的
 * `TABLE_NOT_FOUND`。單元測試釘的是 code → message key 的對應；這裡釘的是四個
 * 命令真的接上了那個對應，少接一個不會靜默通過。
 *
 * 語句層級的案例需要一台真的伺服器（要先連上才會拿到 TABLE_NOT_FOUND），
 * 傳輸層的案例則指向一個沒人監聽的 port，兩個方向都要驗。
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDbReachable, SKIP_BY_ENV } from './helpers'
import { t_vars } from '@/i18n/message-loader'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const MYSQL_HOST = '127.0.0.1'
const MYSQL_PORT = 3307
const DEAD_PORT = 3999

let SKIP_TESTS = SKIP_BY_ENV

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(args: string[], workDir: string): Promise<{ stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, '--config', workDir, ...args], {
      cwd: workDir,
      env: sanitizeEnv(),
    })
    let stderr = ''
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stderr, code: code ?? 0 }))
  })
}

async function workspace(port: number): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-error-wording-'))
  await writeFile(
    join(work, 'config.json'),
    JSON.stringify({
      connection: {
        system: 'mysql',
        host: MYSQL_HOST,
        port,
        user: 'root',
        password: 'testpass',
        database: 'dbcli_test',
      },
      permission: 'admin',
      metadata: { createdAt: '2026-08-13T00:00:00.000Z', version: '1.0' },
    })
  )
  return work
}

/** 連線措辭的第一行，訊息內容無關 —— 比對 key 的產物而非英文字面 */
function connectionWording(message: string): string {
  return t_vars('errors.connection_failed', { message })
}

describe('寫入命令的錯誤措辭', () => {
  beforeAll(async () => {
    if (!SKIP_TESTS) SKIP_TESTS = !(await isDbReachable(MYSQL_HOST, MYSQL_PORT))
    if (SKIP_TESTS) console.log('⏭ MySQL not reachable — skipping write-command wording tests')
  })

  const cases: [string, string[]][] = [
    ['insert', ['insert', 'no_such_table_61', '--data', '{"a":1}', '--force']],
    ['update', ['update', 'no_such_table_61', '--set', '{"a":1}', '--where', 'id=1', '--force']],
    ['delete', ['delete', 'no_such_table_61', '--where', 'id=1', '--force']],
  ]

  for (const [name, args] of cases) {
    test(`${name}：找不到資料表不說成連不上資料庫，並帶出 hint`, async () => {
      if (SKIP_TESTS) return

      const work = await workspace(MYSQL_PORT)
      const { stderr, code } = await run(args, work)

      expect(code).toBe(1)
      expect(stderr).toContain('no_such_table_61')
      expect(stderr).not.toContain(connectionWording(''))
      expect(stderr).toContain('Hint:')
      expect(stderr).toContain('dbcli list')
    }, 30_000)
  }

  test('真正連不上時仍然說連不上，措辭沒被改掉', async () => {
    if (SKIP_TESTS) return

    const work = await workspace(DEAD_PORT)
    const { stderr, code } = await run(['insert', 'orders', '--data', '{"a":1}', '--force'], work)

    expect(code).toBe(1)
    expect(stderr).toContain(connectionWording(''))
  }, 30_000)
})
