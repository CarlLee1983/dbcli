# Phase 21: Audit Writer Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `21-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 21 — Audit Writer Foundation
**Areas discussed:** A. Writer 模組與 API 表面、B. File Lock + Atomic Write、C. Rotation 檔名 + 保留策略、D. Session-id Robustness + 目錄路徑 + D6 cadence

---

## Pre-discussion: Locked from milestone seed / ROADMAP（未再詢問）

| Locked Item | Source |
|-------------|--------|
| `audit.enabled = true` 預設 on（opt-out） | D1 / CONFIG-01 |
| `DBCLI_SESSION_ID` env 優先；缺則 `<pid>-<unix-ts>-<random>` | D2 / AUDIT-02 |
| 同進程透過 `.dbcli/last-session-id` 共用 session_id | AUDIT-03 |
| Storage: `.dbcli/audit/<connection>.jsonl`（append-only JSONL，每連線一檔） | D4 / STORE-01 |
| 寫入失敗：stderr 警告 + 主指令照跑 | D6 / STORE-04 |
| Rotation 閾值區間：~10 MB 或 ~1000 entries | STORE-02 |
| `audit.enabled = false` 完全短路、不建目錄 | CONFIG-02 |
| 既有 `.dbcli` 升級補預設值 | CONFIG-03 |
| Redaction 規則來源：`tests/helpers/sensitive-output.ts`（Phase 22 才用） | SCHEMA-03 |

---

## Gray area 選擇

> 「Phase 21 哪些 gray areas 要深入討論？」（multiSelect）

| Option | Description | Selected |
|--------|-------------|----------|
| A. Writer 模組與 API 表面 | AuditLogger 放哪、class vs functional、同步 vs 非同步、session-id 服務形狀 | ✓ |
| B. File lock + atomic write | STORE-03 機制：reuse ConcurrentLockManager / proper-lockfile / O_APPEND；fsync 策略 | ✓ |
| C. Rotation 檔名 + 保留策略 | 檔名 scheme、保留段數、預設閾值、目錄建立時機 | ✓ |
| D. Session-id robustness + health 訊號 + D6 cadence | stale 判定、v1 檔名、--config 互動、警告頻率 | ✓ |

**User's choice:** 全選四個 area

---

## Area A — Writer 模組與 API 表面

### A-Q1: AuditLogger 的位置該放哪個目錄？
| Option | Description | Selected |
|--------|-------------|----------|
| `src/core/audit/` (推薦) | 對齊 recovery / inspect / guide / saved-queries 同層 | ✓ |
| `src/services/audit/` (新 dir) | 新開 services 層，但目前 codebase 無 services 目錄 | |
| `src/core/audit-log/` (變體名) | 同 A，但名字更明確 | |

**User's choice:** `src/core/audit/` (推薦)

### A-Q2: AuditLogger 該設計為哪種型態？
| Option | Description | Selected |
|--------|-------------|----------|
| Class 實例（長活、含狀態） (推薦) | 對齊 ConcurrentLockManager / SchemaWriter；天然 introspection 容器 | ✓ |
| Functional module（無狀態） | 每次 call 重新查 config / session-id；I/O 開銷大 | |
| Singleton module + 函式 API | 折衷；外部看似 functional 內部 class | |

**User's choice:** Class 實例 (推薦)

### A-Q3: 引擎呈現結果前的寫入時機最重要的保證是？
| Option | Description | Selected |
|--------|-------------|----------|
| `await logger.write(entry)` (推薦) | 寫完才放行（成功或警告）；與 D6 + Phase 25 recovery_ref 因果順序相容 | ✓ |
| Fire-and-forget queue | 引擎 latency 最低，但 crash 時最後幾筆遺失，與 recovery_ref 衝突 | |
| 同步 (Bun.writeSync) | blocking I/O；不適合 fully-async 引擎（ES / Mongo） | |

**User's choice:** `await logger.write(entry)` (推薦)

### A-Q4: session_id 服務該透過哪種方式提供？
| Option | Description | Selected |
|--------|-------------|----------|
| 獨立 SessionIdService 模組 (推薦) | `src/core/audit/session-id.ts` 單職責；recovery 等模組可共用 | ✓ |
| 直接組裝進 AuditLogger | 簡單，但未來別的 module 拿不到 | |
| 中立 utility 函式 | `src/utils/session-id.ts`；layering 不合適（session-id 是 domain concept） | |

