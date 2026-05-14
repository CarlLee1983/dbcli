# Phase 21: Audit Writer Foundation - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

建立 dbcli 內部的 audit writer 基礎建設層：可開關的 `AuditLogger` service、`SessionIdService`、audit 專用 file lock、JSONL append-only writer、rotation、以及 `.dbcli` `audit.*` config schema 與升級補欄位。

**包含：** Writer 服務、session-id 服務、file lock 子系統、rotation、`audit.*` config schema 與 migration、寫入失敗的 D6 行為、`audit health` 所需的 introspection API（讓 Phase 24 直接 wire CLI）。

**不包含（後續 phase）：**
- Entry JSON 合約鎖定 / contract test / redaction 規則 → Phase 22
- 將 writer 接到任何引擎（PostgreSQL / MySQL / MariaDB / MongoDB / Redis / Elasticsearch）→ Phase 23
- `dbcli audit` CLI 子指令（tail / show / clear / health 表面）→ Phase 24
- Recovery envelope 雙向連結 → Phase 25
- SKILL.md / README / CHANGELOG → Phase 26

Phase 21 完成後：dbcli 內部具備一個「沒被任何引擎呼叫但功能完整」的 audit writer，後續 phase 只要 wire entry shape 與引擎呼叫。

</domain>

<decisions>
## Implementation Decisions

### A. Writer 模組與 API 表面
- **D-01:** `AuditLogger` 放在 `src/core/audit/`，與 `src/core/recovery/`、`inspect/`、`guide/`、`saved-queries/` 同層。`audit-log` 變體不採用（短名足以辨識，且 milestone 內部一律稱 "audit"）。
- **D-02:** `AuditLogger` 設計為 **class 實例**（長活、含狀態）。一個 process 一個 instance；instance 內部持有 session_id 快取、lock handle、rotation counter、last-write 結果、sticky last-error。風格對齊既有 `ConcurrentLockManager` / `SchemaWriter`，是 Phase 24 `audit health` introspection 的天然容器。
- **D-03:** 公開 API 為 **async `await logger.write(entry)`**：引擎在拿回結果並準備輸出之前 `await` 寫入（成功 or 警告 fall-through）。不採用 background queue（與 Phase 25 失敗時的 `recovery_ref` 因果順序衝突）、亦不採同步 blocking write。
- **D-04:** `SessionIdService` 為**獨立模組**（`src/core/audit/session-id.ts`），不嵌死在 `AuditLogger`。優先順序：`process.env.DBCLI_SESSION_ID` → `.dbcli/last-session-id`（PID 對得上就重用）→ 自動生成 `<pid>-<unix-ts>-<random>` 並寫回。`AuditLogger` 透過建構子注入 `SessionIdService`，方便 Phase 25 之後其他模組（如 recovery）共用。

### B. File Lock + Atomic Write
- **D-05:** 新增 **audit-tuned `AuditLockManager`** 類別於 `src/core/audit/lock.ts`，**不直接 reuse** `ConcurrentLockManager`（後者 30s timeout + 10–500ms backoff 為 schema write 設計，對高頻 audit 過重）。新類別參考既有實作的 lockfile 模式，但採短 retry budget 與 stale 偵測。
- **D-06:** **Lock 粒度為「每個 audit 檔一把鎖」**：`.dbcli/audit/<connection>.jsonl.lock`。不同連線之間並行寫入 100% 獨立，呼應 D4「每連線一檔」的單純性。
- **D-07:** **Lock retry 預算約 200ms**（可由內部常數調整，未對外開放 config）。超過預算仍拿不到 lock → 走 D6：stderr 警告 + 跳過該筆 entry + 更新 sticky last-error。**不阻擋主指令**。
- **D-08:** **Append 後 flush，不 fsync**（含 rotation 邊界亦無強制 fsync）。Crash 時最後幾筆 entry 可能遺失，被視為可接受的 observability 代價（audit 不是合規 audit log）。每筆 entry 寫入透過 `O_APPEND + write` 完整單行，避免行內中斷。

