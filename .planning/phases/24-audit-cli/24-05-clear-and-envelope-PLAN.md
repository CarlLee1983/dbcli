---
phase: 24-audit-cli
plan: 05
type: execute
wave: 4
depends_on: ["24-01-reader-module", "24-02-capabilities-i18n", "24-03-tail-commander", "24-04-show-health"]
files_modified:
  - src/commands/audit.ts
  - tests/integration/audit-clear.test.ts
  - tests/integration/audit-envelope.test.ts
autonomous: true
requirements: [CLI-04, CLI-02, CLI-06]
tags: [audit, commander, clear, envelope, contract-test, destructive]
must_haves:
  truths:
    - "dbcli audit clear --yes 直接清空當前連線 .jsonl + .jsonl.1（D-47）"
    - "dbcli audit clear（互動模式 TTY）顯示 D-45 prompt（含每檔 entries count + size），預設 N，僅 'y' 或 'yes'（case-insensitive）才執行刪除"
    - "dbcli audit clear（無 TTY 又無 --yes）→ exit 1 stderr requires_tty_or_yes（D-46）"
    - "dbcli audit clear 成功 → stderr 印 summary_cleared 含 count + connection 名（D-49）"
    - "dbcli audit clear 對空 audit → stderr 印 summary_nothing；exit 0；不報錯"
    - "dbcli audit clear **不**支援 --all（D-47）"
    - "dbcli audit clear **不**寫 audit entry（F decision；audit-on-audit 防護維持）"
    - "dbcli audit clear **不**重置 .dbcli/last-session-id（D-48）"
    - "dbcli audit clear 在 audit.enabled = false → 仍允許執行（清歷史檔案的合法操作）"
    - "tail --all envelope contract test 驗證 {connection: string, entry: AuditEntry} 形狀，且 entry 滿足 Phase 22 9 必填欄位"
    - "envelope test 不修改 tests/integration/audit-contract.test.ts（Phase 22 entry shape 已鎖）"
    - "Phase 24 4 個 placeholder（show / clear / health / + tail 已實作）全部消失，audit.ts 完整實作 4 子指令"
  artifacts:
    - path: "src/commands/audit.ts"
      provides: "clear action 完整實作（替換 plan 24-03 的 placeholder）"
      contains: "audit clear"
    - path: "tests/integration/audit-clear.test.ts"
      provides: "clear 整合測試（--yes / non-TTY rejection / no-op / disabled / lock cleanup / F + D-48 enforcement）"
      contains: "describe"
    - path: "tests/integration/audit-envelope.test.ts"
      provides: "tail --all envelope contract test（Phase 22 entry contract 不變）"
      contains: "envelope"
  key_links:
    - from: "src/commands/audit.ts clear action"
      to: "src/utils/prompts.ts readLineFromStdin pattern"
      via: "inline raw stdin reader（不修改 prompts.ts）；strict y/yes only"
      pattern: "process\\.stdin"
    - from: "tests/integration/audit-envelope.test.ts"
      to: "src/cli.ts audit tail --all --format json"
      via: "spawn 真實 CLI 並 JSON.parse stdout 驗證 envelope shape"
      pattern: "audit.*tail.*--all"
---

<objective>
完成 Phase 24 的最後一塊：destructive `audit clear` + envelope contract test。

clear 是 Phase 24 唯一 destructive 操作 — 必須有完整 confirm flow + non-TTY guard + scope 限制（不支援 --all），確保 agent 不能在 CI / pipe 中意外清空 audit 歷史。

envelope contract test 是 D-39 envelope shape 的最後一道守門；獨立於 Phase 22 audit-contract.test.ts（後者鎖 entry shape，envelope 是 CLI-only wrapper）。

Output:
- `src/commands/audit.ts`：clear action 完整實作（取代 plan 24-03 的 placeholder）
- `tests/integration/audit-clear.test.ts`：destructive flow 測試
- `tests/integration/audit-envelope.test.ts`：envelope shape contract（含 tie-break 守住 D-42 + 磁碟無 wrapper 守住 D-39 CLI-only 性）

REQ 覆蓋：CLI-04（clear 含 --yes / 互動確認）、CLI-02（envelope shape 是 --all merge 的 wire format，contract test 鎖住）、CLI-06（envelope JSON 形狀為 agent-facing wire format 的一部分）

