# Phase 25: Recovery Envelope Bi-directional Linkage - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

把 v1.20.0 audit log 與 v1.17.0 recovery envelope 串成雙向 ref：

- **正向：** Command 失敗時，audit entry 的 `recovery_ref` 帶 envelope-level UUID。
- **反向：** 同次失敗寫入的 `SavedRecoveryEnvelope` 帶 `audit_ref`，指回觸發它的 audit entry id。
- **DOCS-02：** `inspect` / `guide` / `recover` / `recover --apply` 在 agent-facing JSON 路徑自動嵌入 `audit_recent`（last N entries, brief shape）。

**包含：**
- `SavedRecoveryEnvelope` schema 新增 `id` (UUID) 與 `audit_ref?` 兩個 optional 欄位（`schemaVersion=1` 不動）。
- `emitRecoveryEnvelope()` 入口統一 pre-generate envelope id；catch 區塊改成「先 await `writeAuditEntry({...recovery_ref: id})` 再 `emitRecoveryEnvelope(...)`」。
- Recovery envelope 寫入端把 `audit_ref` 填入 saved file（best-effort；audit disabled / 寫入失敗就保持 undefined）。
- inspect / guide / recover / recover --apply 四個指令在 `--for-agent`（或 `--format json + --brief`）路徑加 `audit_recent: AuditEntry[]`，N=5。
- Contract test：envelope round-trip（audit_ref ↔ recovery_ref 對得上）、inspect / guide / recover JSON 含 `audit_recent` 欄位。
- 舊 envelope（無 id / audit_ref）`recover --from` 照常接受。

**不包含（後續 phase）：**
- SKILL.md 中英雙語 Audit Log 章節、`docs/feature-matrix.md` audit row、README / CHANGELOG → Phase 26 (DOCS-01 / -03 / -04)
- 新增 audit CLI 子指令 → 不擴充（Phase 24 已封樹）
- 新增引擎整合 / engine hook → Phase 23 範圍已完
- 引入 hash-chain / tamper-evident → Out of scope (compliance roadmap)

</domain>

<decisions>
## Implementation Decisions

### A. recovery_ref / audit_ref 值的形狀（雙向 ref 的結構）

- **D-50:** **`SavedRecoveryEnvelope` wrapper 加 `id: string`（UUID v4）**。`AuditEntry.recovery_ref` 與這個 id 對齊。沒有第二種「path」表示法、沒有 compound shape；單一 UUID 為 source of truth。Phase 24 `audit show --recovery-ref` 的 exact-match 邏輯（D-37）直接 reuse、不需任何修改。
- **D-51:** **envelope id 由 `emitRecoveryEnvelope()` 入口統一 pre-generate**（`crypto.randomUUID()`）。同一個 id 同步傳遞給 `writeAuditEntry`（catch 區塊內先 await）與 `writeLastEnvelopeSync`（envelope 寫入路徑）。**不**重構 sync write、**不**依賴 emit 回傳值，因此 `process.exit()` 仍維持原行為。D6 保留：audit 寫入失敗只警告、envelope 寫入失敗只警告。
- **D-52:** **id 與 audit_ref 都加在 `SavedRecoveryEnvelope` wrapper，不動 `RecoveryEnvelope` 本體**。
  - `RECOVERY_SCHEMA_VERSION = 1` 不動，`stdout` 印出的 envelope JSON shape 不變（agent 既有 client 不破）。
  - `SavedRecoveryEnvelope.schemaVersion = 1` 也不動，新欄位 optional。
  - 語意一致：「某次寫入狀態 / 某次失敗事件」屬 wrapper 職責；「錯誤本身」屬 envelope 職責。
- **D-53:** **`audit_ref?: string`（optional）走 wrapper 同層**。D6 邊界硬約束：
  - audit 寫入成功 → `audit_ref` = audit entry UUID
  - audit disabled (`audit.enabled=false`) → `audit_ref` 不填
  - audit 寫入失敗（lock budget / 權限 / rotation 卡住）→ `audit_ref` 不填（best-effort，保留 envelope 寫入）
  - envelope 寫入失敗本身依舊只警告（emit.ts `try/catch` 既有行為）
