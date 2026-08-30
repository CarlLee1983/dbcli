/**
 * 加一條 blacklist 不得改動任何連線的 permission tier。
 *
 * 第八輪 CRITICAL：`blacklist add/remove` 走 `configModule.read()` →
 * `configModule.write()`。前者對 v2 設定回傳的是「選中那一條連線」的扁平化
 * v1 形狀，後者以 v1 schema 驗證後**整包覆寫**——於是加一條 blacklist 會把
 * 多連線設定壓成單一連線：`connections`、`default`、`envFile`、`environment`
 * 全部消失，而預設 permission 變成當時 `--use` 的那一條連線的值。
 *
 * 具體後果：`dbcli --use esadm blacklist add secrets` 之後，一句不帶 `--use`
 * 的 `dbcli shell` 會以 `admin` 執行，而原本的預設連線是 `query-only`。
 * ES shell 的 tier gate 就是讀那個值。而且整個過程走
 * `writeConfigWithIntegrity`，完整性紀錄同步更新，事後沒有 tamper 訊號。
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function run(
  args: string[],
  workDir: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    // `--config` 放在子指令之後：blacklist 的每個子指令自己宣告了一個帶預設值
    // 的 `--config`，所以根層的那個永遠不生效（見同檔的「根層 --config」測試）。
    const child = spawn('bun', ['run', CLI, ...args, '--config', resolve(workDir)], {
      cwd: workDir,
      env: { ...process.env, NODE_ENV: 'test', DBCLI_NO_UPDATE_CHECK: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

const V2_CONFIG = {
  version: 2,
  default: 'es',
  connections: {
    es: {
      system: 'elasticsearch',
      host: 'localhost',
      port: 9200,
      user: 'elastic',
      password: 'pw',
      database: 'orders',
      permission: 'query-only',
    },
    esadm: {
      system: 'elasticsearch',
      host: 'localhost',
      port: 9200,
      user: 'elastic',
      password: 'pw',
      database: 'orders',
      permission: 'admin',
    },
  },
  schema: {},
  schemas: {},
  metadata: { version: '1.0', createdAt: '2026-08-30T00:00:00.000Z' },
  blacklist: { tables: [], columns: {} },
  audit: { enabled: true, strict: false, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
}

describe('blacklist 指令不得破壞 v2 設定', () => {
  let work = ''
  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true })
    work = ''
  })

  async function seed(): Promise<string> {
    work = await mkdtemp(join(tmpdir(), 'dbcli-blacklist-v2-'))
    await mkdir(work, { recursive: true })
    await writeFile(join(work, 'config.json'), JSON.stringify(V2_CONFIG, null, 2))
    return work
  }

  test('加一條 blacklist 之後，連線與各自的 permission 都還在', async () => {
    const dir = await seed()
    // 不用 `--use`：那個旗標讀的是全域註冊表而非 `--config` 指的專案設定，
    // 會讓測試依賴機器上的既有連線。缺陷本體是寫入路徑把 v2 壓成 v1，
    // 用預設連線就重現得出來。
    const added = await run(['blacklist', 'table', 'add', 'secrets'], dir)
    expect(added.code, `${added.stderr}\n${added.stdout}`).toBe(0)

    const after = await Bun.file(join(dir, 'config.json')).json()
    expect(after.version).toBe(2)
    expect(Object.keys(after.connections ?? {}).sort()).toEqual(['es', 'esadm'])
    expect(after.connections.es.permission).toBe('query-only')
    expect(after.connections.esadm.permission).toBe('admin')
    expect(after.default).toBe('es')
    expect(after.blacklist.tables).toContain('secrets')
    // 這個鍵不該被寫回檔案——它是讀取時的解析產物。
    expect(after.effectiveConnectionName).toBeUndefined()
  }, 60_000)

  test('移除一條 blacklist 同樣保留形狀', async () => {
    const dir = await seed()
    await run(['blacklist', 'table', 'add', 'secrets'], dir)
    const removed = await run(['blacklist', 'table', 'remove', 'secrets'], dir)
    expect(removed.code, removed.stderr).toBe(0)

    const after = await Bun.file(join(dir, 'config.json')).json()
    expect(after.version).toBe(2)
    expect(Object.keys(after.connections ?? {}).sort()).toEqual(['es', 'esadm'])
    expect(after.blacklist.tables).not.toContain('secrets')
  }, 60_000)

  test('欄位黑名單也走同一條路', async () => {
    const dir = await seed()
    const added = await run(['blacklist', 'column', 'add', 'users.password'], dir)
    expect(added.code, `${added.stderr}\n${added.stdout}`).toBe(0)

    const after = await Bun.file(join(dir, 'config.json')).json()
    expect(after.version).toBe(2)
    expect(after.connections.es.permission).toBe('query-only')
    expect(after.blacklist.columns.users).toContain('password')
  }, 60_000)
})

/**
 * 根層的 `--config` 對 blacklist 指令必須生效。
 *
 * 每個子指令原本自己宣告了一個**帶預設值**的 `--config`，於是 commander 永遠
 * 給得出一個值，根層的那個完全不生效——`dbcli --config /path blacklist table
 * add x` 會改到 `.dbcli` 而不是 `/path`，並且回報成功。一個寫錯對象卻宣稱成功
 * 的設定指令比失敗更糟：使用者會相信保護已經生效。
 *
 * 這一則是複查途中被自己咬到才發現的——我以為在沙箱裡跑，實際改的是本機真實
 * 的專案設定。
 */
describe('根層 --config 對 blacklist 指令生效', () => {
  let work = ''
  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true })
    work = ''
  })

  test('旗標放在子指令之前也寫到指定的設定', async () => {
    work = await mkdtemp(join(tmpdir(), 'dbcli-blacklist-rootcfg-'))
    await writeFile(join(work, 'config.json'), JSON.stringify(V2_CONFIG, null, 2))

    const child = Bun.spawn(
      ['bun', 'run', CLI, '--config', resolve(work), 'blacklist', 'table', 'add', 'secrets'],
      { cwd: work, stdout: 'pipe', stderr: 'pipe' }
    )
    await child.exited
    const stderr = await new Response(child.stderr).text()

    const after = await Bun.file(join(work, 'config.json')).json()
    expect(after.blacklist.tables, stderr).toContain('secrets')
  }, 60_000)
})