**User's choice:** 獨立 SessionIdService 模組 (推薦)

---

## Area B — File Lock + Atomic Write

### B-Q1: 多進程串行寫入同一連線 audit 檔的底層機制？
| Option | Description | Selected |
|--------|-------------|----------|
| 新增 audit-調低的 LockManager (推薦) | 參考 ConcurrentLockManager 但 retry budget 短、stale 偵測 | ✓ |
| 直接 reuse ConcurrentLockManager | 30s timeout 過重，audit 用不上 | |
| `proper-lockfile` library | 跨平台但增加 runtime dep | |
| 不加 lock，依賴 O_APPEND 原子性 | POSIX < 4KB atomic；Windows 不保證 → 違反 cross-platform constraint | |

**User's choice:** 新增 audit-調低的 LockManager (推薦)

### B-Q2: Lock 粒度？
| Option | Description | Selected |
|--------|-------------|----------|
| 一個 audit file 一個 lock (推薦) | `.dbcli/audit/<conn>.jsonl.lock`；不同連線完全 independent | ✓ |
| 全域 audit lock | 簡單但跨連線會互相阻塞 | |

**User's choice:** 一個 audit file 一個 lock (推薦)

### B-Q3: 如果 lock retry 超過預算仍拿不到，該怎麼辦？
| Option | Description | Selected |
|--------|-------------|----------|
| 走 D6：stderr 警告 + 跳過這筆 entry (推薦) | budget ~200ms；不阻主指令；sticky last-error 給 health | ✓ |
| 繼續等到拿到為止 | 30s 預設，違反 D6 | |
| 完全不 retry，拿不到立刻 warn | 太脆，微量競爭就丟 entry | |

**User's choice:** 走 D6：stderr 警告 + 跳過這筆 entry (推薦)

### B-Q4: 每筆 entry 寫入後該不該 fsync？
| Option | Description | Selected |
|--------|-------------|----------|
| Append 後 flush，不 fsync (推薦) | crash 可能丟最後幾筆；audit 是 observability 非合規 | ✓ |
| 每筆 fsync | crash safe 但 perf 代價 | |
| rotation 邊界才 fsync | 折衷，但效益有限 | |

**User's choice:** Append 後 flush，不 fsync (推薦)

---

## Area C — Rotation 檔名 + 保留策略

### C-Q1: Rotation 觸發後舊檔的命名方式？
| Option | Description | Selected |
|--------|-------------|----------|
| `<conn>.jsonl` → `<conn>.jsonl.1` (推薦) | 單一滾動舊檔；對齊 ROADMAP success criterion 用語 | ✓ |
| `<conn>-<ISO-ts>.jsonl` | 時間戳累積，需 cleanup 策略 | |
| Counter ring (`.1`, `.2`, ..., `.N`) | logrotate 風；過度設計 | |

**User's choice:** `<conn>.jsonl` → `<conn>.jsonl.1` (推薦)

### C-Q2: 保留多少段 rotation 歷史？
| Option | Description | Selected |
|--------|-------------|----------|
| 只保留上一段（1個） (推薦) | 對齊 ROADMAP success criterion 2 文字 | ✓ |
| 不保留，rotation 直接丟舊檔 | forensics 衝突 | |
| N 可設定（預設 3） | 多一個 config knob，超出 Phase 21 範圍 | |

**User's choice:** 只保留上一段 (推薦)

### C-Q3: `audit.rotation` 預設閾值？
| Option | Description | Selected |
|--------|-------------|----------|
| `max_bytes=10MB, max_entries=1000` (推薦) | 對齊 ROADMAP success criterion 2 用語 | ✓ |
| `max_bytes=10MB`, 不看 entry count | STORE-02 明確 | |
| 可關閉（=0 為 unlimited） | power user 選項；Phase 21 不引入 | |

**User's choice:** `max_bytes=10MB, max_entries=1000` (推薦)