- **D-54:** **舊 envelope backward compatibility**：`parseSavedRecoveryEnvelope`（zod）把 id / audit_ref 設為 optional；`recover --from` 載入舊檔（沒這兩個欄位）照常接受、不報 malformed。Recovery envelope 是 ephemeral（單檔、每次失敗覆蓋），不做 migration ceremony。
- **D-55:** **`audit show --recovery-ref <id>` 在交隊期查不到時走 Phase 24 既有行為**：stderr「No audit entry matches '<x>'.」並 exit 1（D-37 風格）。Phase 25 **不**為「舊 entry 無 recovery_ref」寫專屬 fallback / path-match 邏輯；audit log 上線初期重置即可，不在 production 流量內。

### B. DOCS-02 — inspect / guide / recover / recover --apply 嵌入 recent audit

- **D-56:** **`audit_recent: AuditEntryBrief[]` 嵌入四個指令的 agent 路徑**：
  1. `dbcli inspect` snapshot JSON
  2. `dbcli guide <goal>` JSON
  3. `dbcli recover`（讀 last-recovery.json）envelope 輸出
  4. `dbcli recover --apply` 結果 JSON
  全部四個都帶；recover 與 recover --apply 對 INTEGRATE-02/03 的 forensics 路徑最關鍵，inspect 與 guide 補足 session handoff / advice 場景。
- **D-57:** **觸發條件 = agent-facing 路徑**：只有 `--for-agent`（= `--format json --brief`）或顯式 `--format json` 路徑帶。Human markdown 輸出不變、`--format json` 但無 `--brief` 也帶。**不**開 `--with-audit` 旗標、**不**永遠帶（避免 human 使用者吵嘈）。實作上 brief / for-agent 旗標已存在於四個指令的 commander 表面，直接 reuse。
- **D-58:** **預設 N=5**。與 Phase 24 `audit tail` 預設 10 區隔開：N=5 是「hand-off context」，N=10 是「browsable history」。**不**對外開 config knob、**不**支援 `--audit-n=<N>`；planner 把 N 寫成模組常數即可（未來真有痛點再 promote 成 flag）。
- **D-59:** **個體 shape 沿用 Phase 24 `tail --brief` 形狀**：`{ ts, command, target, success }`，加上 `id`（讓 agent 能 client-side join 到 envelope.audit_ref / recovery_ref）。**禁止** 帶 `redacted_query` / `redacted_sql` / `metadata` / `session_id` / `engine` / `side_effect_tier`（否則 brief JSON 暴漲、agent 拿到不一致的 entry shape）。實作位置在 render layer（reader 仍回完整 entry，brief 在輸出層裁剪 — Phase 24 J 同模式）。
- **D-60:** **disabled / empty / unavailable 三狀態全部回 `audit_recent: []`**（空陣列）。Shape stable，agent 用 `length === 0` 判斷即可。**不**加 `audit_status` 欄位（那是 `audit health` 的職責，inspect / guide 不重複 surface）。
- **D-61:** **不標 `is_origin`**：recent entries 不為「跟本次 envelope 同 audit_ref 的 entry」做特別標註。`envelope.audit_ref` 本身已是 cross-ref 來源；agent 在 client side `entry.id === envelope.audit_ref` 即可定位「犯人」entry。

### Planner Discretion

以下交給 planner / researcher 依 codebase 慣例決定，**不必**回頭問用戶：

- **E. Contract test 範圍與 release-blocking 與否**：建議走 `tests/integration/recovery-audit-link.test.ts`（與 `audit-contract.test.ts`、Phase 24 envelope test 同一檔案系列），測試：
  1. 失敗指令 → audit entry 存在且 `recovery_ref` 不為空 → `SavedRecoveryEnvelope.id` 同值
  2. `SavedRecoveryEnvelope.audit_ref` 不為空 → 對應 audit entry 的 `id` 同值
  3. inspect / guide / recover / recover --apply 在 `--for-agent` 下 JSON 含 `audit_recent: []` 或 `audit_recent: [{...}]`
  4. 舊 envelope（無 id / audit_ref）`recover --from` 照常接受
  - 上述 (1)(2) 為 release-blocking（與 Phase 22 audit-contract 風格一致）；(3)(4) 為 standard integration test。
