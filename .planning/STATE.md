---
gsd_state_version: 1.0
milestone: v1.19.0
milestone_name: Expanded Antigravity Protocol & Agent Support
status: milestone_complete
last_updated: "2026-05-13T07:30:00.000Z"
progress:
  total_phases: 20
  completed_phases: 20
  total_plans: 47
  completed_plans: 47
post_release:
  branch: main
  note: "Contract stabilization (capability registry + JSON contract / redaction guards) landed on main after v1.19.0 tag; awaiting next release."
---

# STATE.md — Current Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-13)

**Core Value:** AI agents can safely and intelligently access project databases through a single, permission-controlled CLI tool with sensitive data protection.

**Current Focus:** v1.19.0 released — Expanded Antigravity Protocol (Phase 0 Scout + Phase 3 Auditor), Codex (OMX) + Windsurf agent installers, Cursor `.cursor/rules/*.mdc` migration, project-level `GEMINI.md`. Post-release contract stabilization on `main` (commits `aba0a25..9c9aafb`): typed capability registry, locked agent-facing JSON contracts (inspect / report / guide / recovery), expanded redaction guards, documented side-effect tiers — awaiting next release tag.

---

## Milestone Status

**v1.19.0 — Expanded Antigravity Protocol & Agent Support:** COMPLETE (2026-05-11)
- Antigravity workflow 加入 Phase 0 (Scout) 研究階段與 Phase 3 (Auditor) 驗證階段
- `dbcli skill --install` 擴充支援 Codex (OMX) 與 Windsurf 平台
- `dbcli skill --install cursor` 改用 `.cursor/rules/*.mdc` 專案本地格式
- 新增專案層級 `GEMINI.md`，提供完整 Antigravity 生命週期指引

**v1.18.0 — Interactive HTML Dashboards:** COMPLETE (2026-05-11)
- React + Recharts + Tailwind 儀表板模板開發
- Bun-native 資源打包與 inlining 邏輯
- `--ui` 與 `--format html` 指令支援
- Saved-query `visual:` frontmatter 擴展
- 安全性：HTML escaping 與 Blacklist 強制過濾

**v1.17.0 — Guided Remediation & Multi-turn Recovery:** COMPLETE (2026-05-10)
- `dbcli recover --apply` 與 `--next` 指令上線
- 具備風險門控與驗證步驟 (P4) 的自動化復原流程
- 信任邊界強化與 RecoveryEnvelope 標準化

**v1.11.0 — Saved Queries Discovery:** COMPLETE (2026-05-08)
- `queries search` / `queries suggest` 指令上線
- frontmatter 加 optional `intent`，9 個 v1 namespace
- 9 個新內建診斷 snippet (ES x4 / Redis x4 / SQL x1)
- SKILL.md 補上 discovery 流程指引

**v1.10.1 — Packaging & Security Hotfix:** COMPLETE (2026-05-08)
- 修 npm 1.10.0 安裝後 packaged assets path 找不到（`src/utils/package-root.ts`）
- 修 `dbcli q` 略過 blacklist 檢查的安全漏洞
- 新增 `tests/integration/dist-smoke.test.ts` 守護 packaged assets path
- 清掉 45 個 lint warnings 並把 `--max-warnings=0` 設為 release-blocking

**v1.10.0 — ES / Redis Saved Queries:** COMPLETE (2026-05-08)
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

單一事實來源：[`docs/feature-matrix.md`](../docs/feature-matrix.md#required-ci-validation)。
打 release tag 前的完整流程：[`CONTRIBUTING.md → Release Process`](../CONTRIBUTING.md#release-process)。
以下四道指令都必須綠燈、不得 `continue-on-error`，才視為可發版：

| Gate | Command | Status (2026-05-13 +08:00) |
|------|---------|----------------------------|
| Typecheck | `bun run typecheck` | ✅ Pass — `tsc --noEmit` 無錯誤（v1.19.0 + 後續 main 皆綠） |
| Tests | `bun test` | ✅ Pass — v1.19.0 + 合約穩定化測試（inspect / report / guide / recovery / capabilities）皆綠 |
| Lint | `bun run lint` | ✅ Pass — `--max-warnings=0` release-blocking |
| Build | `bun run build` | ✅ Pass — `dist/cli.mjs` 由 dist smoke + UI bundle 決定性 (`NODE_ENV=production`) 守護 |

Benchmark（`bun run test:perf`）為 advisory，不擋 release。詳見 CONTRIBUTING.md 的 Pre-Release Checklist。

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

*Last updated: 2026-05-13 — synced to v1.19.0; post-release contract stabilization shipped on `main` awaiting next release tag.*
