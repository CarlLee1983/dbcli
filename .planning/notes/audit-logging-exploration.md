---
title: Audit Logging Milestone Exploration
date: 2026-05-14
context: 探索 dbcli 下個 milestone 的可能方向，最終聚焦在 audit logging
type: note
related:
  - "[[seeds/v1.20.0-audit-log-milestone]]"
  - "[[seeds/conflict-avoidance-resource-index]]"
  - "[[seeds/self-verification-correlation]]"
---

# Audit Logging Milestone Exploration

## 探索結論

dbcli 下個 milestone 候選為 **Agent-Facing Audit Log**，預計版號 **v1.20.0**。

## 關鍵決策

### 主要讀者：AI agent 自身（其次：開發者）

刪掉了重量級合規路線（tamper-evident、長期保留、簽章），走「local 結構化檔案 + 既有 JSON 合約風格」的輕量設計。

### 優先級排序（四種使用情境）

| 排序 | 用途 | 現況覆蓋率 | 處理方式 |
|------|------|------------|----------|
| 1 | **Session handoff / 接力** | ❌ 完全空白 | **必做** — 最大的缺口；agent 跨 session 無記憶 |
| 2 | **Forensics / 復盤** | ⚠️ 失敗路徑由 recovery envelope 覆蓋 | **順手帶上** — 補成功路徑，邊際成本低 |
| 3 | **Self-verification** | ✅ `--plan` + recovery envelope + query 已可組合 | **暫緩** → seed |
| 4 | **Conflict avoidance（並發）** | ⚠️ 弱，需資源二級索引 | **暫緩** → seed |

### 推薦設計輪廓

**儲存：** `.dbcli/audit/<connection>.jsonl`
- 每連線一檔，append-only JSONL
- Rotate by size cap (~10 MB) 或 entry cap (~1000 筆)
- 不做時間保留策略

**Entry schema（agent-facing JSON 合約）：**
```jsonc
{
  "ts": "2026-05-14T...",
  "session_id": "...",
  "engine": "postgres",
  "command": "update",
  "side_effect_tier": "db-write",   // 重用 capability registry
  "target": { "tables": ["users"], "rows_affected": 3 },
  "success": true,
  "recovery_ref": null,             // 失敗時指向 .dbcli/last-recovery.json
  "redacted_sql": "UPDATE users SET email = ? WHERE id = ?"
}
```

**新增 CLI：**
- `dbcli audit tail [--n 20]` — 主路徑（handoff）
- `dbcli audit show <id>` — 詳細（forensics）
- `dbcli audit clear`

**複用既有資產：**
- `src/adapters/capabilities.ts` → `side_effect_tier`
- `tests/helpers/sensitive-output.ts` → SQL body / params redaction
- v1.19.1 agent-facing JSON contract test 模式 → audit entry schema 加 contract test
- Recovery envelope → 失敗時透過 `recovery_ref` 雙向連結

## Trade-offs 與風險

| 項目 | 風險 | 緩解 |
|------|------|------|
| 每條指令一次 disk write | 可量測但可忽略 | 加 `audit.enabled` config 開關 |
| 多進程並發寫入 | POSIX `O_APPEND` 不保證 > PIPE_BUF 的 atomic | File lock；簡單夠用 |
| PII / SQL body 洩漏 | 嚴重 — 不能寫原始 SQL | 強制 reuse redaction，列入 release gate |

## Next Step

跑 `/gsd-new-milestone` 把 [[seeds/v1.20.0-audit-log-milestone]] 正式化為 `.planning/milestones/v1.20.0-ROADMAP.md` + `v1.20.0-REQUIREMENTS.md`。