- **F. `recover --apply` 自己的 audit 寫入**：對齊 Phase 24 F 決策的精神 — `dbcli recover *` **不**走 `writeAuditEntry`（避免「為了 recovery 寫 audit、然後 audit 失敗又 emit envelope」的循環語意）。`recover --apply` 執行**被恢復的指令本身**仍會走那個指令既有的 `writeAuditEntry` 路徑（因為它本來就接 audit）；recover 指令本體不額外寫 audit。**例外**：如果 planner 覺得 `recover --apply` 整體成敗應該被記錄，可以在 `apply.ts` 主流程結尾加一筆 `command: 'recover'` 的 audit entry，但這不是 INTEGRATE-02/03 範圍，planner 可選擇 defer 給未來 phase。
- **G. inspect snapshot 型別新增 `audit_recent` 的擺位**：建議放在 `InspectSnapshot` 介面的尾部（與 `snippets` / `schemaCache` 同層）。型別名稱建議 `RecentAuditEntry` 或 `AuditEntryBrief`；planner 與 Phase 22 audit types 對齊。
- **H. Reader 重用**：`audit_recent` 嵌入用 Phase 24 已落地的 `readEntries` + `tailEntries`（`src/core/audit/reader.ts`），只讀**當前連線**（不跨連線 `--all`）。reader 是 read-only、不持 lock，inspect / guide / recover 直接呼叫即可。出錯（檔案損毀、目錄不存在）一律 fall through 為 `[]`，不報錯（DOCS-02 不應該擋住 inspect / guide / recover 本身）。
- **I. envelope id 生成位置**：建議直接寫在 `emit.ts` `emitRecoveryEnvelope()` 函式進入點（在 `classifyError` 之後、`writeLastEnvelopeSync` 之前），不需要新增獨立 service。Inline `crypto.randomUUID()`。
- **J. catch 區塊 audit ↔ envelope 順序**：以 `inspect.ts` 為樣本：
  ```ts
  } catch (err) {
    const envelopeId = crypto.randomUUID()
    if (config) {
      await writeAuditEntry(config, 'inspect', options, {
        success: false,
        target: '*',
        error: err,
        recovery_ref: envelopeId,   // ← Phase 25 新增
      })
    }
    if (options.recovery === true) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(err, { operation: 'inspect' }, { envelopeId })
      //                                                    ^ Phase 25 新增
    }
    // ...
  }
  ```
  其他 catch 區塊（delete / export / insert / q / query / schema / update）走同樣模式。`writeAuditEntry` 的 `AuditOutcome` 介面需要新增 `recovery_ref?: string`（讓 helper 把它放進 entry）。
- **K. `audit_ref` 對 envelope 寫入端**：`writeLastEnvelope` 與 `writeLastEnvelopeSync` 都要接受 `auditRef?: string` 參數（由 caller 拿到 audit entry id 後傳入）。因為 D-51 走 pre-generate envelope id 路線，caller 拿不到 audit entry id（audit entry 寫入是 fire-and-forget 從 caller 角度）：解法是 `writeAuditEntry` 改成回傳該筆 entry 的 `id`（或 `null` 表示失敗 / disabled），caller 拿到後傳給 `emitRecoveryEnvelope`。實作細節由 planner 決定，但這是 Phase 25 hand-off 必須面對的訊息流。
- **L. i18n / messages 不必新增**：DOCS-02 帶的是 JSON 結構，不出文字訊息給 human 路徑；i18n 不需要動。
- **M. Phase 21–24 既有測試影響評估**：
  - audit-contract.test.ts：entry shape 不變（`recovery_ref` 早已開欄），不需動。
  - Phase 24 audit show --recovery-ref 既有測試：邏輯不變，但測試 fixture 需要更新成「UUID-style recovery_ref」而不是 placeholder 字串，避免測試假象成功。
  - emit-envelope 既有測試：parser backward compat 必須有新測試覆蓋（D-54）。

