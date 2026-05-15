# Phase 24: `dbcli audit` CLI - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

把 Phase 21 / 22 / 23 已落地的 audit log 暴露給 agent 與開發者：提供 read-only 的 `tail` / `show` / `health` 與 destructive 的 `clear` 四個子指令，建立 `.dbcli/audit/<connection>.jsonl`（含 rotation `.jsonl.1`）的 reader、merge view 與 commander surface；同時把現有 `AuditLogger.getHealth()` 接到 CLI。

**包含：**
- `audit` commander 子樹（`dbcli audit tail|show|clear|health`）
- `.jsonl` + `.jsonl.1` reader / 跨連線 discovery（`--all`）
- 輸出格式 `table | json`、`--for-agent`、`--brief`（裁剪規則明確化）
- `audit show <id>` UUID + ≥4 碼 prefix + `--recovery-ref <id>` 反查
- `audit clear` 互動確認 + `--yes` + 無 TTY 拒絕路徑
- Capability registry 加 4 個 `audit *` 條目
- 既有 `inspect / recovery / report / guide` 風格的 commander 表面 + i18n 訊息

**不包含（後續 phase）：**
- Recovery envelope 反向新增 `audit_ref` 欄位 → Phase 25（`--recovery-ref` 查詢端在本 phase 落地，envelope 寫端在 25）
- `inspect / recover` 自動引用 recent audit → Phase 25 (DOCS-02)
- SKILL.md 中英雙語完整章節、`docs/feature-matrix.md` audit row、README / CHANGELOG → Phase 26
- Audit log 自我審計（dbcli audit 本身的 entry）→ Planner discretion，目前定為 metadata-only（見下方）

</domain>

<decisions>
## Implementation Decisions

### A. Subcommand 結構與輸出格式

- **D-31:** **`audit` 容器命令 + 4 個子指令**：`dbcli audit tail`、`audit show`、`audit clear`、`audit health`。Commander 結構 mirror 既有 `dbcli queries` 子樹；`dbcli audit --help` 集中顯示所有子指令；不採 flat top-level（會污染 `dbcli --help`）。
- **D-32:** **`--format` 僅支援 `table | json`，三個讀取指令預設都 `table`**。與 `dbcli list` 一致；audit entry 結構簡單，markdown 無價值。`audit clear` 不暴露 `--format`（純動作）。
- **D-33:** **`--for-agent` 與 `--brief` 同時搭載 `tail / show / health`**，沿用 v1.19.1 `inspect / recovery / report / guide` 慣例：
  - `--for-agent` = `--format json --brief` shortcut（一個 flag、agent-facing 一致性）。
  - `tail --brief`：每筆 entry 只保留 `ts / command / target / success`，去掉 `id / session_id / engine / side_effect_tier / recovery_ref / redacted_query / redacted_sql / error / metadata`。
  - `show --brief`：去掉 `metadata` 與 `redacted_query`；保留所有契約必要鍵。
  - `health --brief`：只保留 `enabled / lastWrite / rotationUsage`（去 `lock / lastError / sessionId / rotation`）。
- **D-34:** **`--for-agent` 在 `tail --all` 下仍輸出 envelope** `{connection, entry}`，但 `entry` 內套用 brief 裁剪。不為了 brief 砍掉 envelope（agent 仍需 connection 才能 forensics）。

### B. `audit show <id>` lookup

- **D-35:** **`audit show <id>` 接受完整 UUID 或 ≥4 碼 prefix**。Prefix 命中多筆 → stderr 印 `Ambiguous prefix '<x>': matches <n> entries. Please use a longer prefix.` 並 exit 1。命中 0 筆 → stderr 印 `No audit entry matches '<x>'.` 並 exit 1。命中 1 筆 → 走正常 render path。Prefix < 4 碼 → 直接報 `Prefix must be at least 4 characters.` 並 exit 1（避免 1 碼匹配大量）。
- **D-36:** **`audit show` 預設只查當前連線；`--all` 跨連線搜尋**。`--all` 時匹配檢查跨所有 `.jsonl` + `.jsonl.1`；命中後 envelope output 為 `{connection, entry}`（與 `tail --all` 一致），單筆也維持 envelope（不退回 flat）以保持 shape stable。
- **D-37:** **`audit show --recovery-ref <recovery-id>`**：以 entry.`recovery_ref` 欄位（Phase 22 SCHEMA-01 必要鍵）做精確匹配（非 prefix）；可與 `--all` 組合。在 Phase 24 落地查詢端；Phase 25 才在 recovery envelope 寫入端加 `audit_ref` 反向欄位。多筆命中亦走 ambiguous 路徑（同 D-35 訊息風格，但訊息明示「同一 recovery 對應多 entries」應屬罕見）。
- **D-38:** **`--recovery-ref` 與 `<id>` positional 為互斥**：兩者同時提供 → exit 1 with `Provide either <id> argument or --recovery-ref, not both.`。