Wave 3 完成後 Phase 24 全部 6 REQ-IDs 落地：
- CLI-01 → 24-03 tail 單連線
- CLI-02 → 24-03 tail --all 實作 + 24-05 envelope contract test 鎖形狀
- CLI-03 → 24-04 show
- CLI-04 → 24-05 clear
- CLI-05 → 24-04 health
- CLI-06 → 跨 24-03 / 24-04 / 24-05 (--format / --brief / --for-agent / envelope)
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
@.planning/phases/24-audit-cli/24-04-show-health-PLAN.md
@src/commands/audit.ts
@src/commands/queries.ts
@src/utils/prompts.ts
@src/core/audit/reader.ts
@src/core/audit/types.ts
@tests/integration/audit-contract.test.ts
@tests/integration/audit-tail.test.ts

<interfaces>
From src/utils/prompts.ts L13-44 (raw stdin reader pattern to mirror — `readLineFromStdin` is **not exported**; inline a similar local reader to keep prompts.ts API stable):
```typescript
async function readLineFromStdin(prompt: string = ''): Promise<string> {
  return new Promise((resolve) => {
    if (prompt) process.stdout.write(prompt)
    let data = ''
    const chunks: Buffer[] = []
    const onData = (chunk: Buffer) => { ... }
    const onEnd = () => { ... }
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.resume()
  })
}
```
**Why not reuse `confirm()`:** Phase 24 D-45 explicitly requires accepting only literal 'y' or 'yes' (case-insensitive); `confirm()` accepts shorter inputs and uses inquirer in TTY mode. Inline a local reader matching D-45.

From src/core/audit/reader.ts (Wave 1):
```typescript
export async function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>
```

From src/commands/audit.ts (plan 24-03 placeholder to replace):
```typescript
auditCommand.command('clear').description(t('audit.clear.description'))
  .action(async () => { console.error('audit clear: not yet implemented (Wave 3)'); process.exit(1) })
```

Existing audit.ts helpers from plans 24-03 / 24-04 (reuse — no re-implementation):
- ALLOWED_FORMATS = ['table', 'json'] as const
- resolveAuditPaths(configPath, config) → { auditDir, connectionName, auditFile }
- formatBytes(n) (added by plan 24-04)

From .planning/phases/24-audit-cli/24-CONTEXT.md (clear-relevant decisions):
- D-45: prompt 顯示完整影響範圍 (file path / entries count / size)，default N，只接受 'y' 或 'yes' (case-insensitive)
- D-46: 無 TTY 無 --yes → stderr requires_tty_or_yes + exit 1
- D-47: 抹除範圍 = 當前連線 .jsonl + .jsonl.1（含殘留 .lock）；不支援 --all
- D-48: 不重置 .dbcli/last-session-id
- D-49: 成功 / 失敗 / no-op 都印人類可讀總結到 stderr
- F: clear 不寫 audit entry

