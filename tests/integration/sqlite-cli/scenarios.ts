/**
 * SQLite CLI 驗收情境登記表（DBCLI-040）
 *
 * 每一條情境 spawn 真的 CLI，並宣告它證明矩陣裡哪幾個 key。宣告只能指名
 * `ENGINE_CAPABILITIES.sqlite` 已經說支援的 key——對帳在
 * `sqlite-cli-scenarios.test.ts`，這裡只負責「做了什麼、看到什麼」。
 *
 * 每條情境都斷言使用者看得到的結果：讀取比對資料或欄位，寫入回頭讀資料庫
 * 檔，匯出比對輸出內容，連線管理比對設定。只看結束碼是 0、或者沒出現某句
 * 錯誤，在這裡不算證據。
 *
 * `guarded` 標的是情境是否經過 `src/commands/require-sql-connection.ts`。
 * `sqlite-cli-gate-mutation.test.ts` 用它決定哪些情境在閘門被換回舊字面量時
 * 必須失敗、哪些必須照常通過——後者證明故障注入是對準的，不是把一切弄壞。
 */

import { expect } from 'bun:test'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommandCapabilityKey } from '@/adapters/capabilities'
import {
  bindingWritten,
  jsonFromStdout,
  readRows,
  seedBulkRows,
  SEED_USER,
  storageRoot,
  type ScenarioContext,
  type Workspace,
} from './harness'

export interface CliScenario {
  readonly id: string
  readonly proves: readonly CommandCapabilityKey[]
  readonly guarded: boolean
  run(ctx: ScenarioContext): Promise<void>
}

interface QueryEnvelope {
  rows: Record<string, unknown>[]
  rowCount: number
  columnNames: string[]
  metadata?: { limit_applied?: number; securityNotification?: string }
}

interface DoctorResult {
  group: string
  label: string
  status: string
  message: string
}

interface AuditEntry {
  id: string
  engine: string
  command: string
  success: boolean
  redacted_sql?: string
}

const SEED_ROW = { id: SEED_USER.id, email: SEED_USER.email }

async function writeSnippet(ws: Workspace, name: string, sql: string): Promise<void> {
  const dir = join(ws.workDir, '.dbcli', 'queries')
  await mkdir(dir, { recursive: true })
  await Bun.write(
    join(dir, `${name}.sql`),
    ['-- ---', `-- name: ${name}`, '-- engine: sqlite', '-- ---', sql].join('\n')
  )
}

function doctorRows(stdout: string): DoctorResult[] {
  return jsonFromStdout<{ results: DoctorResult[] }>(stdout).results.filter(
    (r) => r.group === 'Connection & Data'
  )
}