### Folded Todos
None — todo backlog 中沒有與 Phase 25 直接相關項目被 cross-reference。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone 層級鎖定文件
- `.planning/PROJECT.md` §"Current Milestone: v1.20.0 Agent-Facing Audit Log" — D1–D6 鎖定決策、scope / out-of-scope
- `.planning/REQUIREMENTS.md` — Phase 25 owning INTEGRATE-02 / INTEGRATE-03 / DOCS-02
- `.planning/ROADMAP.md` §"Phase 25: Recovery Envelope Bi-directional Linkage" — Goal、Success Criteria（4 條）、Dependencies、Cross-Phase Risks
- `.planning/seeds/v1.20.0-audit-log-milestone.md` — D1–D6 詳細推論、P5 段落（recovery 雙向連結）

### Phase 21–24 鎖定的契約（Phase 25 MUST 對齊，不得 drift）
- `.planning/phases/21-audit-writer-foundation/21-CONTEXT.md` — `AuditLogger` / `SessionIdService` / `AuditLockManager` / `audit.enabled` 開關
- `.planning/phases/22-entry-schema-redaction-contract/22-CONTEXT.md` — `AuditEntry` 嚴格 schema（`recovery_ref?: string` 早已開欄、D-17）；Phase 25 只是把這個欄位填上
- `.planning/phases/23-engine-integration-rejection-paths/23-CONTEXT.md` — `writeAuditEntry` helper、catch block 慣例；Phase 25 的雙向欄位增補必須由這個 helper 介面承擔（D-J / D-K）
- `.planning/phases/24-audit-cli/24-CONTEXT.md` — `audit show --recovery-ref` exact-match (D-37)；reader (`readEntries` / `tailEntries`) read-only API；F 決策（audit 子指令不走 writeAuditEntry，Phase 25 對 `recover` 比照辦理）；brief shape（D-33）為 DOCS-02 audit_recent 形狀來源

### Phase 25 強制讀取的 codebase 文件
- `src/core/recovery/last-envelope.ts` — `writeLastEnvelope` / `LAST_ENVELOPE_PATH`；Phase 25 在 wrapper 加 `id` / `audit_ref` 的 async 寫入路徑
- `src/core/recovery/emit.ts` — `emitRecoveryEnvelope` / `writeLastEnvelopeSync`（envelope id pre-generate 位置，D-51 / I）
- `src/core/recovery/envelope-schema.ts` — `parseSavedRecoveryEnvelope` zod schema；id / audit_ref 加 optional（D-54）
- `src/core/recovery/types.ts` — `RecoveryEnvelope` 介面 + `RECOVERY_SCHEMA_VERSION`；**Phase 25 不動**（D-52）
- `src/core/recovery/apply-types.ts` — `SavedRecoveryEnvelope` 介面；id / audit_ref 加在這裡
- `src/core/audit/types.ts` — `AuditEntry.recovery_ref?: string` 已開欄；Phase 25 不動 schema
- `src/core/audit/integration-helper.ts` — `writeAuditEntry` 介面；需要 (1) 接受 `recovery_ref` (2) 回傳 entry id 讓 caller 傳給 envelope（D-J / D-K）
- `src/core/audit/reader.ts` — Phase 24 落地的 read-only reader；DOCS-02 直接 reuse（H）
- `src/commands/inspect.ts` / `src/commands/guide.ts` / `src/commands/recover.ts` — DOCS-02 嵌入點；catch block 修改範本（J）
- `src/commands/delete.ts` / `src/commands/export.ts` / `src/commands/insert.ts` / `src/commands/q.ts` / `src/commands/query.ts` / `src/commands/schema.ts` / `src/commands/update.ts` — 雙向 ref 注入點（每個 catch block 都要走 D-J 模式）
- `src/core/inspect/types.ts` (`InspectSnapshot`) — 加 `audit_recent` 欄位的型別（G）
- `src/core/guide/types.ts` — guide 對應型別
- `src/core/recovery/render-json.ts` / `next-render-json.ts` / `apply-render-json.ts` — recover / recover --apply JSON render 注入 audit_recent 的位置
- `tests/integration/audit-contract.test.ts` — 既有 entry contract test；不破壞但會新增姊妹檔（E）
- `tests/integration/audit-envelope.test.ts` — Phase 24 envelope contract；Phase 25 將新增類似檔案 `recovery-audit-link.test.ts`