From tests/integration/audit-contract.test.ts (Phase 22; **DO NOT modify**):
This file locks the entry-on-disk shape. Phase 24 envelope is a CLI-only wrapper; new envelope test goes in audit-envelope.test.ts (separate file).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 替換 audit clear placeholder 為含 confirm + --yes + non-TTY guard 的完整實作</name>
  <read_first>
    - src/commands/audit.ts（plan 24-04 已落地後的整檔；clear placeholder 仍在）
    - src/utils/prompts.ts L13-44（readLineFromStdin pattern；L55-59,81,126 非 TTY 偵測風格）
    - src/commands/queries.ts L496-525（既有 `--force` 跳過 confirm 模式作為「skip-prompt flag」風格參考）
    - src/core/audit/reader.ts（readEntries 取 entries count）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-45..D-49, F）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "src/commands/audit.ts — clear action (destructive)"）
    - resources/lang/en/messages.json audit.clear.* keys（24-02 落地）
  </read_first>
  <behavior>
    - `dbcli audit clear --yes`：略過 prompt 直接清空當前連線檔案；exit 0；stderr 印 summary_cleared 含 count + conn
    - `dbcli audit clear`（TTY 互動）：印 D-45 prompt 至 stderr；只有 trim().toLowerCase() === 'y' || === 'yes' 才執行刪除
    - `dbcli audit clear`（無 TTY 又無 --yes）：exit 1，stderr 印 requires_tty_or_yes（D-46）
    - 對空 audit（兩檔都不存在）：exit 0；stderr summary_nothing；不執行 rm
    - 對只有 .jsonl（無 .jsonl.1）：prompt 只列一行 .jsonl；刪 .jsonl + 嘗試刪 .lock（force: true）
    - 對 audit.enabled = false：仍允許執行（清歷史的合法操作）
    - **不**接受 `--all` flag（commander 不註冊）
    - **不**呼叫 writeAuditEntry / logger.write
    - **不**動 .dbcli/last-session-id
  </behavior>
  <action>
    在 `src/commands/audit.ts` 中：

    **(A) 在檔頂 imports 區新增（rm 用於 unlink；stat 若 24-04 已 import 則跳過）：**
    ```typescript
    import { rm, stat } from 'node:fs/promises'
    ```

    **(B) 新增 inline raw-stdin reader helper（不修改 prompts.ts；mirror prompts.ts:13-44；prompt 寫至 stderr）：**
    ```typescript
    function readLineFromStdinWithStderrPrompt(prompt: string): Promise<string> {
      return new Promise((resolve) => {
        process.stderr.write(prompt)
        const chunks: Buffer[] = []
        let data = ''
        const onData = (chunk: Buffer) => {
          chunks.push(chunk)
          data = Buffer.concat(chunks).toString()
          const lines = data.split('\n')
          if (lines.length > 1) {
            process.stdin.pause()
            process.stdin.removeListener('data', onData)
            process.stdin.removeListener('end', onEnd)
            resolve((lines[0] ?? '').trim())
          }
        }
        const onEnd = () => {
          process.stdin.removeListener('data', onData)
          resolve(data.trim())
        }
        process.stdin.on('data', onData)
        process.stdin.on('end', onEnd)
        process.stdin.resume()
      })
    }
    ```

    **(C) 新增 helper 取單檔 (entries count, size string)；對不存在檔回 null：**
    ```typescript
    async function statAuditFile(file: string): Promise<{ entries: number; size: string } | null> {
      try {
        const s = await stat(file)
        const entries = (await readEntries(file)).length
        return { entries, size: formatBytes(s.size) }
      } catch {
        return null
      }
    }
    ```

    **(D) 找到 plan 24-03 留下的 clear placeholder 區塊（含 `console.error('audit clear: not yet implemented (Wave 3)')`）並用 Edit 整段替換為：**
    ```typescript
    auditCommand
      .command('clear')
      .description(t('audit.clear.description'))
      .option('--yes', 'Skip confirmation prompt and delete immediately', false)
      .action(async (options: Record<string, unknown>, command: Command) => {
        const configPath = resolveConfigPath(command, options as { config?: string })
        const config = await configModule.read(configPath)
        // NOTE: clear does NOT short-circuit on audit.enabled=false;
        // clearing existing history is a valid op even when writer is disabled.

        const { auditFile, connectionName } = await resolveAuditPaths(configPath, config)
        const rotatedFile = `${auditFile}.1`
        const lockFile = `${auditFile}.lock`

        const currentInfo = await statAuditFile(auditFile)
        const rotatedInfo = await statAuditFile(rotatedFile)

        // No-op early exit
        if (currentInfo === null && rotatedInfo === null) {
          process.stderr.write(t('audit.clear.summary_nothing') + '\n')
          process.exit(0)
        }

        // Confirm path (D-45 / D-46)
        if (options.yes !== true) {
          if (!process.stdin.isTTY) {
            console.error(t('audit.clear.requires_tty_or_yes'))
            process.exit(1)
          }
          process.stderr.write(t('audit.clear.prompt_header', { conn: connectionName }) + '\n')
          if (currentInfo) {
            process.stderr.write(t('audit.clear.prompt_file_line', {
              file: auditFile,
              entries: String(currentInfo.entries),
              size: currentInfo.size,
            }) + '\n')
          }
          if (rotatedInfo) {
            process.stderr.write(t('audit.clear.prompt_file_line', {
              file: rotatedFile,
              entries: String(rotatedInfo.entries),
              size: rotatedInfo.size,
            }) + '\n')
          }
          const answer = await readLineFromStdinWithStderrPrompt(t('audit.clear.prompt_continue'))
          const proceed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
          if (!proceed) {
            process.stderr.write(t('audit.clear.summary_nothing') + '\n')
            process.exit(0)
          }
        }

        // Delete files (D-47): both .jsonl + .jsonl.1 + leftover .lock; ignore missing
        let cleared = 0
        try {
          if (currentInfo) cleared += currentInfo.entries
          if (rotatedInfo) cleared += rotatedInfo.entries
          await rm(auditFile, { force: true })
          await rm(rotatedFile, { force: true })
          await rm(lockFile, { force: true })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(t('audit.clear.summary_failed', { message: msg }) + '\n')
          process.exit(1)
        }

        process.stderr.write(t('audit.clear.summary_cleared', { count: String(cleared), conn: connectionName }) + '\n')
        // F decision: NO writeAuditEntry / NO logger.write here.
        // D-48: NO touch on .dbcli/last-session-id.
        process.exit(0)
      })
    ```

    **(E) 維持 audit.ts 其他既有實作（tail / show / health）不變；僅替換 clear placeholder + 新增 readLineFromStdinWithStderrPrompt + statAuditFile + 加 `rm` import。**

    **(F) F decision reminder：** clear action 內部 zero writeAuditEntry / logger.write。Acceptance grep 守住。
  </action>
  <verify>
    <automated>bun run typecheck 2>&amp;1 | grep -E "src/commands/audit\.ts" | grep -i error | head -5</automated>
  </verify>
  <acceptance_criteria>
    - placeholder 已消失：grep -F "audit clear: not yet implemented" src/commands/audit.ts 必須 exit 1
    - clear action 含 --yes：grep -E "'--yes'" src/commands/audit.ts
    - 不註冊 --all：sed -n "/\.command(.clear/,/\.action/p" src/commands/audit.ts | grep -E "'--all'" 必須 exit 1
    - non-TTY guard：grep -F "process.stdin.isTTY" src/commands/audit.ts
    - rm 用 force:true：grep -F "force: true" src/commands/audit.ts
    - 三個檔案 (auditFile / rotatedFile / lockFile) 都被 rm：grep -cE "rm\((auditFile|rotatedFile|lockFile)" src/commands/audit.ts 回 3
    - readLineFromStdinWithStderrPrompt 存在：grep -E "function readLineFromStdinWithStderrPrompt" src/commands/audit.ts
    - statAuditFile 存在：grep -E "function statAuditFile" src/commands/audit.ts
    - 'y' 與 'yes' 接受 (case-insensitive)：grep -E "toLowerCase\(\)\s*===\s*'y'" src/commands/audit.ts && grep -E "toLowerCase\(\)\s*===\s*'yes'" src/commands/audit.ts
    - F decision 維持（zero writeAuditEntry）：grep -E "writeAuditEntry" src/commands/audit.ts 必須 exit 1
    - F decision 維持（zero logger.write）：grep -E "logger\.write\b" src/commands/audit.ts 必須 exit 1
    - D-48 維持（不動 last-session-id）：grep -E "last-session-id" src/commands/audit.ts 必須 exit 1
    - typecheck 過：bun run typecheck exit 0
  </acceptance_criteria>
  <done>clear action 完整實作；--yes / 互動 / non-TTY 三條路徑齊全；only 'y'/'yes' 接受；F + D-48 雙重維持；不支援 --all</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 撰寫 tests/integration/audit-clear.test.ts 整合測試</name>
  <read_first>
    - tests/integration/audit-tail.test.ts（plan 24-03 落地的 spawn / sanitizeEnv / seed helpers）
    - src/commands/audit.ts（clear 已落地後）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-45..D-49 全部 case 覆蓋表）
    - resources/lang/en/messages.json audit.clear.* keys（24-02 落地，斷言用相同字串）
    - tests/fixtures/inspect/v1-postgres/.dbcli/（執行前確認設定檔為 `config.json`（JSON），seed 內 auditEnabled=false 路徑必須用 JSON.parse → mutate → JSON.stringify 寫回；禁止 YAML 字串 append）
  </read_first>
  <behavior>
    必驗 cases（spawn 'bun run src/cli.ts audit clear ...'；spawn 預設無 TTY，故互動路徑只能用 acceptance grep + 手動驗證守住）：
    1. `audit clear --yes`（有 .jsonl + .jsonl.1）：exit 0；stderr 含 'Cleared' + 'entries'；assert 兩檔不再存在
    2. `audit clear --yes`（空 audit dir）：exit 0；stderr 含 'Nothing to clear'
    3. `audit clear`（無 TTY，無 --yes）：exit 1；stderr 含 'Cannot prompt for confirmation'（D-46）
    4. `audit clear --yes` 在 audit.enabled=false fixture：exit 0；stderr 含 'Cleared'；檔案被刪
    5. `audit clear --yes` 同時 cleanup .lock：先寫 .lock 檔，clear 後 .lock 不存在
    6. `audit clear --yes` 不寫新 audit entry（F decision）：clear 後 audit dir 內無 default.jsonl 殘留（writer 未被呼叫）
    7. `audit clear --yes` 不動 .dbcli/last-session-id（D-48）：先寫一個 sticky session id，clear 後內容不變
  </behavior>
  <action>
    建立 `tests/integration/audit-clear.test.ts`。Header 與 helpers 大量複用 plan 24-03 的 audit-tail.test.ts 設計（sanitizeEnv / run / seed）— inline 重抄。

    Header（mirror audit-tail.test.ts L1-30）：
    ```typescript
    import { describe, test, expect, afterEach } from 'bun:test'
    import { spawn } from 'node:child_process'
    import { stat } from 'node:fs/promises'
    import { resolve, join } from 'node:path'
    import { mkdir, mkdtemp, rm, writeFile, cp } from 'node:fs/promises'
    import { tmpdir } from 'node:os'

    const CLI = resolve(import.meta.dir, '../../src/cli.ts')
    const BASE_FIXTURE = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
    // sanitizeEnv / run / seed helpers (mirror audit-tail.test.ts)
    // IMPORTANT: BASE_FIXTURE 的設定檔為 .dbcli/config.json (JSON, not YAML).
    // seed 內 auditEnabled=false 路徑必須沿用 plan 24-03 已修正後的設計：
    //   const cfg = JSON.parse(await Bun.file(join(work,'.dbcli','config.json')).text())
    //   cfg.audit = { ...(cfg.audit ?? {}), enabled: false }
    //   await writeFile(join(work,'.dbcli','config.json'), JSON.stringify(cfg, null, 2))
    // 禁止對 JSON 用字串 append YAML（會破壞 JSON、讓 disabled-fixture 測試靜默通過）。
    ```

    Test cases 完整實作：
    ```typescript
    describe('dbcli audit clear (CLI)', () => {
      let work: string
      afterEach(async () => { if (work) await rm(work, { recursive: true, force: true }); work = '' })

      test('--yes deletes both .jsonl + .jsonl.1', async () => {
        work = await seed()
        const auditDir = join(work, '.dbcli', 'audit')
        const r = await run(['audit', 'clear', '--yes'], work)
        expect(r.code).toBe(0)
        expect(r.stderr).toMatch(/Cleared.*entries/)
        await expect(stat(join(auditDir, 'default.jsonl'))).rejects.toThrow()
        await expect(stat(join(auditDir, 'default.jsonl.1'))).rejects.toThrow()
      })

      test('--yes on truly empty audit dir prints Nothing to clear', async () => {
        work = await seed({ emptyAudit: true })
        await rm(join(work, '.dbcli', 'audit', 'default.jsonl'), { force: true })
        const r = await run(['audit', 'clear', '--yes'], work)
        expect(r.code).toBe(0)
        expect(r.stderr).toContain('Nothing to clear')
      })

      test('non-TTY without --yes is rejected (D-46)', async () => {
        work = await seed()
        const r = await run(['audit', 'clear'], work)
        expect(r.code).toBe(1)
        expect(r.stderr).toContain('Cannot prompt for confirmation')
      })

      test('--yes works on audit.enabled=false fixture (no short-circuit)', async () => {
        work = await seed({ auditEnabled: false })
        const auditDir = join(work, '.dbcli', 'audit')
        const r = await run(['audit', 'clear', '--yes'], work)
        expect(r.code).toBe(0)
        expect(r.stderr).toMatch(/Cleared.*entries/)
        await expect(stat(join(auditDir, 'default.jsonl'))).rejects.toThrow()
      })

      test('--yes also removes leftover .lock file', async () => {
        work = await seed()
        const lockPath = join(work, '.dbcli', 'audit', 'default.jsonl.lock')
        await writeFile(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }))
        const r = await run(['audit', 'clear', '--yes'], work)
        expect(r.code).toBe(0)
        await expect(stat(lockPath)).rejects.toThrow()
      })

      test('clear does not write any new audit entry (F decision)', async () => {
        work = await seed()
        const r = await run(['audit', 'clear', '--yes'], work)
        expect(r.code).toBe(0)
        const auditDir = join(work, '.dbcli', 'audit')
        // After clear, default.jsonl should not be re-created (no audit-on-audit write)
        await expect(stat(join(auditDir, 'default.jsonl'))).rejects.toThrow()
      })

      test('clear does not touch .dbcli/last-session-id (D-48)', async () => {
        work = await seed()
        const sidPath = join(work, '.dbcli', 'last-session-id')
        const before = JSON.stringify({ sessionId: 'sticky-test-id', pid: process.pid, createdAt: new Date().toISOString() })
        await writeFile(sidPath, before)
        const r = await run(['audit', 'clear', '--yes'], work)
        expect(r.code).toBe(0)
        const after = await Bun.file(sidPath).text()
        expect(after).toBe(before)
      })
    })
    ```

    互動 prompt 行為（'y' / 'yes' / 'no' / Enter）的測試在純 spawn 環境無法重現完整 TTY，由 Task 1 的 acceptance grep（`toLowerCase() === 'y'` / `toLowerCase() === 'yes'`）守住；TTY-only manual verification 留給 Phase 26 docs/SKILL 寫入手動驗證步驟。
  </action>
  <verify>
    <automated>bun test tests/integration/audit-clear.test.ts --bail</automated>
  </verify>
  <acceptance_criteria>
    - 測試檔存在：test -f tests/integration/audit-clear.test.ts
    - --yes 路徑覆蓋：grep -F "'audit', 'clear', '--yes'" tests/integration/audit-clear.test.ts
    - non-TTY 拒絕測試：grep -F "Cannot prompt for confirmation" tests/integration/audit-clear.test.ts
    - 'Nothing to clear' 路徑覆蓋：grep -F "Nothing to clear" tests/integration/audit-clear.test.ts
    - F decision 測試：grep -F "does not write any new audit entry" tests/integration/audit-clear.test.ts
    - D-48 測試：grep -F "last-session-id" tests/integration/audit-clear.test.ts
    - 至少 7 個 test：grep -cE "^\s*test\(" tests/integration/audit-clear.test.ts 回 ≥ 7
    - 全部測試通過：bun test tests/integration/audit-clear.test.ts exit 0
  </acceptance_criteria>
  <done>clear 整合測試覆蓋 7 cases；F decision + D-48 由 explicit test 守住；--yes / non-TTY / disabled / no-op / lock cleanup 五種路徑齊全</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 撰寫 tests/integration/audit-envelope.test.ts envelope shape contract test</name>
  <read_first>
    - tests/integration/audit-contract.test.ts（Phase 22；**只讀不改**；此 task 為平行 file）
    - tests/integration/audit-tail.test.ts（spawn / seed pattern）
    - src/core/audit/types.ts（Phase 22 entry contract — 9 必填欄位）
    - src/commands/audit.ts（tail --all envelope 邏輯）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-39 envelope wire format / D-42 tie-break）
  </read_first>
  <behavior>
    - spawn `audit tail --all --format json` 對含 ≥2 connections 的 fixture
    - 斷言 stdout 為 JSON array
    - 每個 element 為 envelope shape：`{ connection: string, entry: <AuditEntry> }`
    - 每個 entry.* 滿足 Phase 22 contract：包含 9 必填鍵
    - tie-break (D-42)：構造同 ts 的兩 connection 的兩 entry → 結果中 connection 名字典序在前的應緊鄰在前
    - 斷言：磁碟上 .jsonl 內容不含 'connection' 鍵（envelope 從未寫回；D-39 嚴守 CLI-only）
    - 斷言：單連線 tail（無 --all）為 flat array（D-40），非 envelope
  </behavior>
  <action>
    建立 `tests/integration/audit-envelope.test.ts`。**獨立於** `audit-contract.test.ts`（職責分離：entry shape vs envelope wrapper）。

    Header（複用 audit-tail.test.ts 的 spawn / seed pattern；inline 抄）：
    ```typescript
    import { describe, test, expect, afterEach } from 'bun:test'
    import { spawn } from 'node:child_process'
    import { resolve, join } from 'node:path'
    import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises'
    import { tmpdir } from 'node:os'

    const CLI = resolve(import.meta.dir, '../../src/cli.ts')
    const BASE_FIXTURE = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')
    // sanitizeEnv / run / seed helpers (mirror audit-tail.test.ts)

    const ENTRY_REQUIRED_KEYS = [
      'id', 'ts', 'session_id', 'engine', 'command',
      'side_effect_tier', 'target', 'success', 'redacted_query',
    ]
    ```

    Seed 函式必須建立至少 2 個 connection 的 fixture，且故意製造同 ts entries 給 tie-break 測試（複用 plan 24-03 的 seed helper 結構，secondaryConn=true）。

    Test cases：
    ```typescript
    describe('audit tail --all envelope contract', () => {
      let work: string
      afterEach(async () => { if (work) await rm(work, { recursive: true, force: true }); work = '' })

      test('envelope element has {connection: string, entry: <AuditEntry with all required keys>}', async () => {
        work = await seed({ secondaryConn: true })
        const r = await run(['audit', 'tail', '--all', '--n', '50', '--format', 'json'], work)
        expect(r.code).toBe(0)
        const arr = JSON.parse(r.stdout)
        expect(Array.isArray(arr)).toBe(true)
        expect(arr.length).toBeGreaterThan(0)
        for (const env of arr) {
          expect(typeof env.connection).toBe('string')
          expect(env.entry).toBeDefined()
          for (const key of ENTRY_REQUIRED_KEYS) {
            expect(env.entry).toHaveProperty(key)
          }
        }
      })

      test('connection tie-break (D-42): same ts → connection lexicographic ascending', async () => {
        work = await seed({ secondaryConn: true })
        const r = await run(['audit', 'tail', '--all', '--n', '50', '--format', 'json'], work)
        const arr: Array<{ connection: string; entry: { ts: string } }> = JSON.parse(r.stdout)
        let foundTiePair = false
        for (let i = 0; i < arr.length - 1; i++) {
          if (arr[i].entry.ts === arr[i + 1].entry.ts) {
            foundTiePair = true
            expect(arr[i].connection.localeCompare(arr[i + 1].connection)).toBeLessThanOrEqual(0)
          }
        }
        expect(foundTiePair).toBe(true)
      })

      test('envelope is CLI-only: on-disk .jsonl never contains "connection" or "entry" key', async () => {
        work = await seed({ secondaryConn: true })
        await run(['audit', 'tail', '--all', '--format', 'json'], work)
        const auditDir = join(work, '.dbcli', 'audit')
        for (const file of ['default.jsonl', 'default.jsonl.1', 'secondary.jsonl']) {
          const path = join(auditDir, file)
          let raw = ''
          try { raw = await readFile(path, 'utf8') } catch { continue }
          const lines = raw.split('\n').filter(Boolean)
          for (const line of lines) {
            const obj = JSON.parse(line)
            expect(obj).not.toHaveProperty('connection')
            expect(obj).not.toHaveProperty('entry')
          }
        }
      })

      test('single-connection tail flat array (D-40) does NOT have envelope wrapper', async () => {
        work = await seed()
        const r = await run(['audit', 'tail', '--format', 'json'], work)
        const arr = JSON.parse(r.stdout)
        expect(arr[0]).toHaveProperty('id')
        expect(arr[0]).not.toHaveProperty('connection')
        expect(arr[0]).not.toHaveProperty('entry')
      })

      test('Phase 22 audit-contract.test.ts is not modified by Phase 24', async () => {
        // Meta-guard: this test file does not import audit-contract.test.ts
        // and the envelope shape lives only at the CLI layer.
        const contractPath = resolve(import.meta.dir, 'audit-contract.test.ts')
        const raw = await readFile(contractPath, 'utf8').catch(() => '')
        // Phase 22 contract test should not mention 'envelope'
        expect(raw).not.toContain('envelope')
      })
    })
    ```
  </action>
  <verify>
    <automated>bun test tests/integration/audit-envelope.test.ts --bail</automated>
  </verify>
  <acceptance_criteria>
    - 測試檔存在：test -f tests/integration/audit-envelope.test.ts
    - 不 import 既有 contract test：grep -E "from.*audit-contract" tests/integration/audit-envelope.test.ts 必須 exit 1
    - envelope shape 斷言：grep -F "ENTRY_REQUIRED_KEYS" tests/integration/audit-envelope.test.ts
    - tie-break 斷言：grep -F "tie-break" tests/integration/audit-envelope.test.ts
    - 不寫回磁碟斷言：grep -F "CLI-only" tests/integration/audit-envelope.test.ts
    - 至少 5 個 test：grep -cE "^\s*test\(" tests/integration/audit-envelope.test.ts 回 ≥ 5
    - 全部測試通過：bun test tests/integration/audit-envelope.test.ts exit 0
    - audit-contract.test.ts 仍存在且未被改：test -f tests/integration/audit-contract.test.ts && bun test tests/integration/audit-contract.test.ts exit 0
  </acceptance_criteria>
  <done>envelope shape contract 由獨立檔案守住；Phase 22 contract test 完全不動；CLI-only wrapper 性質由「磁碟無 connection 鍵」測試守住；tie-break 由實際資料觸發</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user destructive intent → file deletion | clear 是 Phase 24 唯一 destructive op；agent 在 CI / pipe 環境意外執行的 risk 必須由 D-46 non-TTY rejection 守住 |
