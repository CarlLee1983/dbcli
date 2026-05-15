---
phase: 24-audit-cli
plan: 04
type: execute
wave: 3
depends_on: ["24-01-reader-module", "24-02-capabilities-i18n", "24-03-tail-commander"]
files_modified:
  - src/commands/audit.ts
  - tests/integration/audit-show-health.test.ts
autonomous: true
requirements: [CLI-03, CLI-05, CLI-06]
tags: [audit, commander, show, health, prefix-lookup, recovery-ref]
must_haves:
  truths:
    - "dbcli audit show <full-uuid> 對當前連線輸出單筆完整 entry"
    - "dbcli audit show <prefix-≥4> 命中 1 → render；命中 0 → exit 1 no_match；命中 ≥2 → exit 1 ambiguous"
    - "dbcli audit show <prefix-3> → exit 1 prefix_too_short（D-35 安全閥）"
    - "dbcli audit show <id> --all 跨連線搜尋；命中 → envelope {connection, entry}（D-36）"
    - "dbcli audit show --recovery-ref <id> 用 entry.recovery_ref 精確匹配（D-37）"
    - "dbcli audit show <id> --recovery-ref <id> 互斥 → exit 1 mutex_violation（D-38）"
    - "dbcli audit show 預設 table 輸出單筆 vertical key:value；--format json 輸出 entry object（單連線）或 envelope object（--all）"
    - "dbcli audit show --brief 移除 metadata 與 redacted_query；保留所有契約必要鍵（D-33 show variant）"
    - "dbcli audit show --for-agent = --format json --brief；--no-brief 可 override"
    - "dbcli audit health 對 AuditLogger.getHealth() 結果 thin render，table 預設 9 欄；--format json 輸出 AuditHealthReport"
    - "dbcli audit health --brief 只保留 enabled / lastWrite / rotationUsage（D-33 health variant）"
    - "dbcli audit health 在 audit.enabled = false 時仍輸出 health snapshot（**不**短路 disabled_hint；E decision 例外）"
    - "src/commands/audit.ts 仍 zero writeAuditEntry（F decision 維持）"
    - "src/commands/audit.ts 僅在 health action 處 import getAuditLogger（單一專屬使用點）"
  artifacts:
    - path: "src/commands/audit.ts"
      provides: "show + health 完整實作（替換 plan 24-03 的兩個 placeholder）"
      contains: "audit show"
    - path: "tests/integration/audit-show-health.test.ts"
      provides: "show / health 整合測試"
      contains: "describe"
  key_links:
    - from: "src/commands/audit.ts show action"
      to: "src/core/audit/reader.ts"
      via: "readEntries / discoverConnections（--all 路徑）"
      pattern: "readEntries|discoverConnections"
    - from: "src/commands/audit.ts health action"
      to: "src/core/audit/integration-helper.ts"
      via: "getAuditLogger() → logger.getHealth()"
      pattern: "getAuditLogger"
    - from: "src/commands/audit.ts health action"
      to: "src/core/audit/logger.ts AuditHealthReport"
      via: "AuditLogger.getHealth() 形狀（logger.ts:48-63）"
      pattern: "getHealth"
---

<objective>
替換 plan 24-03 留下的 audit show 與 audit health placeholder，落地 CLI-03（單筆查詢，UUID + prefix + recovery-ref）與 CLI-05（writer health thin renderer）。CLI-06（--format / --brief / --for-agent）在這兩個指令上同時延伸。

Purpose: show 是 forensics 路徑的 single-entry 入口；health 是 D6 寫入失敗時的 observability 視窗。兩者都是 read-only / thin renderer，邏輯複雜度集中在 prefix-matching + envelope/flat 選擇 + brief 裁剪，**不**新增任何 disk write 路徑。

Output:
- `src/commands/audit.ts`：show + health action 完整實作（取代 plan 24-03 的兩個 placeholder）
- `tests/integration/audit-show-health.test.ts`：show 10 cases + health 6 cases

REQ 覆蓋：CLI-03（show 含 prefix / recovery-ref / --all）、CLI-05（health writer 狀態 / lock / rotation cap / disabled 標示）、CLI-06（--format table|json + brief / for-agent override 在 show 與 health 一致）
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
@.planning/phases/24-audit-cli/24-03-tail-commander-PLAN.md
@src/commands/audit.ts
@src/core/audit/reader.ts
@src/core/audit/logger.ts
@src/core/audit/integration-helper.ts
@src/core/audit/types.ts

