---
phase: 24-audit-cli
plan: 03
type: execute
wave: 2
depends_on: ["24-01-reader-module", "24-02-capabilities-i18n"]
files_modified:
  - src/commands/audit.ts
  - src/cli.ts
  - tests/integration/audit-tail.test.ts
autonomous: true
requirements: [CLI-01, CLI-02, CLI-06]
tags: [audit, commander, tail, cli]
must_haves:
  truths:
    - "dbcli audit --help 顯示 4 個子指令名稱：tail / show / clear / health（show/clear/health 為 placeholder description-only stub，實作在 Wave 3）"
    - "dbcli audit tail 對當前連線輸出最近 10 筆 entries，最新在尾（D-5）"
    - "dbcli audit tail --n 5 輸出最近 5 筆"
    - "dbcli audit tail --all 跨連線 merge 並輸出，envelope 在 JSON 模式為 {connection, entry}"
    - "dbcli audit tail --format json 單連線輸出 flat AuditEntry array（D-40）"
    - "dbcli audit tail --all --format json 輸出 envelope array（D-39）"
    - "dbcli audit tail --for-agent 等價於 --format json --brief；--no-brief 可 override"
    - "dbcli audit tail --all --for-agent envelope 仍存在，每個 envelope.entry 套 brief 裁剪（D-34）"
    - "dbcli audit tail 在 audit.enabled = false 時印 disabled_hint 到 stderr 並 exit 0（E decision）"
    - "空 audit：format=table → stderr 印 No audit entries.，exit 0；format=json → stdout 印 [], exit 0"
    - "dbcli audit tail --n > 10000 自動 cap 並 stderr warn（L decision）"
    - "dbcli audit tail --n <= 0 或非整數 → exit 1 + n_must_be_positive"
    - "src/cli.ts 註冊 auditCommand 為 top-level subtree"
    - "src/commands/audit.ts 不 import 也不呼叫 writeAuditEntry（F decision；audit-on-audit 防護）"
  artifacts:
    - path: "src/commands/audit.ts"
      provides: "auditCommand subtree 容器 + tail 完整實作 + show/clear/health placeholder"
      exports: ["auditCommand"]
      min_lines: 150
    - path: "src/cli.ts"
      provides: "auditCommand 註冊到 program"
      contains: "auditCommand"
    - path: "tests/integration/audit-tail.test.ts"
      provides: "audit tail 整合測試（happy / --all / --for-agent / disabled / cap warning / non-positive n）"
      contains: "describe('dbcli audit tail"
  key_links:
    - from: "src/commands/audit.ts tail action"
      to: "src/core/audit/reader.ts"
      via: "import readEntries / discoverConnections / tailEntries / mergeByTimestamp"
      pattern: "from '@/core/audit/reader'"
    - from: "src/commands/audit.ts"
      to: "resources/lang/{en,zh-TW}/messages.json audit.*"
      via: "t('audit.tail.description'), t('audit.disabled_hint'), t('audit.no_entries'), 等"
      pattern: "t\\('audit\\."
    - from: "src/cli.ts"
      to: "src/commands/audit.ts"
      via: "import { auditCommand } + program.addCommand(auditCommand)"
      pattern: "addCommand\\(auditCommand\\)"
---

<objective>
建立 Phase 24 commander 容器 `auditCommand`，並落地第一個子指令 `audit tail`（含 `--all` 跨連線 merge）。同時把 auditCommand 接到 `src/cli.ts`，這是 Wave 3 子指令（show / clear / health）能 extend 的基礎。

Purpose: tail 是 CLI-01 / CLI-02 的執行體；建立完整的 commander 表面（option flags、stderr/stdout 分流、disabled handling、reader 串接），讓 Wave 3 plans 在已 working 的容器上加 show/health/clear，避免每個子指令重複試錯 commander 配置。

Output:
- `src/commands/audit.ts`（auditCommand 容器 + 4 子指令骨架；tail 完整實作；show/clear/health 為 placeholder description-only stub）
- `src/cli.ts`（import + program.addCommand）
- `tests/integration/audit-tail.test.ts`（spawn-based 整合測試）