| envelope wrapper → disk schema | envelope 為 CLI-only wrapper；若意外寫回磁碟，會污染 Phase 22 鎖定的 entry shape，破壞 agent contract |
| audit.enabled=false → clear behavior | disabled 不阻擋 clear（清歷史是合法操作）；仍要正確報 'Nothing to clear' or 'Cleared N entries' |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-24-01 | T (Audit clear destruction in non-interactive context) | clear non-TTY guard | mitigate | D-46：無 TTY 又無 --yes → exit 1 + stderr requires_tty_or_yes；test 3 守住 |
| T-24-01b | T (Accidental clear via shorter input) | clear confirm parser | mitigate | 只接受 trim().toLowerCase() === 'y' || === 'yes'；空字串/Enter/n/N/no 視為 N；acceptance grep 守住雙條件 |
| T-24-03b | I (Envelope leaking to disk) | envelope CLI-only invariant | mitigate | envelope-test 第 3 case：`audit tail --all` 後檢查磁碟 .jsonl 不含 'connection' 鍵；D-39 wire format 嚴守 CLI-only |
| T-24-07 | E (Self-audit loop via writeAuditEntry on clear) | F decision enforcement | mitigate | clear action 內 zero writeAuditEntry / logger.write；test 6 守住 'no new audit entry written'；avoids audit-on-audit + clear self-contradiction |
| T-24-11 | T (Side-effect on session id) | D-48 enforcement | mitigate | clear 不動 .dbcli/last-session-id；test 7 顯式守住 |
| T-24-12 | E (--all destructive cross-connection) | D-47 enforcement | mitigate | commander 不註冊 --all flag；acceptance grep 守住「sed clear block grep '--all' 必須 exit 1」 |
</threat_model>

