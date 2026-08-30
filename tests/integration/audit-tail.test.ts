/**
 * `dbcli audit tail` — integration tests (Phase 24 / Plan 24-03 Task 3)
 *
 * Spawns the CLI against synthetic .dbcli/audit/<conn>.jsonl fixtures.
 * No mocks; real reader, real commander surface, real i18n strings.
 *
 * Covers D-39 (envelope), D-40 (flat), D-41 (rotation merge), D-42 (tie-break),
 * E (disabled / empty), L (cap warning), and --for-agent / --no-brief.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

/**
 * Minimal valid DbcliConfig — schema requires connection / permission / metadata.
 * blacklist + audit have zod defaults so are omitted; per-test overrides flip
 * audit.enabled to false.
 */
function makeMinimalConfig(overrides: Partial<{ audit: { enabled: boolean } }> = {}): unknown {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
    },
    permission: 'query-only',
    metadata: { createdAt: '2026-05-15T00:00:00.000Z', version: '1.0' },
    ...(overrides.audit ? { audit: overrides.audit } : {}),
  }
}

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

function run(
  args: string[],
  workDir: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  // Pass --config workDir so resolveConfigStoragePath returns the workspace root,
  // making auditDir resolve to <workDir>/.dbcli/audit (mirrors audit-engines.test.ts pattern).
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, '--config', workDir, ...args], {
      cwd: workDir,
      env: sanitizeEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

interface SeedOpts {
  auditEnabled?: boolean
  secondaryConn?: boolean
  emptyAudit?: boolean
}

async function seed(opts: SeedOpts = {}): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-tail-'))
  // workspace layout: <work>/config.json + <work>/.dbcli/audit/<conn>.jsonl[.1]
  const auditDir = join(work, '.dbcli', 'audit')
  await mkdir(auditDir, { recursive: true })

  const cfg = makeMinimalConfig(opts.auditEnabled === false ? { audit: { enabled: false } } : {})
  await writeFile(join(work, 'config.json'), JSON.stringify(cfg, null, 2))

  if (opts.emptyAudit) {
    await writeFile(join(auditDir, 'default.jsonl'), '')
    return work
  }

  const baseTs = Date.parse('2026-05-15T00:00:00.000Z')
  const mkEntry = (i: number, conn: string = 'default') => ({
    id: `${String(i).padStart(8, '0')}-uuid-${conn}`,
    ts: new Date(baseTs + i * 60_000).toISOString(),
    session_id: 'test-session',
    engine: 'postgresql',
    command: 'query',
    side_effect_tier: 'readonly',
    target: 'users',
    success: true,
    redacted_query: 'dbcli query ?',
  })

  const rotatedLines =
    Array.from({ length: 5 }, (_, i) => JSON.stringify(mkEntry(i + 1))).join('\n') + '\n'
  const currentLines =
    Array.from({ length: 12 }, (_, i) => JSON.stringify(mkEntry(i + 6))).join('\n') + '\n'
  await writeFile(join(auditDir, 'default.jsonl.1'), rotatedLines)
  await writeFile(join(auditDir, 'default.jsonl'), currentLines)

  if (opts.secondaryConn) {
    // Reuse default's mid-range timestamps (i+8) so 'default' and 'secondary'
    // collide on `ts`, exercising D-42 tie-break (default < secondary lex).
    const secondaryLines =
      Array.from({ length: 5 }, (_, i) => JSON.stringify(mkEntry(i + 8, 'secondary'))).join('\n') +
      '\n'
    await writeFile(join(auditDir, 'secondary.jsonl'), secondaryLines)
  }
  return work
}

let work: string

afterEach(async () => {
  if (work) await rm(work, { recursive: true, force: true })
})