### C. `tail --all` 跨連線輸出形狀

- **D-39:** **`tail --all` JSON 輸出為 envelope array** `[{ "connection": "<conn>", "entry": <AuditEntry> }, ...]`。Entry 內部 100% 維持 Phase 22 SCHEMA-01 契約；envelope 為 CLI-only wrapper，不寫入磁碟、不出現在 audit-contract test 之外。
- **D-40:** **單連線 `tail`（無 `--all`）維持 flat array** `[<AuditEntry>, ...]`。對應 CLI-06 "JSON 為扁平陣列，agent 可直接消費"；與 `--all` 形狀差異在 README / SKILL.md 明寫，agent 可由 `--all` flag 判別。
- **D-41:** **`tail` 預設含 rotation `.jsonl.1`**：reader 先讀 `<conn>.jsonl.1`（如存在）再串接 `<conn>.jsonl`，merge 後依 `ts` ascending sort，最後取最後 N 筆（`--n` 預設 10）。Rotation 剛發生時 `--n 1000` 仍能跨越分段。
- **D-42:** **`tail --all` 排序：純 `ts` ascending，latest 在下（D5）；`ts` 相同則 connection 名字典序作 tie-break**。Tie-break 不採 `id`（agent 看不出規則）；不採 insertion order（depends on discovery order，非 deterministic）。
- **D-43:** **`tail --all` table view**：在現有 table 欄位前插入 `connection` 欄；其餘欄位（`ts / command / target / success / recovery_ref?`）與單連線版本一致。Table 欄位順序：`connection? | ts | command | target | tier | success | id (short) | recovery_ref (short)`。
- **D-44:** **`--all` discovery 規則**：對 `.dbcli/audit/*.jsonl` + `*.jsonl.1` 做檔名 glob，去除 `.lock` 與其他非 audit 檔；以 filename minus extension（去掉 `.jsonl[.1]`）為 connection name。

### D. `audit clear` 確認流程 + scope

- **D-45:** **`audit clear` 互動 prompt 顯示完整影響範圍**：
  ```
  About to clear audit log for connection '<conn>':
    .dbcli/audit/<conn>.jsonl       — N entries, X.X MB
    .dbcli/audit/<conn>.jsonl.1     — M entries, Y.Y MB    (若存在)
  Continue? [y/N]
  ```
  Default `N`（按 Enter 不刪）；只有完整輸入 `y` 或 `yes`（case-insensitive）才執行刪除。輸出走 stderr，避免污染 stdout pipe。
- **D-46:** **無 TTY 又無 `--yes` → error exit**：stderr 印 `Cannot prompt for confirmation in non-interactive session. Use --yes to clear without prompt.`，exit code 1。對齊既有 `dbcli delete` 訓練、保護 agent 在 CI / pipe 環境下意外清空 audit。**不** 採 silent skip（surprise）、**不** 採 `--force` 三階段（過複雜）。
- **D-47:** **抹除範圍 = 當前連線的 `.jsonl` + `.jsonl.1`**（兩段都刪、含 lock 檔殘留如有）。`--all` flag **不支援**（destructive op 跨連線擴散風險過高；多連線使用者請 `dbcli use` 切換後逐一 clear）。
- **D-48:** **不重置 `.dbcli/last-session-id`**。Session id 屬「跨 invocation 識別」概念，與 audit log 歷史是不同生命週期；同一 session 後續寫入的 entries 依然延續，僅是「從 0 開始」。
- **D-49:** **`clear` 不寫 audit entry**（自我審計循環避免 — 見 Planner Discretion F）；但成功 / 失敗 / no-op 都 stderr 印一行人類可讀總結：`Cleared N entries from '<conn>'.` / `Nothing to clear.` / `Failed to clear: <message>.`。

### Planner Discretion

以下交由 planner 依 codebase 慣例決定：