### C. Rotation 檔名與保留策略
- **D-09:** **單一滾動舊檔**：rotation 觸發時 `<conn>.jsonl` rename 為 `<conn>.jsonl.1`，現有 `<conn>.jsonl.1` 若存在則被覆蓋。完全對齊 ROADMAP success criterion 2 的「前一段檔案保留在磁碟上」用語。
- **D-10:** **只保留上一段**（1 個）。dbcli audit 為 session handoff / forensics 工具，不是長期 retention 系統；不引入 `keep_segments` config knob。
- **D-11:** **Rotation 觸發閾值**：`max_bytes = 10 MB`、`max_entries = 1000`（兩者 OR 關係，任一達到即觸發）。預設值寫入 `.dbcli` audit.rotation 區塊；可由使用者覆寫。
- **D-12:** **Lazy mkdir**：`audit.enabled = true` 時，`.dbcli/audit/` 目錄不在 `dbcli init` / `use` 階段建立；第一次有效寫入 entry 時才 `mkdir -p`。對齊 CONFIG-02（disabled 不建目錄）與 `last-recovery.json` 的 lazy 模式。

### D. Session-id Robustness、目錄路徑、D6 cadence
- **D-13:** `.dbcli/last-session-id` **檔案格式為 JSON**：`{ "sessionId": "<id>", "pid": <number>, "createdAt": "<ISO>" }`。讀取時若 `pid !== process.pid` 即視為過期，**重新生成新 sessionId + 寫回**。不檢查 PID 是否仍存活（kill(pid, 0)），不引入時間戳新鮮度判定；簡單規則勝過邊界保險。
- **D-14:** **V1 / 未命名 config 的 audit 檔名為 `default.jsonl`**。與 `config-v2` 預設連線名 `default` 對齊；V1 → V2 升級後 audit 檔自然延續。不採用 `audit.jsonl`（無連線命名空間）或 `<system>.jsonl`（與多 config 同 system 衝突）。
- **D-15:** **Audit 目錄跟隨 config storage path**：使用 `resolveConfigStoragePath()` 解析後 join `audit/`。例：`--config /tmp/foo.dbcli` → `/tmp/foo.dbcli/audit/<conn>.jsonl`。與 schema cache、`last-recovery.json` 的生態一致；不引入獨立的 `audit.dir` 設定。
- **D-16:** **D6 stderr 警告為「同進程只警告一次」**：第一次寫入失敗即印一行人類可讀警告（含 last-error message），同進程後續 audit 寫入失敗只更新 `AuditLogger` 內部的 sticky `lastError`（被 `audit health` 讀取），不再重複噪音。**不採用** exit-time summary（避免綁 process exit hook）。

### Planner Discretion
以下交由 planner 與實作者依推薦預設或 codebase 既有風格決定：

- **`audit health` introspection API 具體型別**（`logger.getHealth(): AuditHealthReport`）：建議包含 `enabled`、`writerInitialized`、`currentFile`、`currentSizeBytes`、`currentEntryCount`、`rotationUsage` (`{ bytes: {current, max, pct}, entries: {current, max, pct} }`)、`lock` (`{ state, heldByPid? }`)、`lastWrite` (`{ ts, success, error? } | null`)、`lastError` (sticky)、`sessionId`、`rotation` (`{ lastRotatedAt?, previousFile? }`)。實際型別由 Phase 21 planner 與 Phase 22 contract 對齊。
- **Phase 21 測試邊界**：以 unit test 為主，覆蓋 `AuditLogger`、`SessionIdService`、`AuditLockManager`、rotation、config schema migration、D6 失敗路徑。額外**至少一個 concurrent integration test**（同時兩個 process 寫入同一 `<conn>.jsonl`，驗證每行可解析，對應 STORE-03 success criterion 3）。讀寫權限受限路徑（success criterion 4）建議用 fixture + `chmod` 在臨時目錄驗證；不要求所有引擎都跑（Phase 23 才做）。
- **AuditLockManager 預設 retry budget 的常數值與 backoff 形狀**（D-07 提到約 200ms）：實作時可參考 `ConcurrentLockManager` 的 exp backoff 結構，但起步更短（例如 5ms → 50ms ceiling），並於 budget 用盡時立即 fail-soft。
- **Rotation rename 的 atomic 程度**：`fs.rename` 在同一檔案系統內為原子；不額外做 tmp+rename，除非實測發現問題。
- **Capability registry (`src/adapters/capabilities.ts`) 是否需要新增 `audit` key**：Phase 21 不對外曝露 `dbcli audit` 子指令（Phase 24），所以 capability registry **暫不變動**；Phase 24 統一更新。