### Phase 25 應該不要碰的範圍
- `AuditEntry` 介面（Phase 22 已鎖；`recovery_ref` 開欄即可填）
- `RecoveryEnvelope` 本體 / `RECOVERY_SCHEMA_VERSION`（D-52 明示）
- audit log 寫入端（logger.ts / lock.ts / rotation.ts / session-id.ts）— Phase 21 範圍已穩定
- `audit *` 子指令樹（Phase 24 F 鎖定，不寫 audit；本 phase 也不擴 CLI）
- `tests/helpers/sensitive-output.ts` redaction 規則 — Phase 22 鎖定

### Cross-Phase Risks
- Risk #2（redaction single-source）：DOCS-02 嵌入 `audit_recent` 直接讀 reader 回來的 entries（writer 階段已 redacted），**不**在 inspect/guide/recover render 層再做一次 redaction
- Risk #5（audit health 是 audit disabled 的官方 surface）：inspect / guide / recover 不在 `audit_recent: []` 時印警告，請走 `audit health` 看細節
- 預告 Phase 26：CHANGELOG / README 要明寫「inspect / guide / recover 的 `--for-agent` JSON 新增 `audit_recent` 欄位」（agent 取向使用者要知道有新欄位，但 shape stable 故不算 breaking）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`emitRecoveryEnvelope()` (src/core/recovery/emit.ts:22)** — 唯一 envelope 寫入入口；id pre-generate 寫在這裡
- **`writeLastEnvelopeSync` (src/core/recovery/emit.ts:41)** — sync write 路徑；caller 傳入 id / audit_ref，本函式只負責序列化
- **`writeLastEnvelope` (src/core/recovery/last-envelope.ts:63)** — async 對應版本（測試 / 非 emit 路徑用）；同 signature 加 id / audit_ref
- **`parseSavedRecoveryEnvelope` (src/core/recovery/envelope-schema.ts)** — zod parser；新欄位 optional 加在這裡
- **`writeAuditEntry` (src/core/audit/integration-helper.ts:65)** — 共用 helper；介面升級接受 `recovery_ref` 並回傳 entry id（D-J/K）
- **`readEntries` / `tailEntries` (src/core/audit/reader.ts)** — Phase 24 落地的 read-only reader；DOCS-02 嵌入只需 caller 呼叫即可（H）
- **`crypto.randomUUID()`** — Node 內建；envelope id / audit entry id 同一來源

### Established Patterns
- **catch → writeAuditEntry → emitRecoveryEnvelope（最後 exit）** — 既有所有 db-touching 指令都是這個順序（inspect.ts:68-83 為樣本）。Phase 25 只在 audit / emit 之間加一個 envelope id pre-generate 與透傳
- **`--for-agent` = `--format json --brief` shortcut** — inspect / guide / recover / recover --apply 四指令都已支援；DOCS-02 reuse 同 affordance
- **`SavedRecoveryEnvelope` wrapper vs `RecoveryEnvelope` 本體** — 明確分層；wrapper 紀錄「該次寫入發生的事」（savedAt / command / cwd），envelope 紀錄「錯誤本身與恢復計畫」。新欄位（id / audit_ref）天然屬於 wrapper（D-52）
- **D6（audit 寫入失敗只警告）** — `writeAuditEntry` 內部已 try/catch；Phase 25 不破壞，但 caller 拿到 entry id 為 null/undefined 時要正確傳給 envelope（envelope.audit_ref = undefined）

### Integration Points
- **`SavedRecoveryEnvelope` 介面（apply-types.ts:94-101）** — 加 `id` / `audit_ref?`
- **`AuditOutcome` 介面（integration-helper.ts:53-59）** — 加 `recovery_ref?: string`
- **`writeAuditEntry` 回傳值** — 從 `Promise<void>` 改成 `Promise<string | null>`（entry id 或 null）
- **`emitRecoveryEnvelope` 簽章** — 加 `EmitOptions.envelopeId?: string` 與 `EmitOptions.auditRef?: string`（若 envelopeId 未傳則自行生成；保留簡單呼叫）
- **`InspectSnapshot` / `GuideOutput` / `RecoveryEnvelopeOutput` / `ApplyResult` JSON render 層** — 加 `audit_recent` 欄位（render-only、不入 saved 檔）

