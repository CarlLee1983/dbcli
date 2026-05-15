# Phase 25: Recovery Envelope Bi-directional Linkage - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 25-recovery-envelope-bi-directional-linkage
**Areas discussed:** A (recovery_ref / audit_ref shape), D (DOCS-02 inspect/recover recent audit embedding)

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| A. recovery_ref / audit_ref 值的形狀 | audit entry 的 recovery_ref 指向「路徑字串」/「envelope-level UUID」/「兩者都帶」；對稱地 envelope.audit_ref 是 audit entry.id（UUID）。會決定要不要替 SavedRecoveryEnvelope 加 id 欄位。 | ✓ |
| B. SavedRecoveryEnvelope schema 升級策略 | 在 schemaVersion=1 內以 optional 加 audit_ref/id（backward-compatible）vs. 直接 bump 到 schemaVersion=2（強制 migration、recover --from 舊檔需相容判定）。影響 envelope-schema.ts、recover --apply / --from 相容性。 | |
| C. 失敗路徑寫入順序與 id 預生成 | 目前 catch 內 audit 先寫、envelope 後寫且 process.exit。雙向欄位要嘛 (1) pre-generate envelope id 由 caller 傳給兩端、(2) 重構讓 envelope 先寫拿 id 再寫 audit、(3) audit.recovery_ref 退化為固定 path 不需 id。 | |
| D. DOCS-02 — inspect / recover 自動引用 recent audit | inspect snapshot 與 recover output 在 agent 取向 JSON / markdown 裡嵌入 recent audit summaries 的「位置 / 啟用條件 / 預設筆數 / 形狀」。 | ✓ (後續補選) |

**User's choice:** A（單選），後續確認需要追加討論 D。
**Notes:** A2 隱含決定了 C 的選項空間；A3 鎖定後 B 也大幅收斂；C/B 因此不重複討論。

---

## Area A — recovery_ref / audit_ref 值的形狀

### A1. envelope-level id 要不要加？

| Option | Description | Selected |
|--------|-------------|----------|
| 加 envelope.id（UUID） | 在 SavedRecoveryEnvelope 加 id: string（UUID v4）。Audit.recovery_ref = 該 UUID；Phase 24 audit show --recovery-ref 的 exact match 立刻可用。 | ✓ |
| 不加 id，audit.recovery_ref 只存路徑 | audit.recovery_ref = '.dbcli/last-recovery.json'（固定路徑）。簡單。缺點：agent 無法區辨兩個不同時間的 envelope；Phase 24 的 --recovery-ref 查詢只能查到「當下」的 envelope。 | |
| 兩者都帶（compound） | envelope 有 id，audit.recovery_ref 同時帶 id 與 path。型別變複雜（從 string 變成 {id,path}），不推薦。 | |

**User's choice:** 加 envelope.id（UUID）

### A2. envelope id 的生成時點

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-generate 由 emit 入口統一生成 | emitRecoveryEnvelope() 進入時 crypto.randomUUID() 拿到 id，同步傳給 audit 寫入路徑與 envelope 寫入路徑。catch 內先 await writeAuditEntry({...recovery_ref: id}) 再 emitRecoveryEnvelope(...)。不需重構 sync write。D6 仍然走原路。 | ✓ |
| envelope 寫入時才生成 | id 生成一併在 writeLastEnvelopeSync 裡。問題：此時 audit entry 的 recovery_ref 還不知道這個 id 是什麼，進入逆向轉錄難題。 | |
| envelope id 由 audit entry id 倒推 | envelope.id = audit_entry.id，兩者同一個 UUID。優點：只有一個 UUID；缺點：audit.recovery_ref / envelope.audit_ref 語意退化為「同一件事的雙向 alias」，並使得 forensics 難以區辨「這是哪一個」。 | |

**User's choice:** Pre-generate 由 emit 入口統一生成

### A3. envelope id 要加在「SavedRecoveryEnvelope wrapper」還是「RecoveryEnvelope 本體」？

| Option | Description | Selected |
|--------|-------------|----------|
| 加在 SavedRecoveryEnvelope wrapper | id 與 savedAt/command/cwd 同層，不受 RecoveryEnvelope 本體鎖定造型影響。RECOVERY_SCHEMA_VERSION 不動；audit_ref 也走同一層。簡單且不動 stdout 輸出的 RecoveryEnvelope JSON（輸出約定不變）。 | ✓ |
| 加在 RecoveryEnvelope 本體 | envelope.id 同層於 generatedAt / error / recovery。emitRecoveryEnvelope 印到 stdout 的 JSON 也會多出 id，agent 可以不讀 last-recovery.json 就拿到 id。但這動到 RECOVERY_SCHEMA_VERSION 與 RECOVERY_CODES 帶同一個 contract。 | |
| 兩者都加（duplicate） | envelope.id 與 saved.id 同值。型別變複雜。不推薦。 | |

**User's choice:** 加在 SavedRecoveryEnvelope wrapper

### A4. audit_ref 是否同樣加在 SavedRecoveryEnvelope wrapper（與 id 同層）？

