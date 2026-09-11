/**
 * query-only 在 SQLite 上由開檔模式保證（DBCLI-034 / ADR-0037）
 *
 * 這裡的斷言刻意成對：錯誤必須來自 SQLite，而且檔案必須沒有被寫過。單看其中
 * 一項，一個純客戶端的拒絕也會通過——而那正是 ADR-0037 拒絕的較弱保證。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { SQLiteAdapter } from '@/adapters/sqlite-adapter'
import { ConnectionError, type ConnectionOptions } from '@/adapters/types'

let workDir: string
let dbPath: string

function options(file: string): ConnectionOptions {
  return {
    system: 'sqlite',
    file,
    host: '',
    port: 0,
    user: '',
    password: '',
    database: '',
  } as ConnectionOptions
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-sqlite-ro-'))
  dbPath = join(workDir, 'app.sqlite')
  const seed = new Database(dbPath, { create: true })
  seed.run('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)')
  seed.run("INSERT INTO users (id, email) VALUES (1, 'a@example.com')")
  seed.close()
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('query-only 由引擎拒絕寫入', () => {
  test('UPDATE 被 SQLite 自己拒絕，且檔案 mtime 未變', async () => {
    const before = await stat(dbPath)

    const adapter = new SQLiteAdapter(options(dbPath))
    await adapter.connect()

    let thrown: unknown
    try {
      await adapter.execute("UPDATE users SET email = 'x@example.com'", [], {
        sqlMode: 'native-read-only',
      })
    } catch (error) {
      thrown = error
    } finally {
      await adapter.disconnect()
    }

    expect(thrown).toBeInstanceOf(ConnectionError)
    // 錯誤來自 SQLite 的唯讀通道，不是 dbcli 事先攔下來的。
    expect((thrown as ConnectionError).message).toMatch(/readonly/i)

    const after = await stat(dbPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)

    // 資料本身也沒動。
    const verify = new Database(dbPath, { readonly: true })
    const row = verify.query('SELECT email FROM users WHERE id = 1').get() as { email: string }
    verify.close()
    expect(row.email).toBe('a@example.com')
  })

  test('DELETE 同樣在唯讀通道上失敗', async () => {
    const adapter = new SQLiteAdapter(options(dbPath))
    await adapter.connect()

    let thrown: unknown
    try {
      await adapter.execute('DELETE FROM users', [], { sqlMode: 'native-read-only' })
    } catch (error) {
      thrown = error
    } finally {
      await adapter.disconnect()
    }

    expect(thrown).toBeInstanceOf(ConnectionError)
    expect((thrown as ConnectionError).message).toMatch(/readonly/i)
  })

  test('同一個 adapter 在 normal 模式下寫得進去', async () => {
    const adapter = new SQLiteAdapter(options(dbPath))
    await adapter.connect()
    try {
      const result = await adapter.execute("UPDATE users SET email = 'b@example.com'", [], {
        sqlMode: 'normal',
      })
      expect(result.affectedRows).toBe(1)
    } finally {
      await adapter.disconnect()
    }

    const verify = new Database(dbPath, { readonly: true })
    const row = verify.query('SELECT email FROM users WHERE id = 1').get() as { email: string }
    verify.close()
    expect(row.email).toBe('b@example.com')
  })

  test('讀取在唯讀模式下正常', async () => {
    const adapter = new SQLiteAdapter(options(dbPath))
    await adapter.connect()
    try {
      const result = await adapter.execute<{ email: string }>('SELECT email FROM users', [], {
        sqlMode: 'native-read-only',
      })
      expect(result.rows[0]?.email).toBe('a@example.com')
    } finally {
      await adapter.disconnect()
    }
  })
})

describe('未重放的 WAL', () => {
  /**
   * 這個狀態必須在另一個行程裡製造。乾淨結束的行程會 checkpoint 並移除 WAL，
   * 同一行程裡還開著的連線又會讓 -shm 繼續存在——兩者都會讓唯讀開檔成功。
   * 被 SIGKILL 的子行程留下 -wal，再刪掉可重建的 -shm，唯讀開檔就必須重建它，
   * 而重建是寫入。
   */
  async function leaveUnreplayedWal(file: string): Promise<void> {
    const script = `
      const { Database } = require('bun:sqlite')
      const db = new Database(${JSON.stringify(file)})
      db.run('PRAGMA journal_mode=WAL')
      db.run("INSERT INTO users (id, email) VALUES (2, 'c@example.com')")
      process.kill(process.pid, 'SIGKILL')
    `
    const proc = Bun.spawn(['bun', '-e', script], { stdout: 'ignore', stderr: 'ignore' })
    await proc.exited
    await rm(`${file}-shm`, { force: true })
  }

  // Windows 沒有唯讀目錄的 POSIX 語意（chmod 500 擋不住建檔），也沒有 SIGKILL。
  test.skipIf(process.platform === 'win32')(
    '唯讀開檔失敗時說出 write-ahead log，而不是裸的 SQLITE_CANTOPEN',
    async () => {
      // chmod 對 root 沒有意義，而唯讀目錄正是這個情境的前提。
      if (process.getuid?.() === 0) {
        console.log('⏭ running as root — a read-only directory cannot be expressed; skipping')
        return
      }

      await leaveUnreplayedWal(dbPath)
      expect(await Bun.file(`${dbPath}-wal`).exists()).toBe(true)
      await Bun.$`chmod 500 ${workDir}`.quiet()

      const adapter = new SQLiteAdapter(options(dbPath))
      let thrown: unknown
      try {
        await adapter.connect()
        await adapter.execute('SELECT 1', [], { sqlMode: 'native-read-only' })
      } catch (error) {
        thrown = error
      } finally {
        await adapter.disconnect()
        await Bun.$`chmod 700 ${workDir}`.quiet()
      }

      expect(thrown).toBeInstanceOf(ConnectionError)
      expect((thrown as ConnectionError).message).toMatch(/write-ahead log/i)
    }
  )
})
