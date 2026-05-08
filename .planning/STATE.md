---
gsd_state_version: 1.0
milestone: v1.9.1
milestone_name: Skill Connection Guidance
status: milestone_complete
last_updated: "2026-05-08T12:30:00.000Z"
progress:
  total_phases: 18
  completed_phases: 18
  total_plans: 45
  completed_plans: 45
---

# STATE.md — Current Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-08)

**Core Value:** AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool with sensitive data protection.

**Current Focus:** v1.9.1 released; in-progress feature branch `feat/es-redis-snippets` extends saved queries to Elasticsearch and Redis (merged to `main`, awaiting next release tag).

---

## Milestone Status

**In progress (post-1.9.1, on `main`):** ES / Redis Saved Queries
- Engine strategy refactor (SQL / Elasticsearch / Redis 各自獨立 strategy)
- ES JSON-aware 參數注入、size guard、body validation、index 欄位
- Redis 命令白名單、raw 參數注入（含警告）、range / SCAN size guard
- 內建診斷 snippet：`es-cluster-health`、`redis-key-stats`
- `q @<name>` 與 `q --dry-run` 依 engine family 分派與格式化
- 整合測試：ES / Redis end-to-end saved query 測試

**v1.9.1 — Skill 連線設定指引:** COMPLETE (2026-05-07)
- Skill 文件補上連線設定章節，引導 agent 正確初始化

**v1.9.0 — Agent Task Packs (plan-only 第一版):** COMPLETE (2026-05-06)
- 三層目錄 loader、shell-aware argv splitter、frontmatter parser
- Resolver（過濾 / 查找 / 模糊提示）、planner（參數 + 模板渲染）
- 內建任務 `diagnose-slow-query`
- CLI: `dbcli skill tasks list / show / plan`

**v1.8.0 — Redis & Elasticsearch 完整支援:** COMPLETE (2026-05-06)
- Elasticsearch adapter：execute / list / schema / write 全部完備
- ES Docker 整合測試、`doctor` / `init` / saved-queries 註冊 ES
- Blacklist 改為 case-insensitive 並支援 dotted paths
- Redis / ES `ExecutionResult` 形狀統一
- 早期 unsupported 指令防呆與型別 union 補齊

**v1.7.0 — Saved Queries (snippets):** COMPLETE (2026-05-04)
- YAML mini parser、frontmatter + SQL body 安全分析
- 雙層 loader（builtin + project）、`@name` resolver 與 fuzzy match
- 參數綁定 / `:name` 改寫器、子查詢式 size guard
- CLI：`q @<name>`、`queries list / show / new / edit / check`
- Live PostgreSQL 整合測試，模組覆蓋率 ≥ 80%

**v1.6.0 — Full MongoDB Support:** COMPLETE (2026-04-23)
- MongoDB query / insert / update / delete + blacklist + size guard
- `dbcli skill --install` 同時部署 SKILL.md + reference.md

**Prior milestones:**
- v1.5.x — Layered Schema Cache & MongoDB SRV
- v1.3.0 — Skill Update Reminders
- v1.2.0 — Multi-connection & REPL
- v1.0.0 — Stable Release (DDL & Core)
- v0.2.0-beta — Data Access Control
- v0.1.0-beta — i18n & Schema Optimization

---

## Release Gate

來源：[`docs/feature-matrix.md`](../docs/feature-matrix.md#required-ci-validation)。
兩道指令都必須綠燈、不得 `continue-on-error`，才視為可發版：

| Gate | Command | Status (2026-05-08 12:35 +08:00) |
|------|---------|----------------------------------|
| Typecheck | `bun run typecheck` | ✅ Pass — `tsc --noEmit` 無錯誤（先前 `src/commands/export.ts:187` 的 `result.rowCount` 可能 undefined 已修，fallback 到 `result.rows.length ?? 0`） |
| Tests | `bun test` | ✅ Pass — 1630 pass / 3 skip（PostgreSQL、MySQL live integration 因本機無 Docker 服務跳過）/ 0 fail，3.01s |

Lint、build、benchmark 為 advisory，發版時可參考但不阻擋。
建議：每次要打 release tag（例如下個 `1.10.0`）前再跑一次以上兩道指令，確認都綠燈。

---

## Key Decisions Made

| Decision | Rationale | Status |
|----------|-----------|--------|
| Bun + TypeScript | Fast startup (important for CLI), native TS support | Locked |
| CLI-first, not MPC | Supports Claude Code, Gemini, Copilot, Cursor | Locked |
| Coarse-grained permissions + blacklist | Coarse roles + table/column blacklisting covers security needs | Locked |
| Hybrid init (read .env first) | Minimizes manual input for developers with existing configs | Locked |
| Blacklist over fine-grained ACL | Simpler, covers 90% of sensitive data protection needs | Locked |

---

## Contacts & References

- **Project repo**: `/Users/carl/Dev/CMG/Dbcli`
- **Planning docs**: `.planning/`
- **Reference**: GSD methodology — https://github.com/gsd-build/get-shit-done

---

*Last updated: 2026-03-26 after v0.2.0-beta milestone completion*
