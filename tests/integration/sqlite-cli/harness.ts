/**
 * SQLite CLI 情境共用的夾具（DBCLI-040）
 *
 * 一個 spawn、一個種子資料庫、一個私有 HOME。`sqlite-init.test.ts` 與情境登記
 * 表都從這裡拿，夾具因此只存在一份。
 *
 * 這裡的 `runCli` 走的是 `bun run src/cli.ts`——repository 自己的開發啟動方式，
 * 經過 Commander 的參數解析與命令註冊。直接呼叫 handler、adapter 或 executor
 * 正是 PR #194 那個缺陷能通過測試的原因，所以這裡不提供那條路。
 *
 * `HOME` 與 `XDG_CONFIG_HOME` 都指進暫存目錄：dbcli 的專案綁定、v2 設定、
 * schema 快取與 audit 記錄全部落在 `<homeDir>/.config/dbcli/` 底下，開發者真實
 * 的設定目錄不會被碰到（AC-007）。
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

export const CLI = resolve(import.meta.dir, '../../../src/cli.ts')

export interface Workspace {
  /** 專案目錄；`.dbcli/` 綁定寫在這裡。 */
  readonly workDir: string
  /** 私有 HOME；dbcli 的實際儲存落在 `<homeDir>/.config/dbcli/`。 */
  readonly homeDir: string
  /** 種子資料庫。 */
  readonly dbPath: string
}

export interface CliResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export interface RunOptions {
  /** 傳給 `bun run --preload` 的模組；只影響被 spawn 出來的程序。 */
  readonly preload?: string
  readonly cwd?: string
}

/** 種子資料：一列，讓讀取情境有東西可以精確比對。 */
export const SEED_USER = Object.freeze({ id: 1, email: 'a@example.com', secret: 's-1' })
export const SEED_USERS = Object.freeze([SEED_USER])

export async function createWorkspace(prefix = 'dbcli-sqlite-cli-'): Promise<Workspace> {
  const workDir = await mkdtemp(join(tmpdir(), prefix))
  const homeDir = join(workDir, 'home')
  await mkdir(homeDir, { recursive: true })
  const dbPath = join(workDir, 'app.sqlite')
  const seed = new Database(dbPath, { create: true })
  seed.run('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, secret TEXT)')
  for (const row of SEED_USERS) {
    seed.run('INSERT INTO users (id, email, secret) VALUES (?, ?, ?)', [
      row.id,
      row.email,
      row.secret,
    ])
  }
  closeReleasingFile(seed)
  return { workDir, homeDir, dbPath }
}

/**
 * `Database.close()` 是 `sqlite3_close_v2`：還有沒 finalize 的 statement 時，
 * 連線會變成 zombie、檔案 handle 留著，Windows 上接下來的 `rm` 就是 EBUSY——
 * 第一次 CI 就是這樣倒的。`close(true)` 改呼叫 `sqlite3_close`，有殘留就丟錯，
 * 讓漏掉 finalize 的地方在所有平台上一樣大聲。
 */
function closeReleasingFile(db: Database): void {
  db.close(true)
}