export const SQLITE_CLI_SCENARIOS: readonly CliScenario[] = [
  {
    id: 'init writes a v2 connection that names the file',
    proves: ['init'],
    guarded: false,
    async run({ ws, cli, init }) {
      const initialised = await init({ permission: 'query-only' })
      expect(initialised.code).toBe(0)
      expect(await bindingWritten(ws)).toBe(true)

      const listed = await cli(['use', '--list', '--format', 'json'])
      const { connections } = jsonFromStdout<{
        connections: { name: string; system: string; file: string; permission: string }[]
      }>(listed.stdout)
      expect(connections).toEqual([
        expect.objectContaining({
          name: 'local',
          system: 'sqlite',
          file: ws.dbPath,
          permission: 'query-only',
        }),
      ])
    },
  },
  {
    id: 'use switches the default between two SQLite connections',
    proves: ['use'],
    guarded: false,
    async run({ ws, cli, init }) {
      await init({ name: 'local', permission: 'query-only' })
      await init({ name: 'admin', permission: 'data-admin', add: true })

      const toAdmin = await cli(['use', 'admin'])
      expect(toAdmin.code).toBe(0)
      const afterAdmin = jsonFromStdout<{ permission: string }>(
        (await cli(['status', '--format', 'json'])).stdout
      )
      expect(afterAdmin.permission).toBe('data-admin')

      const toLocal = await cli(['use', 'local'])
      expect(toLocal.code).toBe(0)
      const afterLocal = jsonFromStdout<{ permission: string }>(
        (await cli(['status', '--format', 'json'])).stdout
      )
      expect(afterLocal.permission).toBe('query-only')

      const shown = await cli(['use'])
      expect(shown.stdout).toContain(ws.dbPath)
      expect(shown.stdout).not.toContain(':0/')
    },
  },
  {
    id: 'status reports the file and no host or port',
    proves: ['status'],
    guarded: false,
    async run({ ws, cli, init }) {
      await init({ permission: 'read-write' })
      const status = await cli(['status', '--format', 'json'])
      expect(status.code).toBe(0)
      const parsed = jsonFromStdout<Record<string, unknown>>(status.stdout)
      expect(parsed.system).toBe('sqlite')
      expect(parsed.file).toBe(ws.dbPath)
      expect(parsed.permission).toBe('read-write')
      expect(parsed.host).toBeUndefined()
      expect(parsed.port).toBeUndefined()
    },
  },
  {
    id: 'doctor inspects the file and notices when it stops being writable',
    proves: ['doctor'],
    // doctor.ts imports the guard, but its sqlite branch dispatches to
    // collectSQLiteDoctorResults before reaching it.
    guarded: false,
    async run({ ws, cli, init }) {
      await init({ permission: 'data-admin' })
      const healthy = doctorRows((await cli(['doctor', '--format', 'json'])).stdout)
      expect(healthy.find((r) => r.label === 'Database file')?.message).toContain(ws.dbPath)
      expect(healthy.find((r) => r.label === 'Database file writable')?.status).toBe('pass')
      expect(healthy.find((r) => r.label === 'Connection')?.status).toBe('pass')

      await chmod(ws.dbPath, 0o444)
      try {
        const readOnly = doctorRows((await cli(['doctor', '--format', 'json'])).stdout)
        const writable = readOnly.find((r) => r.label === 'Database file writable')
        expect(writable?.status).toBe('error')
        expect(writable?.message).toMatch(/not writable/i)
      } finally {
        await chmod(ws.dbPath, 0o644)
      }
    },
  },
  {
    id: 'list names the seeded table and no sqlite_ internals',
    proves: ['list'],
    guarded: true,
    async run({ cli, init }) {
      await init()
      const list = await cli(['list', '--format', 'json'])
      expect(list.code).toBe(0)
      const tables = jsonFromStdout<{ name: string; columnCount: number }[]>(list.stdout)
      expect(tables.map((t) => t.name)).toEqual(['users'])
      expect(tables[0]?.columnCount).toBe(3)
    },
  },
  {
    id: 'schema reads a single table with its columns and primary key',
    proves: ['schema', 'schemaSingle'],
    guarded: false,
    async run({ cli, init }) {
      await init()
      const schema = await cli(['schema', 'users', '--format', 'json'])
      expect(schema.code).toBe(0)
      const parsed = jsonFromStdout<{
        name: string
        columns: { name: string; type: string; nullable: boolean; primaryKey: boolean }[]
      }>(schema.stdout)
      expect(parsed.name).toBe('users')
      expect(parsed.columns).toEqual([
        { name: 'id', type: 'INTEGER', nullable: true, primaryKey: true },
        { name: 'email', type: 'TEXT', nullable: false, primaryKey: false },
        { name: 'secret', type: 'TEXT', nullable: true, primaryKey: false },
      ])
    },
  },
  {
    id: 'query returns exactly the seeded rows',
    proves: ['query'],
    guarded: true,
    async run({ cli, init }) {
      await init()
      const query = await cli([
        'query',
        'SELECT id, email FROM users ORDER BY id',
        '--format',
        'json',
      ])
      expect(query.code).toBe(0)
      const parsed = jsonFromStdout<QueryEnvelope>(query.stdout)
      expect(parsed.rows).toEqual([SEED_ROW])
      expect(parsed.columnNames).toEqual(['id', 'email'])
    },
  },
  {
    id: 'query renders the same rows as json, csv and table',
    proves: ['queryOutput'],
    guarded: true,
    async run({ cli, init }) {
      await init()
      const sql = 'SELECT id, email FROM users ORDER BY id'

      const json = await cli(['query', sql, '--format', 'json'])
      expect(jsonFromStdout<QueryEnvelope>(json.stdout).rows).toEqual([SEED_ROW])

      const csv = await cli(['query', sql, '--format', 'csv'])
      expect(csv.stdout.split('\n').slice(0, 2)).toEqual(['id,email', '1,a@example.com'])

      const table = await cli(['query', sql, '--format', 'table'])
      expect(table.stdout).toContain('a@example.com')
      expect(table.stdout).toMatch(/Rows: 1/)
    },
  },
  {
    id: 'query-only applies LIMIT 1000 and --no-limit lifts it',
    proves: ['queryLimitGuard'],
    guarded: true,
    async run({ ws, cli, init }) {
      seedBulkRows(ws.dbPath, 1500)
      const total = readRows<{ n: number }>(ws.dbPath, 'SELECT COUNT(*) AS n FROM users')[0]?.n
      expect(total).toBe(1501)
      await init({ permission: 'query-only' })

      const limited = await cli(['query', 'SELECT id FROM users', '--format', 'json'])
      const capped = jsonFromStdout<QueryEnvelope>(limited.stdout)
      expect(capped.rowCount).toBe(1000)
      expect(capped.metadata?.limit_applied).toBe(1000)

      const lifted = await cli(['query', 'SELECT id FROM users', '--format', 'json', '--no-limit'])
      expect(jsonFromStdout<QueryEnvelope>(lifted.stdout).rowCount).toBe(1501)
    },
  },
  {
    id: 'q runs a saved snippet declared for sqlite',
    proves: ['q'],
    guarded: false,
    async run({ ws, cli, init }) {
      await init()
      await writeSnippet(ws, 'all-users', 'SELECT id, email FROM users ORDER BY id')
      const q = await cli(['q', '@all-users', '--format', 'json'])
      expect(q.code).toBe(0)
      expect(q.stderr).not.toMatch(/Unknown engine/)
      expect(jsonFromStdout<QueryEnvelope>(q.stdout).rows).toEqual([SEED_ROW])
    },
  },
  {
    id: 'queries list recognises a snippet tagged engine: sqlite',
    proves: ['queries'],
    guarded: false,
    async run({ ws, cli, init }) {
      await init()
      await writeSnippet(ws, 'all-users', 'SELECT id FROM users')
      const list = await cli(['queries', 'list', '--format', 'json'])
      expect(list.code).toBe(0)
      expect(list.stderr).not.toMatch(/Unknown engine/)
      const snippets = jsonFromStdout<{ name: string; engines: string[] }[]>(list.stdout)
      const mine = snippets.find((s) => s.name === '@all-users')
      expect(mine?.engines).toEqual(['sqlite'])
    },
  },
  {
    id: 'insert adds a row the file then contains',
    proves: ['insert'],
    guarded: true,
    async run({ ws, cli, init }) {
      await init({ permission: 'data-admin' })
      const insert = await cli([
        'insert',
        'users',
        '--data',
        '{"id":2,"email":"b@example.com"}',
        '--force',
      ])
      expect(insert.code).toBe(0)
      expect(readRows(ws.dbPath, 'SELECT id, email FROM users ORDER BY id')).toEqual([
        SEED_ROW,
        { id: 2, email: 'b@example.com' },
      ])
    },
  },
  {
    id: 'update changes only the row the --where names',
    proves: ['update'],
    guarded: true,
    async run({ ws, cli, init }) {
      seedBulkRows(ws.dbPath, 1, 2)
      await init({ permission: 'data-admin' })
      const update = await cli([
        'update',
        'users',
        '--set',
        '{"email":"changed@example.com"}',
        '--where',
        'id = 2',
        '--force',
      ])
      expect(update.code).toBe(0)
      expect(readRows(ws.dbPath, 'SELECT id, email FROM users ORDER BY id')).toEqual([
        SEED_ROW,
        { id: 2, email: 'changed@example.com' },
      ])
    },
  },
  {
    id: 'delete removes exactly the row the --where names',
    proves: ['delete'],
    guarded: true,
    async run({ ws, cli, init }) {
      seedBulkRows(ws.dbPath, 1, 2)
      await init({ permission: 'data-admin' })
      const del = await cli(['delete', 'users', '--where', 'id = 2', '--force'])
      expect(del.code).toBe(0)
      expect(readRows(ws.dbPath, 'SELECT id, email FROM users ORDER BY id')).toEqual([SEED_ROW])
    },
  },
  {
    id: 'export renders json, csv and html and writes a file on request',
    proves: ['export'],
    guarded: true,
    async run({ ws, cli, init }) {
      await init()
      const sql = 'SELECT id, email FROM users ORDER BY id'

      const json = await cli(['export', sql, '--format', 'json'])
      expect(json.code).toBe(0)
      expect(jsonFromStdout<QueryEnvelope>(json.stdout).rows).toEqual([SEED_ROW])

      const csv = await cli(['export', sql, '--format', 'csv'])
      expect(csv.stdout.trim().split('\n')).toEqual(['id,email', '1,a@example.com'])

      const html = await cli(['export', sql, '--format', 'html'])
      const payload = /window\.__DBCLI_PAYLOAD__ = (\{.*?\});/s.exec(html.stdout)
      expect(payload).not.toBeNull()
      expect(JSON.parse(payload![1]!).rows).toEqual([SEED_ROW])

      const out = join(ws.workDir, 'users.csv')
      const written = await cli(['export', sql, '--format', 'csv', '--output', out, '--force'])
      expect(written.code).toBe(0)
      expect((await Bun.file(out).text()).trim().split('\n')).toEqual([
        'id,email',
        '1,a@example.com',
      ])
    },
  },
  {
    id: 'blacklist hides a column from query results',
    proves: ['blacklist'],
    guarded: true,
    async run({ cli, init }) {
      await init()
      const add = await cli(['blacklist', 'column', 'add', 'users.secret'])
      expect(add.code).toBe(0)
      const listed = await cli(['blacklist', 'list'])
      expect(listed.stdout).toMatch(/users=\[secret\]/)

      const query = await cli(['query', 'SELECT id, secret FROM users', '--format', 'json'])
      const parsed = jsonFromStdout<QueryEnvelope>(query.stdout)
      expect(parsed.columnNames).toEqual(['id'])
      expect(parsed.rows).toEqual([{ id: 1 }])
      expect(parsed.metadata?.securityNotification).toMatch(/1 column/)
    },
  },
  {
    id: 'audit records a SQLite query and can show, measure and clear it',
    proves: ['auditTail', 'auditShow', 'auditHealth', 'auditClear'],
    guarded: true,
    async run({ ws, cli, init }) {
      await init({ permission: 'query-only' })
      const query = await cli(['query', 'SELECT id FROM users', '--format', 'json'])
      expect(query.code).toBe(0)

      const tail = await cli(['audit', 'tail', '--n', '1', '--format', 'json', '--no-brief'])
      const entries = jsonFromStdout<AuditEntry[]>(tail.stdout)
      expect(entries).toHaveLength(1)
      const entry = entries[0]!
      expect(entry).toMatchObject({ engine: 'sqlite', command: 'query', success: true })
      expect(entry.redacted_sql).toMatch(/SELECT id FROM users/)

      const show = await cli(['audit', 'show', entry.id, '--format', 'json'])
      expect(jsonFromStdout<AuditEntry>(show.stdout).id).toBe(entry.id)

      const health = await cli(['audit', 'health', '--format', 'json'])
      // health 的計數器是這個程序自己的 writer 的，每個 spawn 都從 0 起算；能
      // 跨程序觀察的是它指的檔案——路徑在私有 HOME 底下、以連線命名、真的有那
      // 一筆 query 在裡面。
      const snapshot = jsonFromStdout<{ enabled: boolean; currentFile: string }>(health.stdout)
      expect(snapshot.enabled).toBe(true)
      expect(snapshot.currentFile.startsWith(storageRoot(ws))).toBe(true)
      expect(snapshot.currentFile.endsWith(join('audit', 'local.jsonl'))).toBe(true)
      const logged = (await Bun.file(snapshot.currentFile).text()).trim().split('\n')
      expect(logged.some((line) => line.includes(entry.id))).toBe(true)

      const clear = await cli(['audit', 'clear', '--yes'])
      expect(clear.code).toBe(0)
      const after = await cli(['audit', 'tail', '--format', 'json'])
      expect(jsonFromStdout<AuditEntry[]>(after.stdout)).toEqual([])
    },
  },
]
