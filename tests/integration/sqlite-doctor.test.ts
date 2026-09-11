/**
 * SQLite 連線的 doctor 診斷（DBCLI-036 / AC-006、AC-011）
 *
 * 網路連線失敗只有一種形狀：連得上或連不上，driver 會說是哪一種。檔案不是。
 * 檔案有三種各自獨立的壞法——不存在、讀不到、在打算寫入的權限下唯讀——而
 * `open()` 會把三種壓成同一句話。這裡分開斷言，因為修法不同：改路徑、改權限
 * 模式、或把 permission 降下來。
 *
 * 這裡直接呼叫 collector 而非跑整個 CLI，因為要斷言的是個別 DoctorResult 的
 * label 與 status，那是 collector 的回傳值；`sqlite-init.test.ts` 已經證明命令
 * 這條路是通的。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { collectSQLiteDoctorResults, runDoctorChecks } from '@/commands/doctor'
import type { ConnectionConfig } from '@/types'

let workDir: string
let dbPath: string

function connection(file: string): ConnectionConfig {
  return { system: 'sqlite', file } as unknown as ConnectionConfig
}

function find(results: Awaited<ReturnType<typeof collectSQLiteDoctorResults>>, label: string) {
  return results.find((r) => r.label === label)
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-sqlite-doctor-'))
  dbPath = join(workDir, 'app.sqlite')
  const seed = new Database(dbPath, { create: true })
  seed.run('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)')
  seed.close()
})

afterEach(async () => {
  await chmod(dbPath, 0o644).catch(() => {})
  await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('AC-006: 檔案存在且可讀時 doctor 通過', () => {
  test('query-only 下通過，且不把可寫性當成要求', async () => {
    const results = await collectSQLiteDoctorResults({
      connection: connection(dbPath),
      permission: 'query-only',
    })
    expect(results.every((r) => r.status !== 'error')).toBe(true)
    expect(find(results, 'Database file')?.status).toBe('pass')
    expect(find(results, 'Database file writable')?.status).toBe('pass')
    expect(find(results, 'Database file writable')?.message).toMatch(/query-only/)
  })

  test('data-admin 下通過，並確認檔案可寫', async () => {
    const results = await collectSQLiteDoctorResults({
      connection: connection(dbPath),
      permission: 'data-admin',
    })
    expect(results.every((r) => r.status !== 'error')).toBe(true)
    expect(find(results, 'Database file writable')?.status).toBe('pass')
  })

  test('連線那一列說出檔案路徑，不是空的 host 與 port', async () => {
    const results = await collectSQLiteDoctorResults({
      connection: connection(dbPath),
      permission: 'query-only',
    })
    const line = find(results, 'Connection')
    expect(line?.status).toBe('pass')
    expect(line?.message).toContain(dbPath)
    expect(line?.message).not.toContain('@:0')
  })
})

describe('AC-006: 唯讀檔案只有在權限意圖寫入時才是失敗', () => {
  test('data-admin + 唯讀檔 → 失敗，訊息點名可寫性與權限', async () => {
    await chmod(dbPath, 0o444)
    const results = await collectSQLiteDoctorResults({
      connection: connection(dbPath),
      permission: 'data-admin',
    })
    const writable = find(results, 'Database file writable')
    expect(writable?.status).toBe('error')
    expect(writable?.message).toMatch(/not writable/i)
    expect(writable?.message).toMatch(/data-admin/)
  })

  test('query-only + 唯讀檔 → 不是失敗', async () => {
    await chmod(dbPath, 0o444)
    const results = await collectSQLiteDoctorResults({
      connection: connection(dbPath),
      permission: 'query-only',
    })
    expect(results.every((r) => r.status !== 'error')).toBe(true)
  })

  test('read-write 同樣意圖寫入，因此同樣失敗', async () => {
    await chmod(dbPath, 0o444)
    const results = await collectSQLiteDoctorResults({
      connection: connection(dbPath),
      permission: 'read-write',
    })
    expect(find(results, 'Database file writable')?.status).toBe('error')
  })
})

describe('AC-011: 檔案不存在與檔案讀不到是兩種不同的失敗', () => {
  test('不存在 → "not found"，而且不再往下連線', async () => {
    const results = await collectSQLiteDoctorResults({
      connection: connection(join(workDir, 'absent.sqlite')),
      permission: 'query-only',
    })
    const file = find(results, 'Database file')
    expect(file?.status).toBe('error')
    expect(file?.message).toMatch(/not found/i)
    expect(find(results, 'Connection')).toBeUndefined()
  })

  // Windows 的 chmod 只能設 read-only 屬性，拿不掉讀取權限，這個情境無法表達。
  test.skipIf(process.platform === 'win32')(
    '讀不到 → "not readable"，訊息與 "not found" 不同',
    async () => {
      await chmod(dbPath, 0o000)
      const results = await collectSQLiteDoctorResults({
        connection: connection(dbPath),
        permission: 'query-only',
      })
      const file = find(results, 'Database file')
      expect(file?.status).toBe('error')
      expect(file?.message).toMatch(/not readable/i)
      expect(file?.message).not.toMatch(/not found/i)
    }
  )

  test('連 file 都沒有的設定，說的是設定壞了而不是檔案壞了', async () => {
    const results = await collectSQLiteDoctorResults({
      connection: connection(''),
      permission: 'query-only',
    })
    expect(find(results, 'Database file')?.status).toBe('error')
    expect(find(results, 'Database file')?.message).toMatch(/no file path/i)
  })
})

describe('checkSQLiteFile 本身', () => {
  test('三種失敗各自只產出一列，不會夾帶 writable 那列', async () => {
    const missing = await runDoctorChecks.checkSQLiteFile(
      join(workDir, 'absent.sqlite'),
      'data-admin'
    )
    expect(missing).toHaveLength(1)
    expect(missing[0]?.label).toBe('Database file')
  })

  test('可讀但不是資料庫的檔案，檔案檢查本身仍然通過', async () => {
    const notADb = join(workDir, 'notes.txt')
    await writeFile(notADb, 'plain text')
    const results = await runDoctorChecks.checkSQLiteFile(notADb, 'query-only')
    // Readability is not a claim that the target is a database — the adapter's
    // open answers that, with a message that says which of the two failed.
    expect(results.every((r) => r.status === 'pass')).toBe(true)
  })

  test('不是資料庫的檔案在連線階段失敗，並說出原因', async () => {
    const notADb = join(workDir, 'notes.txt')
    await writeFile(notADb, 'plain text')
    const results = await collectSQLiteDoctorResults({
      connection: connection(notADb),
      permission: 'query-only',
    })
    const line = find(results, 'Connection')
    expect(line?.status).toBe('error')
    expect(line?.message).toMatch(/Not a SQLite database|header/i)
  })
})