### Phase 25 不會建立的東西
- 新 audit CLI 子指令（Phase 24 已封樹）
- 新 commander 指令（recover --apply 已存在）
- 新 i18n key（DOCS-02 是 JSON 結構，不出文字）
- engine-side hook（Phase 23 範圍已穩定）

</code_context>

<specifics>
## Specific Ideas

- **envelope id 範例**：`crypto.randomUUID()` 產出形如 `f47ac10b-58cc-4372-a567-0e02b2c3d479`；`recovery_ref` 與 `audit_ref` 都直接存這個字串。
- **DOCS-02 audit_recent entry 範例**：
  ```json
  {
    "audit_recent": [
      { "id": "f47a...", "ts": "2026-05-15T10:42:18Z", "command": "query", "target": "users", "success": true },
      { "id": "8b3c...", "ts": "2026-05-15T10:42:30Z", "command": "update", "target": "users", "success": false }
    ]
  }
  ```
- **`SavedRecoveryEnvelope` 新形狀草案**：
  ```ts
  interface SavedRecoveryEnvelope {
    schemaVersion: 1
    id?: string          // ← Phase 25 新增 (UUID v4)
    audit_ref?: string   // ← Phase 25 新增 (audit entry UUID)
    savedAt: string
    command: string
    cwd: string
    envelope: RecoveryEnvelope
  }
  ```
- **`writeAuditEntry` 簽章升級草案**：
  ```ts
  export interface AuditOutcome {
    success: boolean
    error?: any
    metadata?: Record<string, unknown>
    sql?: string
    target?: string
    recovery_ref?: string   // ← Phase 25
  }
  export async function writeAuditEntry(
    config, commandName, options, outcome
  ): Promise<string | null>   // ← 回傳 entry id 或 null（disabled / failed）
  ```
- **catch block patch 範本（inspect.ts）**：
  ```ts
  } catch (err) {
    let auditId: string | null = null
    let envelopeId: string | undefined
    if (options.recovery === true) {
      envelopeId = crypto.randomUUID()
    }
    if (config) {
      auditId = await writeAuditEntry(config, 'inspect', options, {
        success: false,
        target: '*',
        error: err,
        ...(envelopeId && { recovery_ref: envelopeId }),
      })
    }
    if (envelopeId !== undefined) {
      const { emitRecoveryEnvelope } = await import('@/core/recovery')
      emitRecoveryEnvelope(err, { operation: 'inspect' }, {
        envelopeId,
        auditRef: auditId ?? undefined,
      })
    }
    // ...
  }
  ```
- **DOCS-02 觸發條件判斷統一函式**：建議在 `src/core/audit/recent.ts` 加：
  ```ts
  function shouldEmbedRecent(opts: { forAgent?: boolean; format: string; brief: boolean }): boolean {
    return opts.forAgent === true || opts.format === 'json'
  }
  async function loadRecentAudit(config, configPath, n = 5): Promise<AuditEntryBrief[]> { /* ... */ }
  ```
  inspect / guide / recover / recover --apply 都呼叫這個 helper。

</specifics>

<deferred>
## Deferred Ideas

下列概念在討論中浮現但屬於其他 phase / milestone 或 explicit defer：