- **E. 過濾介面**：Phase 24 **不**新增 `--engine / --command / --failed-only / --since` 等 filter flag；保持 `--n` + `--all` 最小集合。Filter 留給未來 milestone（若 agent 真有痛點再開）。Empty file → JSON `[]`、table 印 `No audit entries.`（stderr）；`audit.enabled = false` → 所有讀指令印 `Audit is disabled (audit.enabled = false in .dbcli). Use 'dbcli audit health' for details.` 並 exit 0（不報錯，與 D1 預設 on 但允許 opt-out 的精神一致）。
- **F. Capability registry 更新（CLI-01..05 落地時統一加）**：
  - `audit tail`、`audit show`、`audit health` → `read-only`
  - `audit clear` → `destructive`
  - **`dbcli audit *` 本身定為 metadata-only**：**不**在這四個子指令呼叫 `writeAuditEntry`（避免 audit-on-audit 噪音、避免 `clear` 自相矛盾、避免 `--all` 跨連線寫 entries 到「哪個」連線）。Planner 確保 `src/cli.ts` 的 audit 樹**不被** Phase 23 整合 helper 觸碰。
- **G. Reader 模組位置**：建議 `src/core/audit/reader.ts`（與 `logger.ts` / `lock.ts` / `rotation.ts` / `session-id.ts` 同層）。Reader 應為 functional module（與 writer 的 class 區隔），介面草案：
  ```ts
  interface ReadOptions { include_rotated?: boolean }
  function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>
  function discoverConnections(auditDir: string): Promise<{ connection: string; files: string[] }[]>
  function tailEntries(entries: AuditEntry[], n: number): AuditEntry[]
  function mergeByTimestamp(byConn: Map<string, AuditEntry[]>): Array<{ connection: string; entry: AuditEntry }>
  ```
  具體型別 / 邏輯細節留 planner，但 reader 必須是 **read-only**、**不持 lock**（讀取與寫入採取最終一致；reader 容忍最後一行未完整 JSON → 跳過並 warn）。
- **H. 測試矩陣**：
  - Unit：reader（含 truncated last line tolerance）、merge sort with tie-break、prefix matcher（含 ambiguous / too-short / no-match）、recovery-ref matcher、clear 的 file unlink。
  - Integration：commander 表面 4 個子指令 happy path + `--all` + `--recovery-ref` + `--yes` + 無 TTY 拒絕 + disabled 顯示。
  - Contract：`tail --all` envelope 結構（單測試 + agent-contract test 風格）；envelope 不污染既有 audit-entry contract test。
- **I. i18n**：`audit.tail.description` / `audit.show.description` / `audit.clear.description` / `audit.health.description` 與相關訊息文字（D-45 prompt、D-46 error、disabled hint）走 `src/i18n/message-loader`，預設中英雙語對齊。
- **J. brief 裁剪實作**：可在 render layer（不在 reader），確保 reader 永遠回完整 entry；agent 對應 contract test 仍以 full entry 驗證。
- **K. `--n` 預設 10**：對齊 ROADMAP success criterion 1 範例 `--n 10`；可由 plan 階段調整但不在本 phase 開 config knob。
- **L. `--n` 最小值與上限**：建議 `1 <= n <= 10000`；超過上限 stderr warn 後 cap，不 error。

### Folded Todos
None — todo backlog 無與 Phase 24 直接相關項目。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone 層級鎖定文件
- `.planning/PROJECT.md` §"Current Milestone: v1.20.0 Agent-Facing Audit Log" — D1–D6 鎖定決策、scope / out-of-scope
- `.planning/REQUIREMENTS.md` — Phase 24 owning CLI-01 / CLI-02 / CLI-03 / CLI-04 / CLI-05 / CLI-06
- `.planning/ROADMAP.md` §"Phase 24: `dbcli audit` CLI" — Goal、Success Criteria（5 條）、Dependencies、Cross-Phase Risks
- `.planning/seeds/v1.20.0-audit-log-milestone.md` — D1–D6 詳細推論

### Phase 21–23 鎖定的契約（Phase 24 MUST 對齊，不得 drift）
- `.planning/phases/21-audit-writer-foundation/21-CONTEXT.md` — `AuditLogger` / `SessionIdService` / `AuditLockManager` / rotation / `.dbcli/audit/` 路徑慣例（D-01..D-16）；`getHealth()` 形狀（21 CONTEXT planner discretion 已預演 Phase 24 wiring）
- `.planning/phases/22-entry-schema-redaction-contract/22-CONTEXT.md` — `AuditEntry` 嚴格介面、redaction 規則、contract test 風格（D-17..D-23）
- `.planning/phases/23-engine-integration-rejection-paths/23-CONTEXT.md` — `writeAuditEntry` helper、target 提取規則、capability tier 動態取得（D-24..D-30）；**Phase 24 子指令明確不採用 helper**（F）