### Folded Todos
None — 沒有與本 phase 直接相關的未完成 todo 從 backlog 帶入。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone 層級鎖定文件
- `.planning/PROJECT.md` §"Current Milestone: v1.20.0 Agent-Facing Audit Log" — D1–D6 鎖定決策、scope / out-of-scope 摘要
- `.planning/REQUIREMENTS.md` — v1.20.0 28 條 REQ-IDs；Phase 21 owning AUDIT-02 / AUDIT-03 / STORE-01 / STORE-02 / STORE-03 / STORE-04 / CONFIG-01 / CONFIG-02 / CONFIG-03
- `.planning/ROADMAP.md` §"Phase 21: Audit Writer Foundation" — Goal、Success Criteria（6 條）、Dependencies、Cross-Phase Risks #1–#7
- `.planning/seeds/v1.20.0-audit-log-milestone.md` — 完整 seed（D1–D6 詳細推論、Implications 對升級用戶的衝擊）

### Phase 21 強制讀取的 codebase 文件
- `src/adapters/capabilities.ts` — `SideEffectTier` enum 與 capability registry，Phase 22 entry schema 會 reuse；Phase 21 不動但要知道存在
- `src/core/concurrent-lock.ts` — `ConcurrentLockManager` 參考實作（exp backoff、lockfile pattern、release 機制）；`AuditLockManager` 借用同模式但獨立類別
- `src/core/recovery/last-envelope.ts` — `writeLastEnvelope` 的 atomic tmp+rename + lazy mkdir 模式；`.dbcli/last-session-id` 寫回採同模式
- `src/utils/config-path.ts` + `src/core/config-binding.ts` — `resolveConfigPath()` / `resolveConfigStoragePath()`；audit 目錄解析路徑來源
- `src/core/config-v2.ts` — V2 multi-connection 解析；audit 檔名為連線名（D-14）
- `src/utils/validation.ts`（`DbcliConfigV2Schema`）— Phase 21 需在此擴充 `audit.enabled` / `audit.rotation` schema 與 CONFIG-03 migration

### Phase 21 應該不要碰的範圍
- `tests/helpers/sensitive-output.ts` — Phase 22 才開始用；Phase 21 不寫 redaction 邏輯
- 任何 `src/adapters/*-adapter.ts` 或 `src/core/commands/*` — Phase 23 才接 engine hooks