REQ 覆蓋：CLI-01（tail 當前連線、time order、--n N）、CLI-02（tail --all 跨連線 merge）、CLI-06（--format table|json + --for-agent + JSON 扁平/envelope）
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
@.planning/phases/24-audit-cli/24-01-reader-module-PLAN.md
@.planning/phases/24-audit-cli/24-02-capabilities-i18n-PLAN.md
@src/commands/inspect.ts
@src/commands/queries.ts
@src/commands/list.ts
@src/cli.ts
@src/core/audit/integration-helper.ts
@src/core/config-binding.ts
@tests/integration/inspect.test.ts
@tests/integration/recovery.test.ts

<interfaces>
From src/core/audit/reader.ts (Wave 1 plan 24-01 output):
```typescript
export interface ReadOptions { include_rotated?: boolean }
export async function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>
export async function discoverConnections(auditDir: string): Promise<{ connection: string; files: string[] }[]>
export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[]
export function mergeByTimestamp(byConn: Map<string, AuditEntry[]>): Array<{ connection: string; entry: AuditEntry }>
```

From src/core/audit/integration-helper.ts L22-30 (connection name resolution to mirror):
```typescript
const storagePath = await resolveConfigStoragePath(configPath)
const connName =
  (config as { effectiveConnectionName?: string }).effectiveConnectionName ||
  getGlobalConnectionName() ||
  'default'
```

From src/core/audit/types.ts:
```typescript
interface AuditEntry { id, ts, session_id, engine, command, side_effect_tier, target, success,
  error?, recovery_ref?, redacted_query, redacted_sql?, metadata? }
```

From src/commands/inspect.ts L34-40 (--for-agent collapse pattern):
```typescript
const forAgent = options.forAgent === true
const format = forAgent ? 'json' : (options.format as string)
const brief = forAgent || options.brief === true
validateFormat(format, ALLOWED_FORMATS, 'inspect')
```

From src/commands/queries.ts L448 (subtree container pattern):
```typescript
export const queriesCommand = new Command('queries').description(t('queries.description'))
queriesCommand.command('list').description(t('queries.list_description')).action(...)
```

From src/cli.ts L25, L328-336 (registration sites):
```typescript
import { recoveryCommand } from './commands/recovery'
// ...
program.addCommand(recoveryCommand)
program.addCommand(recoverCommand)
// audit will be inserted here
```

