---
phase: 24-audit-cli
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/audit/reader.ts
  - tests/unit/core/audit/reader.test.ts
autonomous: true
requirements: [CLI-01, CLI-02, CLI-03]
tags: [audit, reader, jsonl, foundation]
must_haves:
  truths:
    - "Reader 能從 .dbcli/audit/<conn>.jsonl 與 <conn>.jsonl.1 讀回 AuditEntry[]"
    - "Reader 對最後一行截斷的 JSON 容忍跳過並 stderr warn，不 throw"
    - "Reader 對中段非 JSON 行 hard-fail（throw 並指向 dbcli audit clear）"
    - "discoverConnections 能掃描 audit dir 並以 file basename 推導 connection 名稱（D-44）"
    - "discoverConnections 排除 .lock 與其他非 audit 檔"
    - "tailEntries 接受 entries 與 N，sort 後回傳最後 N 筆（latest 在尾）"
    - "mergeByTimestamp 跨 connection merge，ts 升序、ts 相同時以 connection 名字典序 tie-break（D-42）"
  artifacts:
    - path: "src/core/audit/reader.ts"
      provides: "readEntries / discoverConnections / tailEntries / mergeByTimestamp 4 個 functional exports"
      exports: ["readEntries", "discoverConnections", "tailEntries", "mergeByTimestamp"]
      min_lines: 80
    - path: "tests/unit/core/audit/reader.test.ts"
      provides: "Reader 單元測試覆蓋 truncated last line / middle corruption / merge tie-break / tail / discover"
      contains: "describe('readEntries"
  key_links:
    - from: "src/core/audit/reader.ts"
      to: "src/core/audit/types.ts"
      via: "import type { AuditEntry }"
      pattern: "import type \\{ AuditEntry \\} from"
    - from: "tests/unit/core/audit/reader.test.ts"
      to: "src/core/audit/reader.ts"
      via: "import readEntries / discoverConnections / tailEntries / mergeByTimestamp"
      pattern: "from '@/core/audit/reader'"
---

<objective>
建立 Phase 24 的 read-only foundation：functional reader module（無 lock、無 writer 路徑），讓 Wave 2/3 的 commander 子指令可以乾淨地讀回 audit entries 並做跨連線 merge。

Purpose: 把所有「讀檔 + 解析 + sort + tail + cross-connection discovery」邏輯集中到一個 stateless module，commander handler 保持薄；獨立 unit test 覆蓋 truncation tolerance 與 tie-break 等邊界。

Output:
- `src/core/audit/reader.ts`（純 functional module，4 exports）
- `tests/unit/core/audit/reader.test.ts`（覆蓋所有 reader-side 邊界）

CLI-01/02/03 在此 plan 只提供 capability（後續 wave 才暴露 commander），但這 3 個 REQ 的執行核心都在 reader：CLI-01 (tail current) 與 CLI-02 (--all merge) 都依賴 readEntries + tailEntries + mergeByTimestamp；CLI-03 (show) 依賴 readEntries + discoverConnections（--all 路徑）。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/24-audit-cli/24-CONTEXT.md
@.planning/phases/24-audit-cli/24-PATTERNS.md
@.planning/phases/22-entry-schema-redaction-contract/22-CONTEXT.md
@src/core/audit/logger.ts
@src/core/audit/types.ts
@tests/unit/core/audit/logger.test.ts

<interfaces>
<!-- Key types and contracts the executor needs. -->

From src/core/audit/types.ts:
```typescript
export interface AuditEntry {
  id: string                    // UUID e.g. '5f3a8b2c-...'
  ts: string                    // ISO-8601 e.g. '2026-05-15T10:42:18.000Z'
  session_id: string            // e.g. '87421-1747234567890-a4f2b8'
  engine: DatabaseSystem        // 'postgresql' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'elasticsearch'
  command: string               // e.g. 'query'
  side_effect_tier: SideEffectTier  // 'readonly' | 'dry-run' | 'local-write' | 'db-write' | 'interactive' | 'none'
  target: string
  success: boolean
  error?: string
  recovery_ref?: string
  redacted_query: string
  redacted_sql?: string
  metadata?: Record<string, unknown>
}
```