| Option | Description | Selected |
|--------|-------------|----------|
| audit_ref 也走 wrapper、optional | SavedRecoveryEnvelope = { schemaVersion, savedAt, command, cwd, id, audit_ref?, envelope }。audit_ref 為 audit entry 的 UUID；D6 徹底尊重 — audit 寫入失敗 / disabled 時 audit_ref 不填，不阻擋 envelope 寫入。 | ✓ |
| audit_ref 放 RecoveryEnvelope 本體 | envelope.audit_ref，跟 id 一起動 RECOVERY_SCHEMA_VERSION。同 A3 依賴關係。 | |

**User's choice:** audit_ref 也走 wrapper、optional

### A5. 舊 envelope（沒有 id / audit_ref 欄位）被 recover --from <file> 載入時？

| Option | Description | Selected |
|--------|-------------|----------|
| Optional 欄位、舊檔照跑 | parseSavedRecoveryEnvelope 將 id / audit_ref 視為 optional。舊檔 (沒 id) 仍予以接受。recovery envelope 是 ephemeral（單檔、每次失敗覆蓋），不做 migration ceremony。 | ✓ |
| 舊檔拒絕 / 強制 migrate | 舊 envelope 沒 id 則 recover --from 報 malformed。過度嚴謹 — recovery envelope 本來就是「一事件一覆蓋」的 ephemeral 資料，不需要 migration ceremony。 | |

**User's choice:** Optional 欄位、舊檔照跑

### A6. audit show --recovery-ref <id> 在交隊期查不到時

| Option | Description | Selected |
|--------|-------------|----------|
| 陽性訊息 + exit 1 | 仍按 Phase 24 D-37 exact match 規則；查不到就 stderr 'No audit entry matches recovery-ref <x>.' 並 exit 1。Phase 25 不專門為「交隊期」寫 fallback。 | ✓ |
| Fallback 撞 path | 若 --recovery-ref 是路徑字串 (以 '.dbcli/' 開頭) 則查 path match，否則查 UUID。讓 audit 查詢層帶上「兩種語意」複雜度。不推薦。 | |

**User's choice:** 陽性訊息 + exit 1

### B (最小必要 sub-decision). SavedRecoveryEnvelope.schemaVersion 是否要 bump 1→2？

| Option | Description | Selected |
|--------|-------------|----------|
| 保持 schemaVersion=1，optional 加欄 | id / audit_ref 都是 optional；schemaVersion 不動。parseSavedRecoveryEnvelope 在舊檔上不報錯。與 A5 「1 個檔、ephemeral」狀態一致。 | ✓ |
| Bump 1→2、id 為必填 | 舊 envelope 在 recover --from 被拒絕。與 A5 選項衝突。僅當 audit_ref / id 是合規證明需求時才需要，本專案不是。 | |

**User's choice:** 保持 schemaVersion=1，optional 加欄

---

## Mid-discussion checkpoint

After Area A wrap-up, asked whether to discuss Area D, leave it to planner, or capture preference.

| Option | Description | Selected |
|--------|-------------|----------|
| 討論 area D (DOCS-02) | Phase 25 success criterion #3 明文要求 inspect / recover agent guide 輸出帶 recent audit。這是本 phase 三條 requirement 之一 (DOCS-02)，不鎖不能結案。 | ✓ |
| 不討論 D，交給 planner discretion | DOCS-02 的位置 / 筆數 / 啟用條件三軸交給 planner。風險：planner 可能選「永遠帶」造成非 agent 使用者看到不相關資訊；或選「只 --for-agent」造成 markdown 路徑完全沒覆蓋。 | |
| 交給 planner，但我給「一句話偏好」 | freeform 一句話偏好，記錄為 preference（不是 locked decision），planner 可以偏離但要說明。 | |

**User's choice:** 討論 area D (DOCS-02)

---

## Area D — DOCS-02 inspect / recover recent audit embedding

### D1. recent audit 要嵌入哪些指令的 agent 輸出？（multi-select）

| Option | Description | Selected |
|--------|-------------|----------|
| inspect (snapshot) | dbcli inspect 的 agent JSON 輸出加 audit_recent 欄位。 | ✓ |
| guide (agent advice) | dbcli guide <goal> 的 agent JSON 輸出加。 | ✓ |
| recover (envelope 輸出) | dbcli recover (無 --apply) 預設讀 last-recovery.json 輸出 envelope 時加。 | ✓ |
| recover --apply (apply result) | 執行完 recover --apply 後的 result JSON 也加。原本標記為「不推薦」(apply result 已豐), 用戶選擇覆蓋。 | ✓ |

**User's choice:** 全部四個

### D2. 永遠帶 vs 只 --for-agent？

| Option | Description | Selected |
|--------|-------------|----------|
| 只在 --for-agent / --format json + --brief 的路徑帶 | Human markdown 路徑不變。與 Phase 24 D-33 --for-agent shortcut 概念一致。 | ✓ |
| 永遠帶，markdown / human 路徑也帶 | 人跟 agent 看到同樣的「history」section。可能讓使用者覺得 inspect / recover 輸出變喘。 | |
| 另開一個旗標 e.g. --with-audit | 顯示加旗標才帶 audit。與 --for-agent 哲學走反。 | |