From tests/integration/inspect.test.ts L12-23 (spawn helper) and tests/integration/recovery.test.ts L18-45 (sanitizeEnv to strip DBCLI_*):
- spawn 'bun', ['run', CLI, ...args] with cwd=fixture, env=sanitizeEnv()
- collect stdout/stderr, return {stdout, stderr, code}
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 建立 src/commands/audit.ts 容器 + tail 完整實作 + 其他 3 子指令 placeholder</name>
  <read_first>
    - src/commands/inspect.ts（--format / --brief / --for-agent / validateFormat 完整 pattern）
    - src/commands/queries.ts L448-587（commander subtree 容器 pattern）
    - src/commands/list.ts（table | json 雙格式 + --format 預設 'table'）
    - src/core/audit/reader.ts（剛由 24-01 plan 完成的 4 exports）
    - src/core/audit/integration-helper.ts L21-50（連線名 fallback chain；audit.ts 不會呼叫 getAuditLogger，但需鏡像連線名解析）
    - src/core/config-binding.ts（resolveConfigStoragePath）
    - src/utils/validation.ts（validateFormat）
    - src/utils/config-path.ts（resolveConfigPath）
    - resources/lang/en/messages.json audit.* block（24-02 落地的 keys）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "src/commands/audit.ts — subtree container" + § "tail/show/health action"）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-31..D-44, E, F, G, J, K, L decisions）
  </read_first>
  <behavior>
    - import 後 `audit --help` 顯示 4 個子指令；每個都有 description（從 i18n 取）
    - `dbcli audit tail`：印 last 10 entries from current connection 的 table，latest 在尾，stdout
    - `dbcli audit tail --n 5`：印 last 5
    - `dbcli audit tail --n 50000`：先 stderr warn（n_capped_warning 含 capped to 10000），再以 10000 跑
    - `dbcli audit tail --n 0` 或 `--n -3` 或 `--n abc`：stderr n_must_be_positive，exit 1
    - `dbcli audit tail --format json`：stdout 為 flat AuditEntry array（D-40）
    - `dbcli audit tail --all`：discover all connections under audit dir → readEntries 對每連線（include_rotated）→ mergeByTimestamp → tail N → 印 table 含 connection 欄
    - `dbcli audit tail --all --format json`：stdout 為 envelope array `[{connection, entry}, ...]`（D-39）
    - `dbcli audit tail --for-agent`：等同 --format json --brief（brief 對 entry 套裁剪：保留 ts/command/target/success；移除 id/session_id/engine/side_effect_tier/recovery_ref/redacted_query/redacted_sql/error/metadata；D-33）
    - `dbcli audit tail --for-agent --no-brief`：format=json，brief=false（override）
    - `dbcli audit tail --all --for-agent`：envelope 仍存在，每個 envelope.entry 套 brief 裁剪（D-34）
    - `audit.enabled = false`（config）：stderr 印 disabled_hint，stdout 不輸出，exit 0（E decision）
    - 空 audit（無 entries）：format=table → stderr 印 'No audit entries.', stdout 空, exit 0；format=json → stdout 印 '[]'，exit 0
    - audit dir 完全不存在：與「空 audit」同處理（reader 對 ENOENT 回 []，handler 不需特判）
    - **不**呼叫 writeAuditEntry（F decision；grep enforce）
  </behavior>
  <action>
    建立 `src/commands/audit.ts`。

    **(A) Imports：**
    ```typescript
    import { join } from 'node:path'
    import { Command } from 'commander'
    import { t } from '@/i18n/message-loader'
    import { resolveConfigPath } from '@/utils/config-path'
    import { validateFormat } from '@/utils/validation'
    import { configModule, getGlobalConnectionName } from '@/core/config'
    import { resolveConfigStoragePath } from '@/core/config-binding'
    import {
      readEntries,
      discoverConnections,
      tailEntries,
      mergeByTimestamp,
    } from '@/core/audit/reader'
    import type { AuditEntry } from '@/core/audit/types'
    ```

    **DO NOT import** `writeAuditEntry` (F decision). DO NOT import `getAuditLogger` here (Wave 3 plan 24-04 will import only inside audit health subcommand).

    **(B) Constants：**
    ```typescript
    const ALLOWED_FORMATS = ['table', 'json'] as const
    const DEFAULT_TAIL_N = 10
    const MAX_TAIL_N = 10000
    const SHORT_ID_LEN = 8
    ```

    **(C) Connection / dir 解析 helper（mirror integration-helper.ts L22-30）：**
    ```typescript
    async function resolveAuditPaths(configPath: string, config: any): Promise<{ auditDir: string; connectionName: string; auditFile: string }> {
      const storagePath = await resolveConfigStoragePath(configPath)
      const connName =
        (config as { effectiveConnectionName?: string }).effectiveConnectionName ||
        getGlobalConnectionName() ||
        'default'
      const auditDir = join(storagePath, '.dbcli', 'audit')
      const auditFile = join(auditDir, `${connName}.jsonl`)
      return { auditDir, connectionName: connName, auditFile }
    }
    ```

    **(D) Audit-disabled gate helper：**
    ```typescript
    function isAuditDisabled(config: any): boolean {
      return config?.audit?.enabled === false
    }
    function emitDisabledAndExit0(): never {
      console.error(t('audit.disabled_hint'))
      process.exit(0)
    }
    ```

    **(E) --n parsing helper（L decision: cap & warn）：**
    ```typescript
    function parseTailN(raw: unknown): number {
      const requested = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
      if (!Number.isFinite(requested) || !Number.isInteger(requested) || requested <= 0) {
        console.error(t('audit.n_must_be_positive'))
        process.exit(1)
      }
      if (requested > MAX_TAIL_N) {
        console.error(t('audit.n_capped_warning', { requested: String(requested), max: String(MAX_TAIL_N) }))
        return MAX_TAIL_N
      }
      return requested
    }
    ```

    **(F) Brief 裁剪（D-33；J decision: render layer，reader 永遠回完整 entry）：**
    ```typescript
    type BriefEntry = Pick<AuditEntry, 'ts' | 'command' | 'target' | 'success'>
    function briefify(entry: AuditEntry): BriefEntry {
      return { ts: entry.ts, command: entry.command, target: entry.target, success: entry.success }
    }
    ```

    **(G) Table renderers（簡單對齊輸出，不引外部 lib；參考 list.ts 風格）：**
    - `renderTailTable(entries: AuditEntry[]): string` — 欄位 `ts | command | target | tier | success | id (8) | recovery_ref (8)`
    - `renderTailAllTable(envelopes: Array<{connection: string; entry: AuditEntry}>): string` — 欄位 `connection | ts | command | target | tier | success | id (8) | recovery_ref (8)`
    - id 與 recovery_ref 顯示 `entry.id.slice(0, SHORT_ID_LEN)`，缺值（如 recovery_ref undefined）顯示 '—'
    - 簡單實作：算每欄最大寬度→ pad → join '  '；不需 box-drawing；header + separator '-' 行
    - 對 entries.length === 0 → 回空字串（caller 會印 'No audit entries.' 到 stderr）

    **(H) auditCommand 容器宣告：**
    ```typescript
    export const auditCommand = new Command('audit').description(t('audit.description'))
    ```

    **(I) tail 子指令完整實作：**
    ```typescript
    auditCommand
      .command('tail')
      .description(t('audit.tail.description'))
      .option('--n <number>', 'Number of recent entries to show (1..10000)', String(DEFAULT_TAIL_N))
      .option('--all', 'Merge entries across all connections', false)
      .option('--format <format>', 'Output format: ' + ALLOWED_FORMATS.join(' | ') + ' (default: table)', 'table')
      .option('--brief', 'Trim each entry to ts/command/target/success', false)
      .option('--no-brief', 'Disable brief mode (override --for-agent default)')
      .option('--for-agent', 'Shortcut for --format json --brief', false)
      .action(async (options: Record<string, unknown>, command: Command) => {
        const forAgent = options.forAgent === true
        const format = forAgent ? 'json' : (options.format as string)
        const brief = options.brief === false ? false : (forAgent || options.brief === true)
        validateFormat(format, ALLOWED_FORMATS, 'audit tail')

        const n = parseTailN(options.n)
        const configPath = resolveConfigPath(command, options as { config?: string })
        const config = await configModule.read(configPath)
        if (isAuditDisabled(config)) emitDisabledAndExit0()

        const { auditDir, auditFile } = await resolveAuditPaths(configPath, config)

        if (options.all === true) {
          const conns = await discoverConnections(auditDir)
          const byConn = new Map<string, AuditEntry[]>()
          for (const c of conns) {
            const merged: AuditEntry[] = []
            for (const f of c.files) merged.push(...(await readEntries(f)))
            byConn.set(c.connection, merged)
          }
          const envelopes = mergeByTimestamp(byConn).slice(-n) // ascending; latest 在尾
          if (format === 'json') {
            const payload = envelopes.map((e) => ({
              connection: e.connection,
              entry: brief ? briefify(e.entry) : e.entry,
            }))
            console.log(JSON.stringify(payload, null, 2))
          } else {
            if (envelopes.length === 0) console.error(t('audit.no_entries'))
            else console.log(renderTailAllTable(envelopes))
          }
          return
        }

        const entries = await readEntries(auditFile, { include_rotated: true })
        const tail = tailEntries(entries, n)
        if (format === 'json') {
          const payload = brief ? tail.map(briefify) : tail
          console.log(JSON.stringify(payload, null, 2))
        } else {
          if (tail.length === 0) console.error(t('audit.no_entries'))
          else console.log(renderTailTable(tail))
        }
      })
    ```

    **(J) 其他 3 子指令的 PLACEHOLDER（讓 `audit --help` 即可看到、Wave 3 plans 替換實作；不可呼叫 audit reader、不可呼叫 writeAuditEntry）：**
    ```typescript
    auditCommand
      .command('show [id]')
      .description(t('audit.show.description'))
      .action(async () => {
        // PLACEHOLDER: implementation lands in Wave 3 plan 24-04
        console.error('audit show: not yet implemented (Wave 3)')
        process.exit(1)
      })

    auditCommand
      .command('clear')
      .description(t('audit.clear.description'))
      .action(async () => {
        // PLACEHOLDER: implementation lands in Wave 3 plan 24-05
        console.error('audit clear: not yet implemented (Wave 3)')
        process.exit(1)
      })

    auditCommand
      .command('health')
      .description(t('audit.health.description'))
      .action(async () => {
        // PLACEHOLDER: implementation lands in Wave 3 plan 24-04
        console.error('audit health: not yet implemented (Wave 3)')
        process.exit(1)
      })
    ```

    Placeholder 目的：1. `audit --help` 顯示完整 4 子指令；2. Wave 3 plans 將以 Edit 方式替換 placeholder action callback（保留 .command(name).description(t(...)) 行）；3. 維持 commander 容器形狀穩定。

    **(K) D-31 reminder：** auditCommand container 註冊到 program 後 `dbcli --help` 應只顯示 `audit` 為 top-level（commander 預設行為已對；不需特殊處理）。

    **(L) F decision enforcement：** 此檔案 zero `writeAuditEntry`、zero `getAuditLogger` import；Wave 3 plan 24-04 的 health 指令才會引入 getAuditLogger。Acceptance grep 守住。
  </action>
  <verify>
    <automated>bun run typecheck 2>&amp;1 | grep -E "src/commands/audit\.ts" | grep -i error | head -5</automated>
  </verify>
  <acceptance_criteria>
    - 檔案存在：test -f src/commands/audit.ts
    - export auditCommand：grep -E "^export const auditCommand" src/commands/audit.ts
    - 4 個 .command 註冊：grep -cE "\.command\('(tail|show|clear|health)" src/commands/audit.ts 回 4
    - tail action 引入 reader：grep -E "from '@/core/audit/reader'" src/commands/audit.ts
    - 不引入 writeAuditEntry：grep -E "writeAuditEntry" src/commands/audit.ts 必須 exit 1
    - 不引入 getAuditLogger（Wave 3 才會加）：grep -E "getAuditLogger" src/commands/audit.ts 必須 exit 1
    - --for-agent / --no-brief / --brief / --all / --n / --format option 都註冊：grep -cE "'--(for-agent|no-brief|brief|all|n|format)" src/commands/audit.ts 回 ≥ 6
    - parseTailN cap 邏輯：grep -F "MAX_TAIL_N" src/commands/audit.ts
    - i18n 文案使用：grep -cE "t\\('audit\\." src/commands/audit.ts 回 ≥ 7（tail/show/clear/health description ×4 + disabled_hint + no_entries + n_capped_warning + n_must_be_positive）
    - typecheck 過：bun run typecheck exit 0
  </acceptance_criteria>
  <done>auditCommand 為 well-formed commander subtree；tail 完整實作；其他 3 子指令 placeholder 就位；F decision 由 grep 守住；typecheck 全綠</done>