export async function destroyWorkspace(ws: Workspace): Promise<void> {
  // Windows 在子程序結束後釋放目錄 handle 有一小段延遲；重試是 node:fs 自己
  // 為這種情況提供的選項，不是吞掉錯誤——用完重試次數仍然會丟。
  await rm(ws.workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

export function runCli(
  ws: Workspace,
  args: string[],
  options: RunOptions = {}
): Promise<CliResult> {
  const bunArgs = options.preload
    ? ['run', '--preload', options.preload, CLI, ...args]
    : ['run', CLI, ...args]
  return new Promise((res) => {
    const child = spawn('bun', bunArgs, {
      cwd: options.cwd ?? ws.workDir,
      env: {
        ...process.env,
        HOME: ws.homeDir,
        XDG_CONFIG_HOME: join(ws.homeDir, '.config'),
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

export interface InitOptions {
  readonly permission?: 'query-only' | 'read-write' | 'data-admin'
  readonly name?: string
  /** 在既有的 v2 設定上再加一條連線。 */
  readonly add?: boolean
  readonly file?: string
}

export function initSqlite(
  ws: Workspace,
  options: InitOptions = {},
  runOptions: RunOptions = {}
): Promise<CliResult> {
  return runCli(
    ws,
    [
      'init',
      '--system',
      'sqlite',
      '--file',
      options.file ?? ws.dbPath,
      '--conn-name',
      options.name ?? 'local',
      '--permission',
      options.permission ?? 'data-admin',
      '--no-interactive',
      ...(options.add ? ['--force'] : []),
    ],
    runOptions
  )
}

/**
 * 情境拿到的是「跑 CLI」這個動作，而不是 `runCli` 這個綁定。閘門突變測試因此
 * 能把同一條情境換到帶 `--preload` 的 runner 上跑，不必碰任何模組。
 */
export interface ScenarioContext {
  readonly ws: Workspace
  cli(args: string[]): Promise<CliResult>
  init(options?: InitOptions): Promise<CliResult>
}

export function createContext(ws: Workspace, runOptions: RunOptions = {}): ScenarioContext {
  return {
    ws,
    cli: (args) => runCli(ws, args, runOptions),
    init: (options = {}) => initSqlite(ws, options, runOptions),
  }
}

/**
 * 直接讀資料庫檔，驗證寫入情境留下的實際狀態。唯讀開啟，所以這條路不可能
 * 反過來製造出它要驗證的狀態。
 */
export function readRows<T = Record<string, unknown>>(dbPath: string, sql: string): T[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    const statement = db.prepare(sql)
    try {
      return statement.all() as T[]
    } finally {
      statement.finalize()
    }
  } finally {
    closeReleasingFile(db)
  }
}

/** 往種子資料庫追加大量列，給 LIMIT 守衛之類需要超過門檻的情境用。 */
export function seedBulkRows(dbPath: string, count: number, startId = 1000): void {
  // 不用 `db.transaction()`：Bun 1.3.3 的包裝會留下一份它自己的 statement，
  // `close(true)` 因此回報 database is locked。BEGIN / COMMIT 走 `run()`，用完
  // 即 finalize。
  const db = new Database(dbPath)
  const insert = db.prepare('INSERT INTO users (id, email, secret) VALUES (?, ?, ?)')
  try {
    db.run('BEGIN')
    for (let i = 0; i < count; i++) insert.run(startId + i, `bulk${i}@example.com`, null)
    db.run('COMMIT')
  } finally {
    insert.finalize()
    closeReleasingFile(db)
  }
}

/** 從混有人類訊息的 stdout 裡取出第一個 JSON 文件。 */
export function jsonFromStdout<T = unknown>(stdout: string): T {
  const objectAt = stdout.indexOf('{')
  const arrayAt = stdout.indexOf('[')
  const candidates = [objectAt, arrayAt].filter((i) => i >= 0)
  if (candidates.length === 0) throw new Error(`stdout carries no JSON:\n${stdout}`)
  const start = Math.min(...candidates)
  const close = stdout[start] === '{' ? '}' : ']'
  const end = stdout.lastIndexOf(close)
  return JSON.parse(stdout.slice(start, end + 1)) as T
}

/** 專案綁定 `.dbcli/config.json` 存在與否——`init` 的第一個可觀察結果。 */
export async function bindingWritten(ws: Workspace): Promise<boolean> {
  return Bun.file(join(ws.workDir, '.dbcli', 'config.json')).exists()
}

/** dbcli 實際儲存設定與 audit 的目錄，全部在私有 HOME 底下。 */
export function storageRoot(ws: Workspace): string {
  return join(ws.homeDir, '.config', 'dbcli')
}