<verification>
- bun run typecheck exit 0
- bun test tests/integration/audit-clear.test.ts exit 0
- bun test tests/integration/audit-envelope.test.ts exit 0
- bun test tests/integration/audit-tail.test.ts exit 0（regression：plan 24-03 仍綠）
- bun test tests/integration/audit-show-health.test.ts exit 0（regression：plan 24-04 仍綠）
- bun test tests/integration/audit-contract.test.ts exit 0（Phase 22 contract 未被破壞）
- ! grep -F "not yet implemented" src/commands/audit.ts（4 個 placeholder 全部消失）
- ! grep -E "writeAuditEntry|logger\.write\b" src/commands/audit.ts（F decision 整檔守住）
- bun run release:check（最終 cross-cutting：typecheck / lint --max-warnings=0 / build / 全部 bun test 綠燈）
</verification>

<success_criteria>
- CLI-04 (clear 互動 / --yes / non-TTY / scope) 由整合測試證明
- D-39 envelope CLI-only invariant 由 envelope-test 第 3 case 守住（磁碟無 connection 鍵）
- D-42 tie-break 由 envelope-test 第 2 case 由實際資料觸發
- F decision (audit.ts 整檔 zero writeAuditEntry / logger.write) 由 acceptance + test 雙重守住
- D-48 (clear 不動 last-session-id) 由 explicit test 守住
- Phase 22 audit-contract.test.ts 完全未改（兩個 contract 職責分離）
- Phase 24 全部 6 REQ-IDs 落地：CLI-01..06
</success_criteria>

<output>
After completion, create `.planning/phases/24-audit-cli/24-05-SUMMARY.md` documenting:
- clear action 三條路徑（--yes / TTY confirm / non-TTY reject）的最終 control flow
- D-45 prompt 範例輸出（含實際 file_line 顯示）
- envelope contract test 與 Phase 22 contract test 的職責分工
- D-42 tie-break 由 secondary connection seed 觸發的測試構造
- Phase 24 收尾 verification 清單：所有 4 個 placeholder 消失、F decision 整檔守住、Phase 22 contract 未被觸動、release:check 全綠
- v1.20.0 milestone 接續：Phase 25 (recovery envelope 雙向 audit_ref) 與 Phase 26 (docs / SKILL / feature-matrix) 需 Phase 24 commander surface 落地
</output>