### Cross-Phase Risks（再次提醒，來自 ROADMAP）
- Risk #4: `.dbcli/last-session-id` 過期 → D-13 PID 比對處理
- Risk #5: `audit health` 訊號必須由 Phase 21 writer service expose → 已列入 planner discretion 給 planner
- Risk #6 / #7: 屬於 Phase 23

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ConcurrentLockManager` (`src/core/concurrent-lock.ts`)** — Lock pattern reference；不直接 reuse，但 exp backoff 與 stale lock cleanup 邏輯可借鏡
- **`writeLastEnvelope` (`src/core/recovery/last-envelope.ts`)** — Atomic tmp+rename 寫法可套用到 `.dbcli/last-session-id` 寫回
- **`resolveConfigStoragePath()` / `resolveConfigPath()`** — Audit 目錄解析依此鏈
- **`DbcliConfigV2Schema` (`src/utils/validation.ts`)** — Zod schema 擴充 `audit.*` 區塊
- **`config-v2.ts` 預設連線名 `default`** — 對齊 V1 single-conn audit 檔名

### Established Patterns
- **`.dbcli/<file>.json` / `.lock` 慣例** — schema.lock、last-recovery.json、schemas/index.json、last-session-id 都遵循同一目錄；audit dir 為新子目錄
- **Lazy directory creation** — `last-envelope` / `error-recovery` 都是「需要才 mkdir」；audit 沿用
- **Class-based service for stateful subsystems** — `ConcurrentLockManager`, `SchemaWriter`, `SchemaLayeredLoader` 都是 class；`AuditLogger` 一致
- **Functional module for one-shot operations** — `writeLastEnvelope`, `sanitizeCommandSummary` 是 functional；audit 的 SessionIdService 介於兩者間（class 為主、但介面薄）
- **Zod-validated config schema with defaults** — `DbcliConfigV2Schema` 已建立 pattern，CONFIG-03 升級補欄位走 Zod default

### Integration Points
- **`.dbcli/audit/` 為新子目錄**，與 `.dbcli/schemas/`、`.dbcli/queries/`、`.dbcli/recovery/` 並列
- **`.dbcli/last-session-id` 為新檔**，與 `.dbcli/last-recovery.json`、`.dbcli/version-check.json` 並列
- **`config.ts` 的 V2 載入流程要在 `audit.*` 缺欄位時填入預設**（CONFIG-03）
- **`src/cli.ts` 不需 wire 新指令**（`dbcli audit` 是 Phase 24）；Phase 21 不動 commander 樹
- **不變動的對外行為：** v1.19.x 既有所有指令在 Phase 21 落地後行為**逐字相同**（沒有任何 engine hook）

### Phase 21 不會建立的東西
- 任何 `dbcli audit *` CLI（Phase 24）
- 任何 entry JSON 寫入位置（Phase 22 鎖 schema、Phase 23 才接 engine call）
- `recovery_ref` / `audit_ref` 欄位（Phase 25）

</code_context>

<specifics>
## Specific Ideas

- **Session-id 格式具體寫成 `<pid>-<unix-ts-ms>-<6-char-random>`**，例：`87421-1747234567890-a4f2b8`。Random 採 `crypto.randomBytes(3).toString('hex')`（不需 cryptographic 強度，但要避免同 ms 同 pid 碰撞）。
- **`audit.rotation` 區塊 schema 草案**：
  ```json
  {
    "audit": {
      "enabled": true,
      "rotation": {
        "max_bytes": 10485760,
        "max_entries": 1000
      }
    }
  }
  ```
- **`audit health` 報告欄位草案**（planner 可微調）：見 planner discretion 區段。
- **lock file 不持久化跨進程資訊**（避免 stale）：採 PID + 進程啟動時間，release 時刪檔；若拿到 lock 但 PID 已死則視為 stale 並 takeover。
- **Phase 21 unit test 目錄建議**：`tests/unit/core/audit/{logger,session-id,lock,rotation,config-migration}.test.ts`；至少一個 `tests/integration/core/audit-concurrent.test.ts` 跑兩個 child process 寫同檔。

</specifics>

<deferred>
## Deferred Ideas

下列概念在討論中出現但屬於其他 phase / milestone：

- **`audit health` CLI 表面** → Phase 24（CLI-05）；Phase 21 只 expose API
- **Entry JSON schema 細節 + contract test** → Phase 22（SCHEMA-01 ~ SCHEMA-04）
- **Engine wiring + dry-run handling + rejection paths** → Phase 23（INTEGRATE-01 / INTEGRATE-04）
- **Recovery envelope 雙向 `recovery_ref` / `audit_ref`** → Phase 25（INTEGRATE-02 / INTEGRATE-03）
- **Tamper-evident / hash chain / 加密 audit log** → Future（合規路線）
- **二級資源索引（最近誰碰過 `users` 表）** → `.planning/seeds/conflict-avoidance-resource-index.md`
- **Audit log 自動對照 query 驗證** → `.planning/seeds/self-verification-correlation.md`
- **`audit.dir` 自訂目錄** → 暫不開放；超出 Phase 21 範圍
- **Exit-time summary of skipped audit entries** → 不採用（D-16）；如有需求未來再評估
- **`keep_segments` config knob（保留多段歷史）** → 不採用（D-10）；audit 不做長期 retention

### Reviewed Todos (not folded)
None — todo backlog 中沒有與 Phase 21 直接相關的項目被 cross-reference。

</deferred>

---

*Phase: 21-audit-writer-foundation*
*Context gathered: 2026-05-14*