- **`--audit-n=<N>` flag（讓 agent 改 recent audit 筆數）** → 不採（D-58）；N=5 寫死，未來真有痛點再 promote
- **`audit_status` 欄位（disabled / unavailable / empty 區分）** → 不採（D-60）；audit health 才是 status 的官方 surface
- **`recent[i].is_origin` 標註** → 不採（D-61）；client side join 解決
- **`recovery_ref` 同時帶 path + id（compound）** → 不採（D-50 / A1 否定）
- **`RECOVERY_SCHEMA_VERSION` bump 1→2** → 不採（D-52）；新欄位走 wrapper 不動 envelope 本體
- **`SavedRecoveryEnvelope.schemaVersion` bump 1→2** → 不採（B1）；optional 加欄
- **`audit show --recovery-ref` path fallback** → 不採（D-55）；交隊期不寫專屬邏輯
- **`recover --apply` 自己寫 audit entry** → 暫不做（F）；對齊 Phase 24 F 精神；被恢復的指令本身依然走原有 audit 路徑
- **SKILL.md 中英雙語 Audit Log 章節 / feature-matrix.md audit row / CHANGELOG** → Phase 26 (DOCS-01 / -03 / -04)
- **Tamper-evident / hash-chain / signed audit log** → Out of scope (compliance roadmap)
- **`audit resource <table>` 二級資源索引** → seed `.planning/seeds/conflict-avoidance-resource-index.md`
- **`audit verify <id>` 自動對照 query 驗證** → seed `.planning/seeds/self-verification-correlation.md`

### Reviewed Todos (not folded)
None — todo backlog 中沒有與 Phase 25 直接相關項目被 cross-reference。

</deferred>

---

## Scope Addendum — L1 lock (2026-05-15, post-research)

`25-RESEARCH.md` 揭示 13 個 `emitRecoveryEnvelope` 呼叫點裡有 **6 個**（`insert` / `update` / `delete` / `export` / `q` / `schema`）今天**沒有**配對的 `writeAuditEntry` 呼叫 — 此為 Phase 23 PARTIAL 已記錄的延後項目（見 `.planning/phases/23-engine-integration-rejection-paths/23-VERIFICATION.md`）。

**選定 J1 — 只連已有 audit hook 的命令面，asymmetry 文件化：**

- Phase 25 只在「Phase 23 已 wire `writeAuditEntry`」的 catch block 加 `recovery_ref` / `audit_ref` 雙向鏈接。
- 對應的 wired surface（依 RESEARCH 的 13-site map 確認）：`query` + `inspect` + `guide` + 其餘 Phase 23 已 wire 的 audit-side command。
- 6 個未 wire 的 command（`insert` / `update` / `delete` / `export` / `q` / `schema`）**不在 Phase 25 範圍**；它們的 `emitRecoveryEnvelope` 呼叫繼續存在但只產出單向 envelope（無 `audit_ref`）。
- DOCS-02（`audit_recent` 嵌入 `inspect` / `guide` / `recover` / `recover --apply` 的 JSON output）**不受** J1 限制 — DOCS-02 是「列出最近 5 筆 audit」，與該指令本身是否寫 audit 無關，4 個指令全做。

**Supersedes：** 本 CONTEXT.md `<canonical_refs>` 區 `Phase 25 強制讀取的 codebase 文件` 列表（line 138 附近）把 `delete.ts / export.ts / insert.ts / q.ts / query.ts / schema.ts / update.ts` 全列為「雙向 ref 注入點」。**Post-research 真實情況**：該列表 7 個檔案中只有 `query.ts` 為 J1 範圍；其餘 6 個 catch block 留待 Phase 23-04 follow-up，**Phase 25 plans 不應修改**。

**Planner 必須交付的副產品（為 J1 兜底）：**

1. **J1 coverage matrix** — 一張表列出「哪些 command 有完整雙向鏈、哪些只有單向 envelope、哪些都沒有」，作為 Phase 25 SUMMARY 的明確章節。
2. **Contract test 二維覆蓋** — (a) wired surface 雙向鏈一定對得上；(b) 未 wire surface 不會 false-positive 出 `audit_ref`（envelope 寫入時 `audit_ref` 必為 `undefined`，不為 `null` 也不為空字串）。
3. **Follow-up 記錄** — 在 `<deferred>` 區加 `Phase 23-04 — wire writeAuditEntry into insert/update/delete/export/q/schema` 條目（或 cross-reference ROADMAP backlog 既有 entry），明確 Phase 25 ship 後 6 個 command 的 envelope→audit 反向鏈仍缺。

---

*Phase: 25-recovery-envelope-bi-directional-linkage*
*Context gathered: 2026-05-15 (scope locked 2026-05-15 post-research)*