</task>

<task type="auto">
  <name>Task 2: 在 src/cli.ts 註冊 auditCommand</name>
  <read_first>
    - src/cli.ts L1-50（imports block）
    - src/cli.ts L320-345（addCommand 區塊；尤其 L328-329 recoveryCommand / recoverCommand 與 L336 queriesCommand）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "src/cli.ts (modified — register subtree)"）
  </read_first>
  <action>
    在 `src/cli.ts` 做兩處增加（**保留所有既有內容不動**）：

    **(A) Imports 區（建議插在 `import { recoveryCommand } from './commands/recovery'` 之後）：**
    ```typescript
    import { auditCommand } from './commands/audit'
    ```

    **(B) addCommand 區（建議插在 `program.addCommand(recoverCommand)` 之後）：**
    ```typescript
    program.addCommand(auditCommand)
    ```

    **不要**改動既有 addCommand 順序、不要刪 queriesCommand 的註冊、不要動其他 commander 設定（preAction/postAction hooks 不需）。
  </action>
  <verify>
    <automated>bun run src/cli.ts audit --help 2>&amp;1 | grep -cE "^\s+(tail|show|clear|health)\s"</automated>
  </verify>
  <acceptance_criteria>
    - import 存在：grep -E "from './commands/audit'" src/cli.ts
    - addCommand 存在：grep -E "program\.addCommand\(auditCommand\)" src/cli.ts
    - audit --help 列出 4 個子指令：bun run src/cli.ts audit --help 輸出含 tail / show / clear / health 各一行
    - dbcli --help 仍含 audit 為 top-level：bun run src/cli.ts --help 2>&amp;1 | grep -E "^\s+audit\s" 非空
    - 既有 queriesCommand 仍註冊：grep -E "program\.addCommand\(queriesCommand\)" src/cli.ts
    - typecheck 過：bun run typecheck exit 0
  </acceptance_criteria>
  <done>auditCommand 為 program 的子指令；audit --help 正確顯示 4 子指令；既有 commander 樹未受影響</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 撰寫 tests/integration/audit-tail.test.ts 整合測試</name>
  <read_first>
    - tests/integration/inspect.test.ts L1-60（CLI spawn pattern + fixture copy 風格）
    - tests/integration/recovery.test.ts L18-45（sanitizeEnv 必要性 — strip DBCLI_*）
    - src/commands/audit.ts（剛完成的實作）
    - src/core/audit/types.ts（AuditEntry 必填欄位）
    - tests/fixtures/inspect/v1-postgres/.dbcli/（既有 minimal config fixture，用於 cp 起 base；**注意：實際檔名為 `config.json`（JSON 格式，非 YAML）**，seed 內 disable-audit 路徑必須用 `JSON.parse → mutate → JSON.stringify` 寫回；string-append YAML 會壞 JSON）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "tests/integration/audit-cli.test.ts (new)" 的 spawn 模式 + sanitizeEnv）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-39, D-40, D-41, D-42, E, L decisions）
  </read_first>
  <behavior>
    Pre-seeded fixture 結構（測試 setup 建立）：
    - tmp workDir + .dbcli/audit/ 子目錄
    - .dbcli/audit/default.jsonl 預先寫 12 行 valid AuditEntry（ts 升序，每筆相隔 60 秒；timestamp 為合成 '2026-05-15T00:01:00.000Z' 至 '2026-05-15T00:12:00.000Z'）
    - .dbcli/audit/default.jsonl.1 預先寫 5 行 valid AuditEntry（更舊；ts 早於 .jsonl 第一筆）
    - 第二個 fixture：再加 .dbcli/audit/secondary.jsonl 5 行（ts 與 default 交錯，含至少一筆與 default 同 ts 用以驗 tie-break）
    - 第三個 fixture：與第一個相同但 .dbcli config 設 audit.enabled = false
    - 第四個 fixture（空 audit）：建 .dbcli/audit/default.jsonl 為空檔

    必驗 cases（spawn 'bun run src/cli.ts audit tail [...args]' 執行）：
    1. happy path: `audit tail` → exit 0；stdout 含 table header（ts / command / target ...）；stdout 行數 ≥ 12（header + separator + 10 entries）
    2. cross rotation: `audit tail --n 15 --format json` → exit 0；JSON.parse(stdout) 為 array length === 15（含 .jsonl.1 與 .jsonl 各部分）
    3. flat array shape (D-40): `audit tail --format json` → JSON.parse(stdout) 為 array，每元素含 'id' 與 'ts' 欄位（不是 envelope shape）
    4. envelope shape (D-39): `audit tail --all --format json` → JSON.parse(stdout) 為 array，每元素為 {connection, entry}，且 entry 含 9 必填欄位
    5. tie-break (D-42): `audit tail --all --format json` 對含同 ts 兩連線的 fixture → 篩出兩 envelope 同 ts 的相鄰對 → connection 名字典序在前的應在前（'default' < 'secondary'）
    6. --for-agent: `audit tail --for-agent` → format 為 json；每筆只剩 ts/command/target/success；無 id 與 session_id 欄位
    7. --for-agent --no-brief: `audit tail --for-agent --no-brief` → format 為 json，但 entry 為完整（含 id / session_id / engine 等）
    8. disabled (E): `audit tail` 對 audit.enabled=false fixture → exit 0；stderr 含 'Audit is disabled'；stdout 空
    9. empty table (E): `audit tail` 對空 audit fixture → exit 0；stderr 含 'No audit entries.'；stdout 空
    10. empty json (E): `audit tail --format json` 對空 fixture → exit 0；stdout trim() === '[]'
    11. cap warning (L): `audit tail --n 99999` → exit 0；stderr 含 'capped to 10000'；stdout 仍輸出
    12. non-positive n: `audit tail --n 0` → exit 1；stderr 含 'positive integer'
    13. `audit --help` 列出 4 個子指令名

    **不要**做 bench / 並發測試。**不要**測 show/clear/health 行為（Wave 3 plans 負責）。
  </behavior>
  <action>
    建立 `tests/integration/audit-tail.test.ts`。Header：
    ```typescript
    import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
    import { spawn } from 'node:child_process'
    import { resolve, join } from 'node:path'
    import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises'
    import { tmpdir } from 'node:os'

    const CLI = resolve(import.meta.dir, '../../src/cli.ts')
    const BASE_FIXTURE = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')

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

    function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
      return new Promise((res) => {
        const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (b) => (stdout += b.toString()))
        child.stderr.on('data', (b) => (stderr += b.toString()))
        child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
      })
    }
    ```

    Helper to seed fixture（採用 cp existing minimal fixture 作為 base，避免重新搭 V2 config）：
    ```typescript
    interface SeedOpts { auditEnabled?: boolean; secondaryConn?: boolean; emptyAudit?: boolean }

    async function seed(opts: SeedOpts = {}): Promise<string> {
      const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-tail-'))
      // cp existing minimal fixture so configModule.read() works
      await cp(BASE_FIXTURE, work, { recursive: true })
      const auditDir = join(work, '.dbcli', 'audit')
      await mkdir(auditDir, { recursive: true })

      // Optionally toggle audit.enabled in .dbcli/config.json
      // BASE_FIXTURE = tests/fixtures/inspect/v1-postgres has .dbcli/config.json (verified by probing fixture dir).
      // It is JSON (NOT YAML) — must parse/mutate/write, NOT string-append.
      if (opts.auditEnabled === false) {
        const cfgPath = join(work, '.dbcli', 'config.json')
        const raw = await Bun.file(cfgPath).text()
        const cfg = JSON.parse(raw)
        cfg.audit = { ...(cfg.audit ?? {}), enabled: false }
        await writeFile(cfgPath, JSON.stringify(cfg, null, 2))
      }

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
      const rotatedLines = Array.from({ length: 5 }, (_, i) => JSON.stringify(mkEntry(i + 1))).join('\n') + '\n'
      const currentLines = Array.from({ length: 12 }, (_, i) => JSON.stringify(mkEntry(i + 6))).join('\n') + '\n'
      await writeFile(join(auditDir, 'default.jsonl.1'), rotatedLines)
      await writeFile(join(auditDir, 'default.jsonl'), currentLines)
      if (opts.secondaryConn) {
        // Use SAME timestamps as default's middle entries (i+8) to verify tie-break (default < secondary lexicographically)
        const secondaryLines = Array.from({ length: 5 }, (_, i) =>
          JSON.stringify(mkEntry(i + 8, 'secondary'))
        ).join('\n') + '\n'
        await writeFile(join(auditDir, 'secondary.jsonl'), secondaryLines)
      }
      return work
    }

    let work: string
    afterEach(async () => { if (work) await rm(work, { recursive: true, force: true }) })
    ```

    Test cases（implement 全部 13 個 behavior cases）：
    ```typescript
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

      test('flat array shape (D-40)', async () => {
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
        for (let i = 0; i < arr.length - 1; i++) {
          if (arr[i].entry.ts === arr[i + 1].entry.ts) {
            expect(arr[i].connection.localeCompare(arr[i + 1].connection)).toBeLessThanOrEqual(0)
          }
        }
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

      test('empty table: stderr no_entries, exit 0', async () => {
        work = await seed({ emptyAudit: true })
        const r = await run(['audit', 'tail'], work)
        expect(r.code).toBe(0)
        expect(r.stderr).toContain('No audit entries.')
        expect(r.stdout.trim()).toBe('')
      })

      test('empty json: stdout [], exit 0', async () => {
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
    ```

    Note：若 `cp(BASE_FIXTURE, work, { recursive: true })` 路徑問題，executor 自行檢查 tests/fixtures/ 目錄存在哪些 minimal fixture（grep `tests/fixtures/` 找到含 `.dbcli/config.yml` 的最小範例）。
  </action>
  <verify>
    <automated>bun test tests/integration/audit-tail.test.ts --bail</automated>
  </verify>
  <acceptance_criteria>
    - 測試檔存在：test -f tests/integration/audit-tail.test.ts
    - sanitizeEnv 存在：grep -F "DBCLI_NO_UPDATE_CHECK" tests/integration/audit-tail.test.ts
    - happy path 測試：grep -E "tail.*entries from current connection" tests/integration/audit-tail.test.ts
    - --all envelope 測試：grep -F "envelope" tests/integration/audit-tail.test.ts
    - tie-break 測試：grep -E "tie-break|default.*secondary|localeCompare" tests/integration/audit-tail.test.ts
    - disabled 測試：grep -F "Audit is disabled" tests/integration/audit-tail.test.ts
    - cap warning 測試：grep -F "capped" tests/integration/audit-tail.test.ts
    - 至少 11 個 test：grep -cE "^\s*test\(" tests/integration/audit-tail.test.ts 回 ≥ 11
    - 全部測試通過：bun test tests/integration/audit-tail.test.ts exit 0
  </acceptance_criteria>
  <done>整合測試覆蓋 D-39/40/41/42 envelope 形狀、E disabled/empty、L cap warning、tie-break；spawn 測試走真實 commander surface；無 mock</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user CLI args → commander handler | --n / --format / --all 由 user 控制；非法值 (n=0/負/非數字、未支援 format) 須 exit 1 不繼續 |