### Phase 24 強制讀取的 codebase 文件
- `src/core/audit/logger.ts` — `AuditLogger`、`AuditHealthReport`、`AuditWriteResult`；`getHealth()` 是 `audit health` 的唯一來源
- `src/core/audit/types.ts` — `AuditEntry` 介面；reader 回傳型別
- `src/core/audit/integration-helper.ts` — `getAuditLogger()` per-connection cache；reader 不重用其寫入路徑，但可借鏡 connection name 解析（`effectiveConnectionName || getGlobalConnectionName() || 'default'`）
- `src/adapters/capabilities.ts` — capability registry；Phase 24 為 4 個 audit 子指令新增條目
- `src/commands/inspect.ts` / `src/commands/recovery.ts` / `src/commands/report.ts` / `src/commands/guide.ts` — `--format` / `--brief` / `--for-agent` commander pattern 與 i18n 用法
- `src/commands/queries.ts` — 子指令容器 pattern (`audit` 子樹的 commander 結構參考)
- `src/commands/list.ts` — `table | json` 雙格式 + `validateFormat` helper 用法
- `src/utils/redaction.ts` — Phase 22 redaction 入口；reader 不重做 redaction（entries 已在 writer 階段 redacted）
- `src/i18n/message-loader.ts` + 既有 locale 檔案 — i18n 慣例
- `src/utils/config-path.ts` + `src/core/config-binding.ts` — `resolveConfigPath()` / `resolveConfigStoragePath()` 是 audit dir / 連線檔名解析的權威來源

### Phase 24 應該不要碰的範圍
- `src/core/audit/logger.ts` 寫入路徑 — 已穩定，不擴充
- `src/core/audit/integration-helper.ts` `writeAuditEntry` 寫入端 — Phase 23 範疇
- `src/core/recovery/last-envelope.ts` — `audit_ref` 反向欄位是 Phase 25 任務；Phase 24 只在 reader 端讀 `recovery_ref`
- `tests/integration/audit-contract.test.ts` — entry shape 已鎖；Phase 24 在 envelope wrapper 上另寫獨立測試，**不**改既有 contract test 的 entry 期望