describe('dbcli audit tail (CLI)', () => {
  test('happy path: tail 10 entries from current connection (table)', async () => {
    work = await seed()
    const r = await run(['audit', 'tail'], work)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('ts')
    expect(r.stdout).toContain('command')
    expect(r.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(10)
  })

  test('cross-rotation: --n 15 --format json reads .jsonl.1 + .jsonl', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--n', '15', '--format', 'json'], work)
    expect(r.code).toBe(0)
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBe(15)
  })

  test('flat array shape (D-40): single connection, no envelope', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--format', 'json'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('id')
    expect(arr[0]).toHaveProperty('ts')
    expect(arr[0]).not.toHaveProperty('connection')
    expect(arr[0]).not.toHaveProperty('entry')
  })

  test('envelope shape with --all (D-39)', async () => {
    work = await seed({ secondaryConn: true })
    const r = await run(['audit', 'tail', '--all', '--format', 'json'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('connection')
    expect(arr[0]).toHaveProperty('entry')
    expect(arr[0].entry).toHaveProperty('id')
    expect(arr[0].entry).toHaveProperty('ts')
  })

  test('tie-break by connection name (D-42): default < secondary at same ts', async () => {
    work = await seed({ secondaryConn: true })
    const r = await run(['audit', 'tail', '--all', '--n', '50', '--format', 'json'], work)
    const arr: Array<{ connection: string; entry: { ts: string } }> = JSON.parse(r.stdout)
    let foundCollision = false
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i]!.entry.ts === arr[i + 1]!.entry.ts) {
        foundCollision = true
        expect(arr[i]!.connection.localeCompare(arr[i + 1]!.connection)).toBeLessThanOrEqual(0)
      }
    }
    expect(foundCollision).toBe(true)
  })

  test('--for-agent collapses to brief json', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--for-agent'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('ts')
    expect(arr[0]).toHaveProperty('command')
    expect(arr[0]).toHaveProperty('target')
    expect(arr[0]).toHaveProperty('success')
    expect(arr[0]).not.toHaveProperty('id')
    expect(arr[0]).not.toHaveProperty('session_id')
  })

  test('--for-agent --no-brief preserves full entry', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--for-agent', '--no-brief'], work)
    const arr = JSON.parse(r.stdout)
    expect(arr[0]).toHaveProperty('id')
    expect(arr[0]).toHaveProperty('session_id')
    expect(arr[0]).toHaveProperty('engine')
  })

  test('disabled: stderr disabled_hint, stdout empty, exit 0 (E)', async () => {
    work = await seed({ auditEnabled: false })
    const r = await run(['audit', 'tail'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('Audit is disabled')
    expect(r.stdout.trim()).toBe('')
  })

  test('empty audit (table): stderr no_entries, exit 0', async () => {
    work = await seed({ emptyAudit: true })
    const r = await run(['audit', 'tail'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('No audit entries.')
    expect(r.stdout.trim()).toBe('')
  })

  test('empty audit (json): stdout [], exit 0', async () => {
    work = await seed({ emptyAudit: true })
    const r = await run(['audit', 'tail', '--format', 'json'], work)
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('[]')
  })

  test('--n cap warning at 99999 (L)', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--n', '99999'], work)
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('capped')
    expect(r.stderr).toContain('10000')
  })

  test('--n 0 rejected with positive integer error', async () => {
    work = await seed()
    const r = await run(['audit', 'tail', '--n', '0'], work)
    expect(r.code).toBe(1)
    expect(r.stderr.toLowerCase()).toContain('positive integer')
  })

  test('audit --help lists 4 subcommands', async () => {
    work = await seed()
    const r = await run(['audit', '--help'], work)
    expect(r.code).toBe(0)
    for (const sub of ['tail', 'show', 'clear', 'health']) {
      expect(r.stdout).toContain(sub)
    }
  })
})

/**
 * 第五輪對抗式複查（MEDIUM）：使用者可控字串能在表格輸出裡偽造一列。
 *
 * ES shell 的 audit target 來自 `normalizeEsPath`，它會 `decodeURIComponent`，
 * 所以 `GET /a%0A...` 會讓 target 帶真正的換行（`%0A` 在 `url.pathname` 保持
 * 編碼，故通過 shell 的 canonical byte 比對）。JSONL 檔本身安全——
 * `JSON.stringify` 會逃脫——但 `renderTable` 完全不逃脫 cell，於是 `audit tail`
 * 的輸出會多出一列看似另一次真實操作的紀錄。
 *
 * 稽核紀錄的價值在於「讀到的就是發生過的」，能被偽造的呈現層跟能被偽造的
 * 儲存層一樣糟。
 */
describe('audit tail 的表格不能被 cell 內容偽造', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function seedWithTarget(target: string): Promise<string> {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-tail-inject-'))
    dirs.push(work)
    const auditDir = join(work, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    await writeFile(join(work, 'config.json'), JSON.stringify(makeMinimalConfig(), null, 2))
    await writeFile(
      join(auditDir, 'default.jsonl'),
      JSON.stringify({
        id: '00000001-uuid-default',
        ts: '2026-05-15T00:00:00.000Z',
        session_id: 'test-session',
        engine: 'elasticsearch',
        command: 'shell',
        side_effect_tier: 'readonly',
        target,
        success: true,
        redacted_query: 'dbcli shell',
      }) + '\n'
    )
    return work
  }

  test('target 裡的換行不會在輸出裡變成新的一列', async () => {
    const work = await seedWithTarget('a\n2026-08-30T09:00:00Z  shell  orders  readonly  true')
    const { stdout, code } = await run(['audit', 'tail'], work)

    expect(code).toBe(0)
    // 表頭 + 分隔線 + 恰好一列資料。偽造的那一列若成立，這裡會是 4。
    const lines = stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
    expect(lines.length).toBe(3)
    expect(stdout).not.toMatch(/^2026-08-30T09:00:00Z/m)
  })

  test('回車與 tab 同樣不得破壞欄位對齊', async () => {
    const work = await seedWithTarget('a\r\tb')
    const { stdout, code } = await run(['audit', 'tail'], work)

    expect(code).toBe(0)
    const lines = stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
    expect(lines.length).toBe(3)
    expect(lines[2]).not.toContain('\t')
  })

  test('一般 target 的顯示不受影響', async () => {
    const work = await seedWithTarget('/_cat/indices')
    const { stdout } = await run(['audit', 'tail'], work)
    expect(stdout).toContain('/_cat/indices')
  })
})

/**
 * 第六輪：`sanitizeCell` 只換 C0 與 DEL。雙向控制字元 U+202E（RTL override）、
 * 零寬字元、以及 U+2028 / U+0085 這些同樣被視為換行的字元全數放行，
 * 於是該 cell 之後整段以右到左顯示，tier 與 success 欄可被視覺調換。
 *
 * 這是零權限的日誌注入：被 blacklist 拒絕的請求照樣寫 outcome 列，而 target
 * 是攻擊者選的字串——不需要索引存在，也不需要通過任何檢查。
 */
describe('audit tail 的 cell 逃脫涵蓋非 C0 的控制字元', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function seedWithTarget(target: string): Promise<string> {
    const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-tail-bidi-'))
    dirs.push(work)
    const auditDir = join(work, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    await writeFile(join(work, 'config.json'), JSON.stringify(makeMinimalConfig(), null, 2))
    await writeFile(
      join(auditDir, 'default.jsonl'),
      JSON.stringify({
        id: '00000001-uuid-default',
        ts: '2026-05-15T00:00:00.000Z',
        session_id: 'test-session',
        engine: 'elasticsearch',
        command: 'shell',
        side_effect_tier: 'readonly',
        target,
        success: true,
        redacted_query: 'dbcli shell',
      }) + '\n'
    )
    return work
  }

  test.each([
    ['\u202E', 'RTL override'],
    ['\u200B', 'zero-width space'],
    ['\u2028', 'line separator'],
    ['\u0085', 'NEL'],
  ])('target 裡的控制字元不會原樣進入輸出（%s）', async (char) => {
    const work = await seedWithTarget(`a${char}b`)
    const { stdout, code } = await run(['audit', 'tail'], work)

    expect(code).toBe(0)
    expect(stdout).not.toContain(char)
    const lines = stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
    expect(lines.length).toBe(3)
  })
})