**User's choice:** 只在 --for-agent / --format json + --brief 的路徑帶

### D3. recent audit 預設筆數 N？

| Option | Description | Selected |
|--------|-------------|----------|
| 5 | 足夠讓 agent 看到「上一次查了什麼、是否失敗、是否同一表」，但不至於顯示 brief JSON。與 Phase 24 audit tail 預設 --n 10 區隔開。 | ✓ |
| 10 | 與 audit tail 預設一致。代價：inspect / guide 輸出 brief mode 裡順便多出 10 個 objects。 | |
| 3 | 極輕量。 | |
| 0，加 --audit-n=<N> flag | 預設不帶，讓 agent 明評帶。與 'agent 路徑預設帶' 偏好衝突。 | |

**User's choice:** 5

### D4. recent audit 嵌入的「個體形狀」？

| Option | Description | Selected |
|--------|-------------|----------|
| 複用 Phase 24 --brief entries (加 id) | 每筆 ts / command / target / success / id。contract test 與 audit tail --brief 同一個 fixture。 | ✓ |
| Full entry | 完整 AuditEntry。與 brief mode 意圖衝突。 | |
| Hand-rolled 子集 | 另開一個不與 audit tail --brief 一致的子集 shape。造成認知負擔。不推薦。 | |

**User's choice:** 複用 Phase 24 --brief entries（加上 id 讓 client side join）

### D5. audit.enabled=false 或 audit log 完全為空時 audit_recent 欄位面貌？

| Option | Description | Selected |
|--------|-------------|----------|
| audit_recent: []（空陣列） | 欄位永遠存在、shape stable；agent 可以無條件以 length 判斷。Audit disabled / empty / read 失敗 三種狀態都輸出空陣列。 | ✓ |
| 加 audit_status: 'disabled'\|'empty'\|'unavailable' | Shape 變複雜、與 'inspect/guide 不是 audit health' 的分工原則衝突。 | |
| audit disabled 時跳過、不產出欄位 | 欄位 optional，型別不 stable。 | |

**User's choice:** audit_recent: []（空陣列）

### D6. recent audit 裡「與本次 envelope 同 audit_ref」的 entry 是否要特別標註？

| Option | Description | Selected |
|--------|-------------|----------|
| 不標註 | recover JSON 本層已記錄 envelope.audit_ref，audit_recent 是「最近 N 筆」的咨詢資訊，語意不混合。agent 在 client 端自己 join (id === envelope.audit_ref)。 | ✓ |
| 加 is_origin 布林 entry-level 標註 | recent[i].is_origin = true 表示這筆是讓 envelope 產生的。Shape 多欄位、contract 多一面向；agent 不一定需要。 | |

**User's choice:** 不標註

---

## Wrap-up Decision

After Area A and Area D done, asked whether to continue or write CONTEXT.md.

| Option | Description | Selected |
|--------|-------------|----------|
| 現在寫 CONTEXT.md | A 與 D 的決策已足以讓 planner / researcher 動手。剩下的 (contract test 定位 / inspect snapshot 型別名) 交給 planner discretion。 | ✓ |
| 討論 'self-audit & D6 交互' | Phase 24 F 鎖定 audit 子指令不寫 audit。Phase 25 動 emitRecoveryEnvelope 時，recover --apply 是否連帶寫 audit？ | |
| 討論 'contract test 反向 round-trip' | round-trip test 是 recommended scope 還是 release-blocking？ | |

**User's choice:** 現在寫 CONTEXT.md（其他兩項變為 planner discretion 的 E 與 F）

---

## Planner Discretion 落點

- 是否新增 release-blocking round-trip contract test (Area E in CONTEXT.md)
- recover --apply 自身是否寫 audit entry (Area F in CONTEXT.md)
- InspectSnapshot 新增 audit_recent 欄位的擺位與型別名稱 (G)
- Reader 路徑 (readEntries / tailEntries) 與 fall-through 行為 (H)
- envelope id 生成的具體位置 (I)
- catch 區塊 audit ↔ envelope 順序樣板 (J)
- writeAuditEntry 回傳 entry id 的簽章升級 (K)

## Deferred Ideas

- `--audit-n=<N>` flag (預設 N=5 寫死)
- `audit_status` 欄位
- `recent[i].is_origin` 標註
- `recovery_ref` compound (id + path)
- `RECOVERY_SCHEMA_VERSION` bump
- `SavedRecoveryEnvelope.schemaVersion` bump
- `audit show --recovery-ref` path fallback
- `recover --apply` 自己寫 audit entry (Phase 25 不做)
- SKILL.md / feature-matrix.md / CHANGELOG → Phase 26
- Tamper-evident / hash-chain → Out of scope
- `audit resource <table>` → seed
- `audit verify <id>` → seed