<interfaces>
From src/core/audit/logger.ts L48-63 (AuditHealthReport — health renderer's input):
```typescript
export interface AuditHealthReport {
  enabled: boolean
  writerInitialized: boolean
  currentFile: string
  currentSizeBytes: number
  currentEntryCount: number
  rotationUsage: {
    bytes: { current: number; max: number; pct: number }
    entries: { current: number; max: number; pct: number }
  }
  lock: { state: 'held' | 'free'; heldByPid?: number }
  lastWrite: { ts: string; success: boolean; error?: string } | null
  lastError: { ts: string; message: string } | null
  sessionId: string | null
  rotation: { lastRotatedAt?: string; previousFile?: string }
}
```

From src/core/audit/integration-helper.ts L21-50:
```typescript
export async function getAuditLogger(config: DbcliConfig, configPath: string): Promise<AuditLogger>
```
Returns per-(storagePath, connection) cached AuditLogger; .getHealth() reads its in-memory counters; safe to call even when audit.enabled=false (returns enabled:false snapshot).

From src/core/audit/reader.ts (Wave 1 module):
```typescript
export async function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>
export async function discoverConnections(auditDir: string): Promise<{ connection: string; files: string[] }[]>
```

From src/commands/audit.ts (plan 24-03 placeholders to replace):
```typescript
auditCommand.command('show [id]').description(t('audit.show.description'))
  .action(async () => { console.error('audit show: not yet implemented (Wave 3)'); process.exit(1) })

auditCommand.command('health').description(t('audit.health.description'))
  .action(async () => { console.error('audit health: not yet implemented (Wave 3)'); process.exit(1) })
```

Existing helpers in audit.ts (from plan 24-03; reuse):
- ALLOWED_FORMATS = ['table', 'json'] as const
- resolveAuditPaths(configPath, config) → { auditDir, connectionName, auditFile }
- isAuditDisabled(config) → boolean
- emitDisabledAndExit0() → never

From .planning/phases/24-audit-cli/24-CONTEXT.md (relevant decisions):
- D-32: --format = 'table' | 'json'，read commands default 'table'
- D-33: brief 規則 — show 移除 metadata + redacted_query；health 留 enabled/lastWrite/rotationUsage
- D-35: prefix < 4 → reject; 0 → no_match; ≥2 → ambiguous
- D-36: --all 跨連線搜尋，envelope {connection, entry}
- D-37: --recovery-ref 用 entry.recovery_ref 精確匹配
- D-38: <id> 與 --recovery-ref 互斥
- E exception: audit.enabled=false → read commands 印 disabled_hint exit 0；BUT health 例外（health 是觀察 enabled 狀態的工具）
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 替換 audit show placeholder 為完整 show action（含 prefix / recovery-ref / --all）</name>
  <read_first>
    - src/commands/audit.ts（plan 24-03 已建立的整檔；尤其 show placeholder + tail action 內已有的 helpers：resolveAuditPaths / parseTailN / briefify (tail variant) / isAuditDisabled / emitDisabledAndExit0）
    - src/core/audit/reader.ts（readEntries / discoverConnections 簽章）
    - src/core/audit/types.ts（AuditEntry 9 必填欄位）
    - src/commands/inspect.ts（commander option pattern + --no-brief 的 commander negate flag）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-35..D-38；E exception 註：show 是 read command → disabled 走 disabled_hint exit 0）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "tail/show/health action"）
    - resources/lang/en/messages.json audit.show_* keys（24-02 落地）
  </read_first>
  <behavior>
    - `dbcli audit show <full-uuid>`（單連線）→ readEntries(currentFile, include_rotated) → 找 entry.id === <uuid> → 命中 1 → render；命中 0 → stderr show_no_match exit 1
    - `dbcli audit show <prefix-≥4>`（單連線）→ filter entries.id.startsWith(prefix) → 0 → no_match exit 1；1 → render；≥2 → stderr show_ambiguous exit 1
    - `dbcli audit show <prefix-3>` → stderr show_prefix_too_short exit 1（不查檔）
    - `dbcli audit show <id> --all` → discoverConnections → 對每連線 readEntries → 跨檔 prefix/exact match → 命中 1 → 輸出 envelope {connection, entry}（D-36）；命中 ≥2 → ambiguous exit 1
    - `dbcli audit show --recovery-ref <full-uuid>` → 對當前連線 entries.find(e => e.recovery_ref === ref) → 命中 1 → render；0 → show_recovery_no_match exit 1；≥2 → show_recovery_ambiguous exit 1
    - `dbcli audit show <id> --recovery-ref <id>` → exit 1 stderr show_mutex_violation（D-38；不查檔）
    - `dbcli audit show`（無 id 也無 --recovery-ref）→ exit 1 stderr show_mutex_violation（同訊息：必須擇一）
    - `--format` 'table'（預設）：印單筆 entry 為 vertical key: value 列表；envelope mode 多印一行 `Connection: <conn>` 在頂部
    - `--format json`：單連線 → 輸出單一 entry object（**不是** array；show 是 single-entry 查詢）；--all → 輸出單一 envelope object {connection, entry}
    - `--brief`：移除 metadata 與 redacted_query 兩個 field（D-33 show variant）；保留所有契約必要鍵
    - `--for-agent`：等同 --format json --brief；--no-brief 可 override
    - `audit.enabled = false`：印 disabled_hint exit 0（E decision；show 是 read command）
  </behavior>
  <action>
    在 `src/commands/audit.ts` 中（用 Edit tool 替換 placeholder 區塊）：

    **(A) 在檔案中既有 helpers 旁（建議在 briefify 函式之後、auditCommand 宣告之前）新增：**
    ```typescript
    const PREFIX_MIN = 4

    function briefifyShow(entry: AuditEntry): Omit<AuditEntry, 'metadata' | 'redacted_query'> {
      const { metadata: _m, redacted_query: _q, ...rest } = entry
      return rest
    }

    // Accept Partial<AuditEntry> so brief mode (which strips metadata + redacted_query)
    // does not render literal "undefined" lines. Only emit a row when the field is present.
    function renderEntryTable(entry: Partial<AuditEntry>): string {
      const lines: string[] = []
      if (entry.id !== undefined) lines.push(`Id:                ${entry.id}`)
      if (entry.ts !== undefined) lines.push(`Ts:                ${entry.ts}`)
      if (entry.session_id !== undefined) lines.push(`Session id:        ${entry.session_id}`)
      if (entry.engine !== undefined) lines.push(`Engine:            ${entry.engine}`)
      if (entry.command !== undefined) lines.push(`Command:           ${entry.command}`)
      if (entry.side_effect_tier !== undefined) lines.push(`Side effect tier:  ${entry.side_effect_tier}`)
      if (entry.target !== undefined) lines.push(`Target:            ${entry.target}`)
      if (entry.success !== undefined) lines.push(`Success:           ${entry.success}`)
      if (entry.recovery_ref !== undefined) lines.push(`Recovery ref:      ${entry.recovery_ref}`)
      if (entry.redacted_query !== undefined) lines.push(`Redacted query:    ${entry.redacted_query}`)
      if (entry.redacted_sql !== undefined) lines.push(`Redacted SQL:      ${entry.redacted_sql}`)
      if (entry.error !== undefined) lines.push(`Error:             ${entry.error}`)
      if (entry.metadata !== undefined) lines.push(`Metadata:          ${JSON.stringify(entry.metadata)}`)
      return lines.join('\n')
    }

    function renderShowResult(
      hit: { connection: string; entry: AuditEntry },
      opts: { all: boolean; format: string; brief: boolean }
    ): void {
      if (opts.format === 'json') {
        const entryView = opts.brief ? briefifyShow(hit.entry) : hit.entry
        const payload = opts.all ? { connection: hit.connection, entry: entryView } : entryView
        console.log(JSON.stringify(payload, null, 2))
      } else {
        if (opts.all) console.log(`Connection: ${hit.connection}`)
        // renderEntryTable accepts Partial<AuditEntry> and skips undefined keys,
        // so brief mode no longer prints literal "undefined" rows for stripped fields.
        console.log(renderEntryTable(opts.brief ? briefifyShow(hit.entry) : hit.entry))
      }
    }
    ```

    **(B) 找到 plan 24-03 留下的 show placeholder 區塊（含 `console.error('audit show: not yet implemented (Wave 3)')`）並用 Edit 整段替換為：**
    ```typescript
    auditCommand
      .command('show [id]')
      .description(t('audit.show.description'))
      .option('--all', 'Search across all connections', false)
      .option('--recovery-ref <ref>', 'Look up by entry.recovery_ref (exact match)')
      .option('--format <format>', 'Output format: table | json (default: table)', 'table')
      .option('--brief', 'Trim metadata + redacted_query', false)
      .option('--no-brief', 'Disable brief mode (override --for-agent default)')
      .option('--for-agent', 'Shortcut for --format json --brief', false)
      .action(async (id: string | undefined, options: Record<string, unknown>, command: Command) => {
        // (1) Mutex / required check (D-38)
        if (id && options.recoveryRef) {
          console.error(t('audit.show_mutex_violation'))
          process.exit(1)
        }
        if (!id && !options.recoveryRef) {
          console.error(t('audit.show_mutex_violation'))
          process.exit(1)
        }
        // (2) Format / brief
        const forAgent = options.forAgent === true
        const format = forAgent ? 'json' : (options.format as string)
        const brief = options.brief === false ? false : (forAgent || options.brief === true)
        validateFormat(format, ALLOWED_FORMATS, 'audit show')

        const configPath = resolveConfigPath(command, options as { config?: string })
        const config = await configModule.read(configPath)
        if (isAuditDisabled(config)) emitDisabledAndExit0()

        const { auditDir, auditFile, connectionName } = await resolveAuditPaths(configPath, config)
        const all = options.all === true

        // (3) Recovery-ref path
        if (options.recoveryRef) {
          const ref = String(options.recoveryRef)
          const matches: Array<{ connection: string; entry: AuditEntry }> = []
          if (all) {
            const conns = await discoverConnections(auditDir)
            for (const c of conns) {
              for (const f of c.files) {
                for (const e of await readEntries(f)) {
                  if (e.recovery_ref === ref) matches.push({ connection: c.connection, entry: e })
                }
              }
            }
          } else {
            for (const e of await readEntries(auditFile, { include_rotated: true })) {
              if (e.recovery_ref === ref) matches.push({ connection: connectionName, entry: e })
            }
          }
          if (matches.length === 0) { console.error(t('audit.show_recovery_no_match', { ref })); process.exit(1) }
          if (matches.length > 1) { console.error(t('audit.show_recovery_ambiguous', { ref, count: String(matches.length) })); process.exit(1) }
          renderShowResult(matches[0]!, { all, format, brief })
          return
        }

        // (4) <id> path: prefix length guard (D-35)
        const lookup = String(id)
        if (lookup.length < PREFIX_MIN) {
          console.error(t('audit.show_prefix_too_short'))
          process.exit(1)
        }
        const matches: Array<{ connection: string; entry: AuditEntry }> = []
        if (all) {
          const conns = await discoverConnections(auditDir)
          for (const c of conns) {
            for (const f of c.files) {
              for (const e of await readEntries(f)) {
                if (e.id === lookup || e.id.startsWith(lookup)) matches.push({ connection: c.connection, entry: e })
              }
            }
          }
        } else {
          for (const e of await readEntries(auditFile, { include_rotated: true })) {
            if (e.id === lookup || e.id.startsWith(lookup)) matches.push({ connection: connectionName, entry: e })
          }
        }
        if (matches.length === 0) { console.error(t('audit.show_no_match', { prefix: lookup })); process.exit(1) }
        if (matches.length > 1) { console.error(t('audit.show_ambiguous', { prefix: lookup, count: String(matches.length) })); process.exit(1) }
        renderShowResult(matches[0]!, { all, format, brief })
      })
    ```

    **(C) 維持 audit.ts 既有 helpers 與其他 actions（tail / clear placeholder / health placeholder）不變；僅替換 show placeholder + 新增 PREFIX_MIN / briefifyShow / renderEntryTable / renderShowResult 4 個新 symbol。**

    **(D) F decision reminder：** 此 task 不引入 writeAuditEntry。
  </action>
  <verify>
    <automated>bun run typecheck 2>&amp;1 | grep -E "src/commands/audit\.ts" | grep -i error | head -5</automated>
  </verify>
  <acceptance_criteria>
    - placeholder 已消失：grep -F "audit show: not yet implemented" src/commands/audit.ts 必須 exit 1
    - show action 含 --recovery-ref：grep -E "'--recovery-ref" src/commands/audit.ts
    - PREFIX_MIN = 4 常數：grep -E "PREFIX_MIN\s*=\s*4" src/commands/audit.ts
    - mutex 檢查：grep -F "show_mutex_violation" src/commands/audit.ts
    - briefifyShow 存在：grep -E "function briefifyShow" src/commands/audit.ts
    - renderShowResult 存在：grep -E "function renderShowResult" src/commands/audit.ts
    - prefix length guard 文案：grep -F "show_prefix_too_short" src/commands/audit.ts
    - F decision 維持：grep -E "writeAuditEntry" src/commands/audit.ts 必須 exit 1
    - typecheck 過：bun run typecheck exit 0
  </acceptance_criteria>
  <done>show action 完整實作；4 種查詢路徑（full-uuid / prefix / recovery-ref / --all variants）齊全；prefix < 4 守住；ambiguous / no_match / mutex 三條 error path 走 i18n；F decision 維持</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 替換 audit health placeholder 為 thin AuditLogger.getHealth() renderer</name>
  <read_first>
    - src/commands/audit.ts（show 已落地後的整檔；尤其 health placeholder 區塊）
    - src/core/audit/logger.ts L48-63（AuditHealthReport shape）
    - src/core/audit/logger.ts L193-221（getHealth() 實作邏輯，了解可能 null 的欄位）
    - src/core/audit/integration-helper.ts L21-50（getAuditLogger 簽章）
    - .planning/phases/24-audit-cli/24-CONTEXT.md specifics §"audit health 草案輸出"
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "Health-specific source"）
    - resources/lang/en/messages.json audit.health.description（24-02 落地）
  </read_first>
  <behavior>
    - `dbcli audit health`：取得當前連線 AuditLogger.getHealth()，table 輸出 9 欄（Enabled / File / Size / Entries / Lock / Last write / Last error / Session id / Last rotation；24-CONTEXT.md specifics）
    - `dbcli audit health --format json`：stdout 為完整 AuditHealthReport JSON.stringify
    - `dbcli audit health --brief`：只保留 {enabled, lastWrite, rotationUsage}（D-33 health variant）；其他三 stream 一致
    - `dbcli audit health --for-agent`：= --format json --brief；--no-brief override
    - `dbcli audit health` 在 audit.enabled = false 時：**仍輸出** health snapshot（顯示 Enabled: false）；**不**走 disabled_hint short-circuit
  </behavior>
  <action>
    在 `src/commands/audit.ts` 中：

    **(A) Imports 區（檔頂）新增（health action 唯一使用點）：**
    ```typescript
    import { getAuditLogger } from '@/core/audit/integration-helper'
    import type { AuditHealthReport } from '@/core/audit/logger'
    ```

    **(B) 在 show helpers 之後新增 health helpers：**
    ```typescript
    type BriefHealth = Pick<AuditHealthReport, 'enabled' | 'lastWrite' | 'rotationUsage'>
    function briefifyHealth(h: AuditHealthReport): BriefHealth {
      return { enabled: h.enabled, lastWrite: h.lastWrite, rotationUsage: h.rotationUsage }
    }

    function formatBytes(n: number): string {
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    function renderHealthTable(h: AuditHealthReport): string {
      const sizePct = Math.round(h.rotationUsage.bytes.pct)
      const entriesPct = Math.round(h.rotationUsage.entries.pct)
      return [
        `Enabled:        ${h.enabled}`,
        `File:           ${h.currentFile}`,
        `Size:           ${formatBytes(h.currentSizeBytes)} / ${formatBytes(h.rotationUsage.bytes.max)} (${sizePct}%)`,
        `Entries:        ${h.currentEntryCount} / ${h.rotationUsage.entries.max} (${entriesPct}%)`,
        `Lock:           ${h.lock.state}${h.lock.heldByPid !== undefined ? ` (pid ${h.lock.heldByPid})` : ''}`,
        `Last write:     ${h.lastWrite ? `${h.lastWrite.ts} (${h.lastWrite.success ? 'success' : 'failed'}${h.lastWrite.error ? `: ${h.lastWrite.error}` : ''})` : '—'}`,
        `Last error:     ${h.lastError ? `${h.lastError.ts} ${h.lastError.message}` : '—'}`,
        `Session id:     ${h.sessionId ?? '—'}`,
        `Last rotation:  ${h.rotation.lastRotatedAt ? `${h.rotation.lastRotatedAt} (${h.rotation.previousFile ?? '—'})` : '—'}`,
      ].join('\n')
    }
    ```

    **(C) 找到 plan 24-03 留下的 health placeholder 區塊（含 `console.error('audit health: not yet implemented (Wave 3)')`）並用 Edit 整段替換為：**
    ```typescript
    auditCommand
      .command('health')
      .description(t('audit.health.description'))
      .option('--format <format>', 'Output format: table | json (default: table)', 'table')
      .option('--brief', 'Trim to enabled / lastWrite / rotationUsage', false)
      .option('--no-brief', 'Disable brief mode (override --for-agent default)')
      .option('--for-agent', 'Shortcut for --format json --brief', false)
      .action(async (options: Record<string, unknown>, command: Command) => {
        const forAgent = options.forAgent === true
        const format = forAgent ? 'json' : (options.format as string)
        const brief = options.brief === false ? false : (forAgent || options.brief === true)
        validateFormat(format, ALLOWED_FORMATS, 'audit health')

        const configPath = resolveConfigPath(command, options as { config?: string })
        const config = await configModule.read(configPath)
        // E exception: health does NOT short-circuit on audit.enabled=false;
        // health is exactly the tool to observe enabled-state.

        const logger = await getAuditLogger(config, configPath)
        const health = logger.getHealth()
        if (format === 'json') {
          const payload: AuditHealthReport | BriefHealth = brief ? briefifyHealth(health) : health
          console.log(JSON.stringify(payload, null, 2))
        } else {
          if (brief) {
            const sizePct = Math.round(health.rotationUsage.bytes.pct)
            const entriesPct = Math.round(health.rotationUsage.entries.pct)
            console.log(`Enabled:        ${health.enabled}`)
            console.log(`Last write:     ${health.lastWrite ? `${health.lastWrite.ts} (${health.lastWrite.success ? 'success' : 'failed'})` : '—'}`)
            console.log(`Rotation usage: ${sizePct}% bytes, ${entriesPct}% entries`)
          } else {
            console.log(renderHealthTable(health))
          }
        }
      })
    ```

    **(D) 維持 audit.ts 其他既有實作（tail / show / clear placeholder）不變；僅替換 health placeholder + 新增 BriefHealth / briefifyHealth / formatBytes / renderHealthTable / 兩個 import。**

    **(E) F decision reminder：** 此 task 引入 getAuditLogger 但 **僅** 用於呼叫 .getHealth()；不呼叫 logger.write()、不呼叫 writeAuditEntry。
  </action>
  <verify>
    <automated>bun run typecheck 2>&amp;1 | grep -E "src/commands/audit\.ts" | grep -i error | head -5</automated>
  </verify>
  <acceptance_criteria>
    - placeholder 已消失：grep -F "audit health: not yet implemented" src/commands/audit.ts 必須 exit 1
    - getAuditLogger import：grep -E "import \{ getAuditLogger \}" src/commands/audit.ts
    - AuditHealthReport type import：grep -E "import type \{ AuditHealthReport \}" src/commands/audit.ts
    - briefifyHealth 存在：grep -E "function briefifyHealth" src/commands/audit.ts
    - renderHealthTable 存在：grep -E "function renderHealthTable" src/commands/audit.ts
    - health action 不短路 disabled：sed -n "/\.command(.health/,/^    })/p" src/commands/audit.ts | grep -E "isAuditDisabled|emitDisabledAndExit0" 必須 exit 1
    - logger.write 未被呼叫：grep -E "logger\.write\b" src/commands/audit.ts 必須 exit 1
    - F decision 維持：grep -E "writeAuditEntry" src/commands/audit.ts 必須 exit 1
    - typecheck 過：bun run typecheck exit 0
  </acceptance_criteria>
  <done>health action 為 thin renderer；getHealth() 結果 9 欄 table + json + brief 3 mode 齊全；disabled state 為 health 的合法輸出（不短路）；不寫任何 entry</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 撰寫 tests/integration/audit-show-health.test.ts 整合測試</name>
  <read_first>
    - tests/integration/audit-tail.test.ts（plan 24-03 落地的 spawn / sanitizeEnv / seed helpers — mirror 結構）
    - src/commands/audit.ts（show + health 已落地後的 action 邏輯）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-35..D-38 / D-33 brief variants / E exception for health）
    - resources/lang/en/messages.json audit.show_* + health 文案（24-02 落地，斷言時用相同字串）
    - tests/fixtures/inspect/v1-postgres/.dbcli/（執行前確認設定檔為 `config.json`（JSON），seed 內 auditEnabled=false 路徑必須用 JSON.parse → mutate → JSON.stringify 寫回；禁止 YAML 字串 append）
  </read_first>
  <behavior>
    Show 必驗 cases（spawn 'bun run src/cli.ts audit show ...'）：
    1. show <full-uuid> happy: 用 fixture 中已知的完整 uuid → exit 0; stdout table 含 'Id:' 與該 uuid
    2. show <prefix-≥4> happy: 取 fixture 某 entry id 前 8 chars → exit 0; stdout 含完整 uuid
    3. show <prefix-3> rejected: id='abc' → exit 1; stderr 含 'at least 4 characters'
    4. show <ambiguous-prefix>: 構造兩 entries 共享 prefix 'aaaa' → exit 1; stderr 含 'Ambiguous prefix'
    5. show <no-match>: 'nonexistent-prefix-xxxx' → exit 1; stderr 含 'No audit entry matches'
    6. show --recovery-ref <ref> happy: fixture 中有一筆 recovery_ref='r-1234-known' → exit 0; stdout 含對應 entry
    7. show --recovery-ref <unknown>: → exit 1; stderr 含 "No audit entry has recovery_ref"
    8. show <id> --recovery-ref <id> mutex: 兩者同時 → exit 1; stderr 含 "either <id> argument or --recovery-ref"
    9. show <id> --all envelope: 跨連線命中單筆 → stdout JSON 為 {connection, entry}（with --format json）；table 含 'Connection:' 行
    10. show <prefix> --format json --brief: 命中單筆 → JSON object 中 'metadata' 與 'redacted_query' 不存在；'id' 與 'ts' 仍存在
    11. show <prefix> --brief（**table mode**）: 命中單筆 → exit 0；`expect(r.stdout).not.toContain('undefined')`（W-05 守門：`renderEntryTable` 對被 brief 移除的欄位必須跳過該列，而不是印 "Redacted query: undefined"）；`expect(r.stdout).toContain('Id:')` 仍應通過

    Health 必驗 cases：
    1. health table happy：exit 0; stdout 含 'Enabled:', 'File:', 'Size:', 'Entries:', 'Lock:', 'Last write:', 'Session id:', 'Last rotation:' 各一行
    2. health --format json：exit 0; JSON.parse(stdout) 為 object 含 enabled / currentFile / rotationUsage / lock / lastWrite / lastError / sessionId / rotation
    3. health --brief --format json：JSON object 只含 enabled / lastWrite / rotationUsage 3 keys
    4. health --for-agent：等同 --format json --brief（assert keys 完全 = 3）
    5. health --for-agent --no-brief：JSON 含 enabled / currentFile / rotationUsage / lock / sessionId 等多 keys（非 brief）
    6. health 在 audit.enabled = false fixture：exit 0; stdout 含 'Enabled:        false'（**not** disabled_hint）；stderr 不含 'Audit is disabled'
  </behavior>
  <action>
    建立 `tests/integration/audit-show-health.test.ts`。Header 與 helpers 大量複用 plan 24-03 的 audit-tail.test.ts 設計（sanitizeEnv / run / seed）— 避免 cross-file dependency，inline 重抄 helpers（與 audit-tail.test.ts 平行而非 import）。

    Header（mirror audit-tail.test.ts L1-30）：
    ```typescript
    import { describe, test, expect, afterEach } from 'bun:test'
    import { spawn } from 'node:child_process'
    import { resolve, join } from 'node:path'
    import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises'
    import { tmpdir } from 'node:os'

    const CLI = resolve(import.meta.dir, '../../src/cli.ts')
    const BASE_FIXTURE = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
    // ... sanitizeEnv / run helpers (mirror audit-tail.test.ts) ...
    ```

    Seed function 與 audit-tail.test.ts 相同基礎，加入兩個新 modes：
    - `withAmbiguousPrefix: true` — 寫兩 entries id 都以 'aaaa1234' 開頭（如 'aaaa1234-x-uuid' 與 'aaaa1234-y-uuid'）
    - `withRecoveryRef: true` — 至少一筆 entry 含 `recovery_ref: 'r-1234-abcd-known'`

    Seed 回傳除了 work dir 外，也回傳 fixture metadata：
    ```typescript
    interface Seeded {
      work: string
      knownFullId: string         // 隨意挑一筆 default.jsonl 的 entry.id 完整值
      knownPrefix: string          // knownFullId.slice(0, 8)
      knownRecoveryRef: string     // 'r-1234-abcd-known'
      ambiguousPrefix: string      // 'aaaa1234'（若 withAmbiguousPrefix=true）
    }
    async function seed(opts: SeedOpts = {}): Promise<Seeded> { ... }
    ```

    Test cases 全部實作如 behavior 所述（10 show + 6 health = 16 tests）。

    Disabled fixture 沿用 plan 24-03 已修正後的 seed 設計：fixture 的設定檔為 `.dbcli/config.json`（JSON，非 YAML）→ `JSON.parse → cfg.audit = { ...(cfg.audit ?? {}), enabled: false } → JSON.stringify` 寫回。**禁止**對 JSON 用字串 append YAML 片段（會破壞 JSON 並讓 disabled-fixture 測試靜默通過 stale 狀態）。

    範例 brief assertion：
    ```typescript
    test('show --format json --brief omits metadata + redacted_query', async () => {
      const s = await seed()
      work = s.work
      const r = await run(['audit', 'show', s.knownPrefix, '--format', 'json', '--brief'], s.work)
      expect(r.code).toBe(0)
      const obj = JSON.parse(r.stdout)
      expect(obj).not.toHaveProperty('metadata')
      expect(obj).not.toHaveProperty('redacted_query')
      expect(obj).toHaveProperty('id')
      expect(obj).toHaveProperty('ts')
    })
    ```

    範例 brief table mode assertion（W-05 守門：renderEntryTable 對 undefined 欄位必須跳過該列）：
    ```typescript
    test('show --brief (table mode) does not print "undefined" for stripped fields', async () => {
      const s = await seed()
      work = s.work
      const r = await run(['audit', 'show', s.knownPrefix, '--brief'], s.work) // default --format=table
      expect(r.code).toBe(0)
      expect(r.stdout).not.toContain('undefined')
      expect(r.stdout).toContain('Id:') // sanity: 仍有正常欄位輸出
    })
    ```

    範例 health disabled assertion：
    ```typescript
    test('health on audit.enabled=false: still prints snapshot, no disabled_hint', async () => {
      const s = await seed({ auditEnabled: false })
      work = s.work
      const r = await run(['audit', 'health'], s.work)
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('Enabled:')
      expect(r.stdout).toContain('false')
      expect(r.stderr).not.toContain('Audit is disabled')
    })
    ```

    `let work: string; afterEach(async () => { if (work) await rm(work, { recursive: true, force: true }); work = '' })`
  </action>
  <verify>
    <automated>bun test tests/integration/audit-show-health.test.ts --bail</automated>
  </verify>
  <acceptance_criteria>
    - 測試檔存在：test -f tests/integration/audit-show-health.test.ts
    - show happy / prefix-too-short / ambiguous / no-match / recovery-ref / mutex 6 種錯誤路徑都有對應 test：grep -cE "test\(.*('happy'|prefix|ambiguous|no.match|recovery|mutex)" tests/integration/audit-show-health.test.ts 回 ≥ 6
    - health 6 種 mode 都覆蓋：grep -cE "test\(.*(happy|json|brief|for-agent|no-brief|disabled)" tests/integration/audit-show-health.test.ts 回 ≥ 5
    - 至少 15 個 test：grep -cE "^\s*test\(" tests/integration/audit-show-health.test.ts 回 ≥ 15
    - brief table mode 不印 "undefined"（W-05 守門）：必須有一個 test 對 `audit show <prefix> --brief --format table` 的 stdout 斷言 `expect(r.stdout).not.toContain('undefined')`；grep -F "not.toContain('undefined')" tests/integration/audit-show-health.test.ts 至少出現 1 次
    - 全部測試通過：bun test tests/integration/audit-show-health.test.ts exit 0
  </acceptance_criteria>
  <done>整合測試覆蓋 D-35..D-38 全部 show 路徑、CLI-05 health 6 種 mode、E exception (health 不短路 disabled)；無 mock</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user CLI args (id/prefix/recovery-ref) → entry lookup | prefix < 4 危險（mass disclosure）；mutex 違反導致歧義行為；recovery-ref 必須 exact 避免誤判 |
| disk audit entries → CLI output | reader 已過濾 truncated；handler 信任 entries 為合法 AuditEntry |
| audit.enabled state → health renderer | health 是唯一 read command 不在 disabled 短路；確保 disabled 用戶仍能 self-diagnose |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-24-01c | I (Mass disclosure via too-short prefix) | show prefix matcher | mitigate | PREFIX_MIN = 4 hard guard，prefix < 4 直接 exit 1 不查檔（D-35）；acceptance grep 守住常數 |
| T-24-08 | T (Confused command path via mutex violation) | show <id> + --recovery-ref | mitigate | D-38 互斥檢查在 action 第一行；acceptance test 8 守住 |
| T-24-02 | I (PII via show brief bypass) | show --brief | mitigate | brief 移除 metadata + redacted_query 兩個可能含敏感字串的欄位（D-33）；reader 不重做 redaction，entries 已 by Phase 22 D-22 pre-redacted |
| T-24-09 | I (Health leak via session_id / file path) | health renderer | accept | sessionId 與 currentFile 已是 health observability 必要訊息；user 自身環境內無 PII；不視為威脅 |
| T-24-10 | T (Confused observability via disabled short-circuit on health) | health action E exception | mitigate | health 故意不走 isAuditDisabled gate；測試 6 守住「Enabled: false 仍輸出」 |
</threat_model>

<verification>
- bun run typecheck exit 0
- bun test tests/integration/audit-show-health.test.ts exit 0
- ! grep -F "show: not yet implemented\|health: not yet implemented" src/commands/audit.ts（兩個 placeholder 已消失；clear placeholder 仍在 — Wave 3 plan 24-05 處理）
- ! grep -E "writeAuditEntry|logger\.write\b" src/commands/audit.ts（getAuditLogger 已加但 logger.write 不應被呼叫）
- audit show / health 兩 action 都使用 i18n key（grep -cE "t\\('audit\\.(show_|health)" src/commands/audit.ts ≥ 5）
</verification>

<success_criteria>
- CLI-03 (show by UUID + ≥4 prefix + --recovery-ref + --all envelope) 由整合測試證明
- CLI-05 (health writer state + lock + rotation cap + disabled 標示) 由整合測試證明
- CLI-06 在 show + health 一致 (--format/--brief/--for-agent/--no-brief)
- D-35..D-38 全部安全閥（prefix length / mutex / ambiguous / recovery-ref exact）守住
- E decision 例外處理（health 不短路）由 acceptance + test 雙重守住
</success_criteria>

<output>
After completion, create `.planning/phases/24-audit-cli/24-04-SUMMARY.md` documenting:
- show 4 種查詢路徑：full-uuid / prefix-≥4 / recovery-ref / --all envelope
- show 三條 error path 文案（prefix_too_short / ambiguous / no_match / recovery_no_match / mutex_violation）
- health table 9 欄輸出格式範例
- D-33 brief variants 實作位置（render layer，非 reader）：show 移 metadata+redacted_query；health 留 enabled/lastWrite/rotationUsage
- E exception：health 為唯一不短路 disabled 的 read command
- Wave 3 plan 24-05 hand-off：clear placeholder 仍待替換；audit.ts F decision (zero writeAuditEntry) 維持中
</output>