| audit dir disk → CLI output | reader 可能回 truncated entries；handler 信任 reader 已過濾 |
| audit.enabled=false → CLI behavior | disabled 時不建 dir、不讀檔、不輸出 entries |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-24-03 | I (Information disclosure: --all 跨環境) | tail --all 跨連線輸出 | mitigate | --all envelope 明確標 connection 欄；JSON 為 envelope shape；user 可由 connection 名分辨；Phase 26 docs/SKILL 補警語 |
| T-24-02 | I (PII via brief bypass) | brief mode | mitigate | brief 只是 entry 子集 (ts/command/target/success)，仍受 Phase 22 D-22 pre-redacted 守護；reader 不重做 redaction |
| T-24-06 | D (DoS via huge --n) | parseTailN | mitigate | --n 上限 10000 cap & warn (L decision)；tail action 不會 alloc 無限結果 |
| T-24-07 | T (Spoofing via writeAuditEntry on audit subcommand) | F decision enforcement | mitigate | acceptance grep 守住 src/commands/audit.ts 不 import writeAuditEntry；防止 audit-on-audit 循環與 clear 自相矛盾 |
</threat_model>

<verification>
- bun run typecheck exit 0
- bun test tests/integration/audit-tail.test.ts exit 0
- bun run src/cli.ts audit --help 顯示 4 個子指令
- bun run src/cli.ts --help 含 'audit' 為 top-level
- ! grep -E "writeAuditEntry|getAuditLogger" src/commands/audit.ts（Wave 3 24-04 才會加 getAuditLogger）
</verification>

<success_criteria>
- CLI-01 (tail current connection、--n、time order) 由整合測試證明
- CLI-02 (tail --all merge) 由整合測試證明（envelope 形狀 + tie-break）
- CLI-06 (--format table|json + JSON 為扁平/envelope) 由整合測試證明（D-39/40 形狀差異）
- Wave 3 plans 24-04 / 24-05 可在 audit.ts 既有 placeholder 區塊上 Edit 即可（commander 容器 + cli.ts wiring 已就位）
</success_criteria>

<output>
After completion, create `.planning/phases/24-audit-cli/24-03-SUMMARY.md` documenting:
- auditCommand 容器 export 與 4 子指令清單（tail 完整、其他 3 為 placeholder）
- tail flag 集合：--n / --all / --format / --brief / --no-brief / --for-agent
- D-40 vs D-39 JSON 形狀差異（單 vs --all）的最終 wire format
- F decision enforcement：audit.ts 內 zero writeAuditEntry import（Wave 3 plans 須維持）
- Wave 3 hand-off：show/health 由 24-04 plan 替換 placeholder；clear 由 24-05 替換
</output>