From src/core/audit/logger.ts (path layout convention to mirror):
```typescript
this.auditDir = join(opts.storagePath, '.dbcli', 'audit')
this.auditFilePath = join(this.auditDir, `${opts.connectionName}.jsonl`)
this.previousFilePath = `${this.auditFilePath}.1`
```

From src/core/audit/logger.ts:223-234 (read-then-split-then-filter pattern to mirror):
```typescript
const raw = await readFile(this.auditFilePath, 'utf8')
const lines = raw.split('\n').filter(Boolean)
```

Required functional API (24-CONTEXT.md G decision):
```typescript
export interface ReadOptions { include_rotated?: boolean }
export function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>
export function discoverConnections(auditDir: string): Promise<{ connection: string; files: string[] }[]>
export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[]
export function mergeByTimestamp(byConn: Map<string, AuditEntry[]>): Array<{ connection: string; entry: AuditEntry }>
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 實作 src/core/audit/reader.ts functional reader module</name>
  <read_first>
    - src/core/audit/logger.ts（path layout L92-94、syncCountersFromDisk pattern L223-234）
    - src/core/audit/types.ts（AuditEntry 介面）
    - src/core/recovery/last-envelope.ts（read-only file scanner pattern 參照）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "src/core/audit/reader.ts (new)"）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-08 / D-41 / D-42 / D-44 / G decision）
  </read_first>
  <behavior>
    - readEntries(filePath): 檔案不存在 → 回 [] (不 throw)
    - readEntries 對 N 完整 JSONL 行 → 回 N 筆 AuditEntry，順序與檔案順序一致（不主動排序單一輸入路徑）
    - readEntries 最後一行 JSON.parse 失敗 → process.stderr.write 含 'skipping truncated last line' 並排除該筆
    - readEntries 中段（非最後一行）JSON.parse 失敗 → throw new Error 含 file path、line number、'Run `dbcli audit clear` to reset' 字串
    - readEntries(filePath, { include_rotated: true }): 先讀 <filePath>.1（若存在）再讀 <filePath>，concat 回傳；caller 自行排序
    - discoverConnections(auditDir): 不存在 → 回 []
    - discoverConnections 對含 prod.jsonl / prod.jsonl.1 / staging.jsonl / prod.jsonl.lock 的 dir → 回 2 個 connection（prod、staging），prod.files 排序為 [.jsonl.1, .jsonl]，lock 檔被排除
    - tailEntries(entries, n): 對 entries 用 a.ts.localeCompare(b.ts) 升序排序後 slice(-Math.max(0,n))，回傳 ascending（latest 在尾）
    - tailEntries(entries, 0) → 回 []
    - mergeByTimestamp(Map): flat 為 {connection, entry}，sort primary by entry.ts asc、secondary by connection 字典序 asc
  </behavior>
  <action>
    建立 `src/core/audit/reader.ts`。Imports（minimal subset）：
    ```typescript
    import { readFile, readdir, stat } from 'node:fs/promises'
    import { basename, join } from 'node:path'
    import type { AuditEntry } from './types'
    ```
    **不要** import lock、rotation、session-id、appendFile、randomUUID、redactArgv、redactSql、writeAuditEntry。

    匯出 4 個 named exports + 1 個 interface：
    1. `export interface ReadOptions { include_rotated?: boolean }`
    2. `export async function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>`
       - 若 `opts?.include_rotated === true`：先呼叫 readSingle(`${auditFilePath}.1`)（檔案不存在則 []），再呼叫 readSingle(auditFilePath)，concat 回傳
       - 否則直接 readSingle(auditFilePath)
       - 內部 helper `async function readSingle(path)`：try readFile(path, 'utf8') → split('\n').filter(Boolean)；對每行 try JSON.parse；catch 時 if (i === lines.length-1) → `process.stderr.write(\`[dbcli audit] skipping truncated last line in ${path}\n\`)` 並 continue；else → throw new Error(\`[dbcli audit] corrupted line ${i+1} in ${path}. Run \\\`dbcli audit clear\\\` to reset.\`)
       - 對 ENOENT 回 []（用 try/catch 包 readFile，檢查 err.code === 'ENOENT'；其他錯誤 rethrow）
    3. `export async function discoverConnections(auditDir: string): Promise<{ connection: string; files: string[] }[]>`
       - try readdir(auditDir, { withFileTypes: true })；ENOENT → 回 []
       - filter `e.isFile() && (e.name.endsWith('.jsonl') || e.name.endsWith('.jsonl.1'))`
       - 對每個 entry 計算 conn = `name.replace(/\.jsonl(?:\.1)?$/, '')`、full = join(auditDir, name)
       - group by conn 到 Map<string, string[]>
       - 對每個 group 排序：`.jsonl.1` 在前、`.jsonl` 在後（用 `files.sort((a,b) => Number(b.endsWith('.jsonl.1')) - Number(a.endsWith('.jsonl.1')))`）
       - 回傳 `Array.from(map.entries()).map(([connection, files]) => ({ connection, files }))`，依 connection 名字典序 sort
    4. `export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[]`
       - if (n <= 0) return []
       - return `entries.slice().sort((a, b) => a.ts.localeCompare(b.ts)).slice(-n)`
    5. `export function mergeByTimestamp(byConn: Map<string, AuditEntry[]>): Array<{ connection: string; entry: AuditEntry }>`
       - flat：`for ([connection, entries] of byConn) for (entry of entries) push({ connection, entry })`
       - sort：`(a, b) => { const t = a.entry.ts.localeCompare(b.entry.ts); return t !== 0 ? t : a.connection.localeCompare(b.connection) }`

    Top-of-file JSDoc 註明：「Read-only audit reader (Phase 24, G decision). Stateless, lockless, redaction-free (entries arrive pre-redacted by Phase 22 D-22). Tolerant to truncated last line (D-08); hard-fails on middle-line corruption.」
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | grep -c "src/core/audit/reader\.ts.*error"</automated>
  </verify>
  <acceptance_criteria>
    - 檔案存在：`test -f src/core/audit/reader.ts`
    - 4 個 functional exports + 1 interface：`grep -cE "^export (async )?(function|interface)" src/core/audit/reader.ts` 回 ≥ 5
    - 4 個指定 function names 都 export：`grep -cE "^export (async )?function (readEntries|discoverConnections|tailEntries|mergeByTimestamp)\\b" src/core/audit/reader.ts` 回 4
    - 不引入 writer-side dependencies：`grep -E "appendFile|AuditLockManager|SessionIdService|randomUUID|writeAuditEntry|from '\\./lock'|from '\\./rotation'|from '\\./session-id'" src/core/audit/reader.ts` 必須 exit 1（無 match）
    - 不重做 redaction：`grep -E "redactArgv|redactSql|redactSensitive" src/core/audit/reader.ts` 必須 exit 1（無 match）
    - Truncation warn 文案：`grep -F "skipping truncated last line" src/core/audit/reader.ts`
    - Hard-fail hint：`grep -F "dbcli audit clear" src/core/audit/reader.ts`
    - 路徑慣例對齊 logger：reader 不重定義 auditDir，由 caller 傳入完整檔案路徑（grep `'.dbcli'` src/core/audit/reader.ts 必須 exit 1 — 路徑解析在 caller）
    - typecheck 過：`bun run typecheck` exit 0
  </acceptance_criteria>
  <done>reader.ts 編譯通過；4 exports 簽章符合 G decision；無 writer/lock/redaction 依賴；truncation 與 hard-fail 文案就位；JSDoc 標註 read-only 性質</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 撰寫 tests/unit/core/audit/reader.test.ts 涵蓋全部邊界</name>
  <read_first>
    - tests/unit/core/audit/logger.test.ts（mkdtemp / tmpdir / writeFile fixture pattern；spyOn(process.stderr, 'write') 風格）
    - src/core/audit/reader.ts（剛完成的 module）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "tests/unit/core/audit/reader.test.ts (new)"）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（H decision §"Unit"）
    - src/core/audit/types.ts（AuditEntry 必填欄位清單）
  </read_first>
  <behavior>
    - readEntries 對不存在的檔案 → 回 []
    - readEntries 對 3 行合法 JSONL → 回 3 筆 AuditEntry（順序保持輸入順序）
    - readEntries 對 3 行其中最後一行截斷 → 回 2 筆 + stderr 含 `skipping truncated last line`
    - readEntries 對 3 行其中第 2 行非合法 JSON → throws，error message 含 'corrupted line 2' 與 'dbcli audit clear'
    - readEntries(file, { include_rotated: true }) 與 .jsonl.1 存在 → 回兩段 concat（rotated 在前、current 在後）
    - discoverConnections 對不存在 dir → 回 []
    - discoverConnections 對 prod.jsonl / prod.jsonl.1 / staging.jsonl / prod.jsonl.lock → 回 2 connection；prod.files length 2，第一個 endsWith '.jsonl.1'；staging.files length 1
    - discoverConnections 結果依 connection 名字典序排序：[prod, staging]
    - tailEntries(unsorted 5 entries, 3) → 回 last 3 ascending
    - tailEntries(entries, 0) → []
    - tailEntries(entries, 100) when length=3 → 回全部 3 ascending
    - mergeByTimestamp({ prod: [T1, T3], staging: [T2] }) → 順序 [prod@T1, staging@T2, prod@T3]，envelope shape {connection, entry}
    - mergeByTimestamp tie-break：prod@T 與 staging@T 同 ts → prod 在前
  </behavior>
  <action>
    建立 `tests/unit/core/audit/reader.test.ts`。Header imports（mirror logger.test.ts:19-27 風格）：
    ```typescript
    import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
    import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
    import { tmpdir } from 'node:os'
    import { join } from 'node:path'
    import {
      discoverConnections,
      mergeByTimestamp,
      readEntries,
      tailEntries,
    } from '@/core/audit/reader'
    import type { AuditEntry } from '@/core/audit/types'
    ```

    Helper for building minimal-valid AuditEntry：
    ```typescript
    function makeEntry(overrides: Partial<AuditEntry> & { ts: string; id: string }): AuditEntry {
      return {
        id: overrides.id,
        ts: overrides.ts,
        session_id: overrides.session_id ?? 'test-session',
        engine: overrides.engine ?? 'postgresql',
        command: overrides.command ?? 'query',
        side_effect_tier: overrides.side_effect_tier ?? 'readonly',
        target: overrides.target ?? 'users',
        success: overrides.success ?? true,
        redacted_query: overrides.redacted_query ?? 'dbcli query ?',
        ...overrides,
      }
    }
    ```

    Fixture：
    ```typescript
    let workDir: string
    let auditDir: string
    let auditFile: string
    beforeEach(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-reader-'))
      auditDir = join(workDir, '.dbcli', 'audit')
      await mkdir(auditDir, { recursive: true })
      auditFile = join(auditDir, 'default.jsonl')
    })
    afterEach(async () => { await rm(workDir, { recursive: true, force: true }) })
    ```

    必寫的 4 個 describe：

    `describe('readEntries')`:
      - test 'returns [] when file does not exist' → expect(await readEntries(auditFile)).toEqual([])
      - test 'parses 3 valid JSONL lines into 3 entries' → writeFile auditFile 三行 JSON.stringify(makeEntry({...}))；assert length === 3 並檢查 ids 對得上
      - test 'tolerates truncated last line and warns to stderr' → 寫 2 完整行 + 1 行 `{"id":"trunc","ts":` 沒結尾；spy = spyOn(process.stderr, 'write').mockImplementation(() => true)；assert (await readEntries(auditFile)).length === 2；assert spy.mock.calls.flat().some(s => String(s).includes('skipping truncated last line'))；spy.mockRestore()
      - test 'throws on middle-line corruption with hint' → 寫 valid + broken（"NOT JSON"）+ valid 共 3 行；await expect(readEntries(auditFile)).rejects.toThrow(/dbcli audit clear/) 並 .rejects.toThrow(/corrupted line 2/)
      - test 'include_rotated=true concatenates .1 then .jsonl' → 寫 rotated 2 行（id: r1, r2）到 `${auditFile}.1`，current 2 行（id: c1, c2）到 auditFile；result = await readEntries(auditFile, { include_rotated: true })；assert length === 4；assert result[0].id === 'r1' && result[2].id === 'c1'

    `describe('discoverConnections')`:
      - test 'returns [] when audit dir does not exist' → expect(await discoverConnections(join(workDir, 'no-such-dir'))).toEqual([])
      - test 'groups jsonl + jsonl.1 by basename and excludes .lock' → touch prod.jsonl / prod.jsonl.1 / staging.jsonl / prod.jsonl.lock；result = await discoverConnections(auditDir)；assert result.length === 2；conns = result.map(r => r.connection)；expect(conns).toEqual(['prod', 'staging'])
      - test 'sorts files within connection: rotated first, current last' → 同上 fixture；prodGroup = result.find(r => r.connection === 'prod')!；expect(prodGroup.files[0].endsWith('.jsonl.1')).toBe(true)；expect(prodGroup.files[1].endsWith('prod.jsonl')).toBe(true)；expect(prodGroup.files.some(f => f.endsWith('.lock'))).toBe(false)

    `describe('tailEntries')`:
      - test 'returns last N sorted ascending' → entries = [makeEntry({id:'a',ts:'2026-05-15T10:00:00Z'}), {id:'b',ts:'2026-05-15T08:00:00Z'}, {id:'c',ts:'2026-05-15T09:00:00Z'}]；result = tailEntries(entries, 2)；expect(result.map(r=>r.id)).toEqual(['c','a'])
      - test 'returns [] when n <= 0' → expect(tailEntries(entries, 0)).toEqual([]) ；expect(tailEntries(entries, -1)).toEqual([])
      - test 'returns all when n exceeds length' → expect(tailEntries(entries, 100).length).toBe(3)；assert ids ascending by ts

    `describe('mergeByTimestamp')`:
      - test 'merges across connections sorted by ts ascending' → byConn = new Map([['prod', [makeEntry({id:'p1',ts:'T1'}), makeEntry({id:'p3',ts:'T3'})]], ['staging', [makeEntry({id:'s2',ts:'T2'})]]])（用真 ISO timestamps T1<T2<T3）；result = mergeByTimestamp(byConn)；expect(result.map(x => `${x.connection}/${x.entry.id}`)).toEqual(['prod/p1','staging/s2','prod/p3'])
      - test 'breaks ties by connection name lexicographic ascending' → 相同 ts 'T1'，prod 與 staging 各一筆；assert prod 在前

    所有 stderr-spy 用 `spyOn(process.stderr, 'write').mockImplementation(() => true)`，afterEach 或 test 結束時 `spy.mockRestore()`。
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/reader.test.ts --bail</automated>
  </verify>
  <acceptance_criteria>
    - 測試檔存在：`test -f tests/unit/core/audit/reader.test.ts`
    - 4 個 describe block：`grep -cE "describe\\('(readEntries|discoverConnections|tailEntries|mergeByTimestamp)'\\b" tests/unit/core/audit/reader.test.ts` 回 4
    - 截斷行測試文案：`grep -F "skipping truncated last line" tests/unit/core/audit/reader.test.ts`
    - 中段損毀測試文案：`grep -F "dbcli audit clear" tests/unit/core/audit/reader.test.ts`
    - tie-break 測試：`grep -E "tie|lexicographic|connection" tests/unit/core/audit/reader.test.ts`
    - 全部測試通過：`bun test tests/unit/core/audit/reader.test.ts` exit 0
    - 至少 12 個 test：`grep -cE "^\\s*test\\(" tests/unit/core/audit/reader.test.ts` 回 ≥ 12
  </acceptance_criteria>
  <done>所有 reader behavior 由 unit tests 守住；bun test exit 0；測試數 ≥ 12；無 stderr 噪音漏到測試 reporter</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| disk → process | reader 從 .dbcli/audit/*.jsonl 讀已被 writer pre-redacted 的 entries；任何 corruption 來自 writer crash、外部編輯、或硬碟損毀 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-24-04 | T (Tampering / data integrity) | reader.readEntries 中段非 JSON | mitigate | 中段非 JSON 行視為檔案受損 → throw 並提示 `dbcli audit clear`；避免 silent skip 讓被竄改檔案仍被信任（24-CONTEXT.md specifics §"Reader truncation tolerance"）|
| T-24-04b | A (Availability / DoS via partial data) | reader.readEntries 最後一行截斷 | mitigate | 對 last line truncated 跳過 + stderr warn（D-08 不 fsync 的允收代價），避免單筆 truncated entry 讓整個 tail 失敗 |
| T-24-02 | I (PII leak via reader bypass) | reader.readEntries | mitigate | reader 不 import redaction tool、不重做 redaction（信任 writer 已 pre-redacted by Phase 22 D-22）；acceptance criteria 用 grep 守住「無 redactArgv/redactSql/redactSensitive import」防止後人「順手過濾」開新管道 |
</threat_model>

<verification>
- `bun run typecheck` exit 0
- `bun test tests/unit/core/audit/reader.test.ts` exit 0；測試數 ≥ 12
- `! grep -E "appendFile|AuditLockManager|SessionIdService|writeAuditEntry|redactArgv|redactSql|redactSensitive" src/core/audit/reader.ts`
- 所有 fixture 走真實 mkdtemp 臨時目錄（與 logger.test.ts 一致），無 mock fs
</verification>

<success_criteria>
- reader.ts 對 corruption / truncation / discovery / merge 全部行為由 unit tests 鎖定
- 無任何 writer-side / lock / redaction 依賴；T-24-02 mitigation 在 grep 層級守住
- Wave 2/3 commander handler 拿到 reader 即可組裝 tail / show / merge，不需自做檔案 I/O
</success_criteria>

<output>
After completion, create `.planning/phases/24-audit-cli/24-01-SUMMARY.md` documenting:
- exported API signatures (readEntries / discoverConnections / tailEntries / mergeByTimestamp)
- truncation tolerance vs middle-corruption hard-fail 行為差異
- discovery rules（含 .lock 過濾、basename 推導、connection 字典序輸出）
- merge tie-break 規則（ts asc → connection name asc）
- 留給 Wave 2/3 的 hand-off：commander handlers 應呼叫順序：
  - 單連線 tail：readEntries(file, { include_rotated: true }) → tailEntries(entries, n)
  - --all tail：discoverConnections(dir) → 對每 connection readEntries → mergeByTimestamp → slice(-n)
  - show by id/prefix：readEntries(file, { include_rotated: true }) → 自行 prefix match
  - show --all：discoverConnections → 對每 connection readEntries → 跨檔 prefix match → 回 envelope
</output>