### Cross-Phase Risks（再次提醒）
- Risk #1（v1.20.0 schema lock-in）：envelope 形狀為 CLI-only，不能讓任何引擎或 Phase 25 寫入端把 envelope shape 帶到磁碟
- Risk #5（audit health 訊號）：Phase 21 已 expose；Phase 24 只做 thin render
- Phase 25 預告：`audit_ref` 欄位將在 recovery envelope schema 出現；Phase 24 的 `--recovery-ref` 查詢端**先行落地**、預先建立 forensics 雙向 affordance

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AuditLogger.getHealth()`（`src/core/audit/logger.ts:193`）** — 直接餵給 `audit health` 的 thin renderer；brief mode 在 render 層做裁剪
- **`getAuditLogger(config, configPath)`（`src/core/audit/integration-helper.ts:21`）** — 取得 per-connection logger；`audit health` 重用以拿正確連線
- **`resolveConfigStoragePath()`（`src/core/config-binding.ts`）** — 解出 audit dir 根目錄（`<storagePath>/.dbcli/audit/`）
- **`validateFormat`（`src/utils/validation.ts`）** — `--format` 驗證；Phase 24 的 ALLOWED_FORMATS = `['table', 'json']`
- **`resolveConfigPath`（`src/utils/config-path.ts`）** — 與其他 commander handler 一致的 config 路徑解析
- **`commander` 子樹模式（`src/commands/queries.ts`）** — `audit` 子樹直接 mirror

### Established Patterns
- **`writeAuditEntry` 寫入路徑**：Phase 23 helper 已穩定；Phase 24 子指令**故意不採用**（F 決策）
- **`inspect/recovery/report/guide` 的 `--format json|markdown` + `--brief` + `--for-agent`** —— 完整 commander 表面；Phase 24 改 `--format table|json` + `--brief` + `--for-agent`（採同 affordance、調整選項集合）
- **i18n `t('<key>')` + `t_vars`** —— 文字訊息走 `src/i18n/message-loader`
- **stderr / stdout 分離** —— `dbcli list` / `dbcli inspect` 已建立慣例：機器可消費走 stdout、人類提示走 stderr。`audit tail/show/health` 沿用；`audit clear` prompt 與總結走 stderr

### Integration Points
- **`src/cli.ts` commander 樹**：在 `program.addCommand(recoveryCommand)` 附近新增 `program.addCommand(auditCommand)`（auditCommand 為內含 4 子指令的 Command 實例）
- **`src/adapters/capabilities.ts`**：為 `audit tail / show / clear / health` 四個 command name 新增 capability rows
- **`src/i18n/locales/**`**：新增 `audit.*` keys（與既有 inspect/recovery 訊息結構同層）

### Phase 24 不會建立的東西
- 任何寫 audit entry 的路徑（Phase 23 結尾；Phase 24 為 read-only + clear）
- Recovery envelope 反向欄位 `audit_ref`（Phase 25）
- SKILL.md / README / CHANGELOG / `feature-matrix.md` 更新（Phase 26）

</code_context>

<specifics>
## Specific Ideas

- **`audit tail` 預設 invocation 範例**：
  ```bash
  $ dbcli audit tail
  # Reads .dbcli/audit/<current-conn>.jsonl.1 (if exists) + .dbcli/audit/<current-conn>.jsonl
  # Output: table, last 10 entries, latest at bottom

  $ dbcli audit tail --n 50 --all --for-agent
  # Output: JSON envelope array [{connection, entry: <brief entry>}, ...]
  ```

- **`audit show` 範例**：
  ```bash
  $ dbcli audit show 5f3a8b2c
  # Reads only current connection, prefix match, exits 1 if ambiguous

  $ dbcli audit show 5f3a8b2c --all
  # Searches all .jsonl + .jsonl.1 across connections; output: {connection, entry}

  $ dbcli audit show --recovery-ref a1b2c3d4-...
  # Exact match on entry.recovery_ref in current connection
  ```

- **`audit clear` interactive prompt 草案**：
  ```
  $ dbcli audit clear
  About to clear audit log for connection 'production':
    .dbcli/audit/production.jsonl       — 847 entries, 2.3 MB
    .dbcli/audit/production.jsonl.1     — 1000 entries, 9.8 MB
  Continue? [y/N] _
  ```

- **`audit health` 草案輸出**（table）：
  ```
  Enabled:        true
  File:           /Users/.../.dbcli/audit/production.jsonl
  Size:           2.3 MB / 10 MB (23%)
  Entries:        847 / 1000 (85%)
  Lock:           free
  Last write:     2026-05-15T10:42:18Z (success)
  Last error:     —
  Session id:     87421-1747234567890-a4f2b8
  Last rotation:  2026-05-14T08:12:03Z (.jsonl.1)
  ```

- **Reader truncation tolerance**：crash 時最後一行可能不完整（D-08 不 fsync）。Reader 對 `JSON.parse` 失敗的最後一行 → stderr warn `[dbcli audit] skipping truncated last line in <file>` 並排除該筆。中間出現非 JSON 行視為檔案受損 → exit 1 並指向 `dbcli audit clear`。

- **`audit tail` 表格欄位寬度**：`id` 與 `recovery_ref` 取前 8 碼顯示；JSON 維持完整 UUID。

- **`--for-agent` 與 `--brief` 互動**：`--for-agent` 自動含 `--brief`；同時提供 `--for-agent --no-brief`（commander negate flag）允許 agent override。

</specifics>

<deferred>
## Deferred Ideas

下列概念在討論中浮現但屬於其他 phase / milestone 或 explicit defer：

- **過濾 flag（`--engine` / `--command` / `--failed-only` / `--since`）** → Phase 24 不做；未來 milestone 視 agent 痛點再開
- **`audit clear --all`（跨連線抹除）** → 不採（D-47）
- **`audit clear` 自動寫 audit entry（self-audit）** → 不採（F 決策；避免循環與語意衝突）
- **Recovery envelope 反向 `audit_ref` 欄位寫入** → Phase 25 (INTEGRATE-02 / -03)
- **`inspect` / `recover` agent guide 自動引用 recent audit** → Phase 25 (DOCS-02)
- **SKILL.md 中英雙語 Audit Log 章節 / feature-matrix.md audit row / README CHANGELOG** → Phase 26 (DOCS-01 / -03 / -04)
- **Tamper-evident / signed audit log** → Out of scope (compliance roadmap)
- **`audit resource <table>` 二級資源索引** → seed `.planning/seeds/conflict-avoidance-resource-index.md`
- **`audit verify <id>` 自動對照 query 驗證** → seed `.planning/seeds/self-verification-correlation.md`
- **`--n` 上限超過時 error vs cap** → 採 cap + warn（L 已決定）；之後若有真實上限需求再升級為 error
- **`audit show` 負索引（`-1` = 最近）** → 未採（B1 選 prefix）；agent 可以用 `audit tail --n 1` 達成

### Reviewed Todos (not folded)
None — todo backlog 中沒有與 Phase 24 直接相關項目被 cross-reference。

</deferred>

---

*Phase: 24-audit-cli*
*Context gathered: 2026-05-15*