### C-Q4: `audit.enabled=true` 但 `.dbcli/audit/` 不存在時的初始化行為？
| Option | Description | Selected |
|--------|-------------|----------|
| Lazy mkdir：第一次寫入才建目錄 (推薦) | 對齊 CONFIG-02；last-recovery.json 同 pattern | ✓ |
| Init/use 時就事先 mkdir | readonly 指令也會 side effect；偏離 D1 升級體感 | |

**User's choice:** Lazy mkdir (推薦)

---

## Area D — Session-id Robustness + 目錄路徑 + D6 cadence

### D-Q1: `.dbcli/last-session-id` 讀到舊記錄時如何判定能否重用？
| Option | Description | Selected |
|--------|-------------|----------|
| PID 對不上就重生 (推薦) | 檔案存 `(sessionId, pid)`；本進程 PID 不同 → 重生 | ✓ |
| PID + timestamp 雙審 | 多一個門檻；CLI 短命進程 PID reuse 不是實際痛點 | |
| `kill(pid, 0)` 存活檢查 | 跨平台有坑（Windows）；過重 | |
| 不檢查，最新 wins | 跨進程被誤判成同 session，違反 D2 語意 | |

**User's choice:** PID 對不上就重生 (推薦)

### D-Q2: V1 (未命名 / single-connection) config 的 audit 檔名為？
| Option | Description | Selected |
|--------|-------------|----------|
| `default.jsonl` (推薦) | 對齊 config-v2 預設連線名；V1 → V2 升級延續 | ✓ |
| V1 直接 `.dbcli/audit.jsonl`（無子目錄） | V1 / V2 不一致；migration 麻煩 | |
| 以 db system 為名（`postgres.jsonl` 等） | 多 config 同 system 衝突 | |

**User's choice:** `default.jsonl` (推薦)

### D-Q3: `--config <path>` 自訂位置時 audit 目錄怎麼跟？
| Option | Description | Selected |
|--------|-------------|----------|
| 跟隨 config storage path (推薦) | `resolveConfigStoragePath() + 'audit/'`；與 schema cache / last-recovery 一致 | ✓ |
| 永遠是 CWD 下的 `.dbcli/audit/` | 多專案共用 CWD 危險 | |
| 使用者另設 `audit.dir` | 超出 Phase 21 範圍 | |

**User's choice:** 跟隨 config storage path (推薦)

### D-Q4: D6 寫入失敗時的 stderr 警告頻率？
| Option | Description | Selected |
|--------|-------------|----------|
| 同進程只警告一次 + health 保留 sticky last-error (推薦) | 避免 agent output 訊雜；health 主動可查 | ✓ |
| 每次寫入失敗都警告 | 連續失敗會訊雜 | |
| 完全不警告，只靠 audit health | 違反 D6 鎖定（"stderr 警告"） | |
| 首次警告 + exit 前 summary | 集體訊息足，但 exit handler 組裝複雜 | |

**User's choice:** 同進程只警告一次 + health 保留 sticky last-error (推薦)

---

## 結束確認

### Continue?
| Option | Description | Selected |
|--------|-------------|----------|
| 交給推薦値、進 context (推薦) | 把 audit health 訊號清單 + Phase 21 test boundary 交給 planner | ✓ |
| 再討論 audit health introspection 介面 | | |
| 再討論 Phase 21 test boundary | | |

**User's choice:** 交給推薦値、進 context (推薦)

---

## Planner Discretion

User accepted recommended defaults; planner has discretion on：

- `audit health` introspection API 具體型別（已在 `21-CONTEXT.md` 列建議欄位草案）
- Phase 21 測試邊界（建議 unit-first + 一個 concurrent integration test）
- `AuditLockManager` retry budget 常數與 backoff 具體形狀
- Rotation `fs.rename` 是否需要 tmp+rename（建議不用，除非觀測到問題）
- Capability registry 暫不變動（Phase 24 統一）

## Deferred Ideas

捕捉於 `21-CONTEXT.md` deferred 區段；摘要：

- audit health CLI 表面 → Phase 24
- Entry schema + redaction → Phase 22
- Engine wiring → Phase 23
- Recovery envelope 雙向連結 → Phase 25
- 合規 / 加密 / 多段保留 / 自訂 `audit.dir` → 未來或暫不採用

---

*Discussion log generated: 2026-05-14*
