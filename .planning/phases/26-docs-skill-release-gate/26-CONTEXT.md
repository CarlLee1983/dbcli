# Phase 26: Docs, Skill & Release Gate - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

把 Phase 21–25 已 shipped 的 v1.20.0 audit log 包成可發版的對外文件 + release gate：

- **DOCS-01：** `assets/SKILL.md` 新增「Audit Log usage」章節（handoff / forensics 兩種情境），並出中文版 `assets/SKILL.zh-TW.md`（全檔翻譯，含新章節）。`dbcli skill --install <platform>` 用 `--lang` flag 選擇要部署哪一版。
- **DOCS-03：** `docs/feature-matrix.md` 加 `audit` row、把 audit subcommands 補進 Side-effect tiers table；`scripts/release-check.sh` 新增 doc-presence check（feature-matrix audit row + CHANGELOG version heading 雙抓）。
- **DOCS-04：** `README.md` / `README.zh-TW.md` 補 audit log 介紹 + D1 default-on upgrade-impact 顯眼提示；`CHANGELOG.md` 加 v1.20.0 段（Added / Changed / 含 D1 impact + Phase 23-04 partial 揭露）。
- **Release gate：** `bun run release:check` 全綠（typecheck / prettier --check / lint `--max-warnings=0` / `bun test` / build / dist smoke / **新增的 doc-presence check**）。

**包含：**
- 雙語 SKILL.md（`SKILL.md` 英 + `SKILL.zh-TW.md` 中，全檔翻譯）
- `dbcli skill --install` 加 `--lang en|zh-TW`，預設 `en`（不變動現有行為）
- `docs/feature-matrix.md` 加單列 `audit` row + Side-effect tiers 表 examples 補 audit
- `scripts/release-check.sh` 加 doc-presence step（grep feature-matrix audit row + CHANGELOG version）
- `README.md` / `README.zh-TW.md` 加 audit log 區段 + D1 upgrade-impact 顯眼提示
- `CHANGELOG.md` v1.20.0 段：Added（audit CLI / writer / recovery linkage）、Changed（inspect/guide/recover JSON embeds audit_recent；D1 default-on upgrade impact；Phase 23-04 follow-up known limitation）
- `docs/user/{en,zh-TW}/index.{md,html}` 同步加 audit 訊息（AGENTS.md parity rule）

**不包含（後續 milestone / 已 shipped）：**
- 任何 audit log 行為層改動（Phase 21–25 已 ship；本 phase 只描述、不改 runtime）
- 把 Phase 23-04 unwired 6 commands 補上 `writeAuditEntry` → 屬 v1.20.x patch milestone，**僅在 CHANGELOG 揭露為 known limitation**
- 為 SKILL/reference 加更多語系（日 / 韓 / 簡中）→ 不在 v1.20.0 範圍
- 在 release-check.sh 上多疊 hash-chain / tamper-evident 檢查 → out of scope（compliance roadmap）
- `assets/reference.md` 中文化（DOCS-01 只指名 SKILL.md）

</domain>

<decisions>
## Implementation Decisions

### A. SKILL.md 雙語交付（DOCS-01）

- **D-71:** **`assets/SKILL.zh-TW.md` 為 SKILL.md 全檔中譯**，不是只翻新增的「Audit Log usage」段。理由：(1) 與 `README.md` ⇄ `README.zh-TW.md` 既有 split-file 慣例一致；(2) `dbcli skill --install --lang zh-TW` 部署後 agent 不會看到混雜語言；(3) 鎖死 AGENTS.md「Multi-language Parity」doctrine — 之後任何 SKILL.md 變更，PR review 都要同步 `SKILL.zh-TW.md`。新增「Audit Log usage / Audit Log 使用」段同時上 EN + ZH。
- **D-72:** **`assets/reference.md` 維持英文唯一**。DOCS-01 字面僅指明 SKILL.md；reference.md 是 1254 行密度極高的旗標 / 範例 cheatsheet，agent 主要靠 SKILL.md 認識工作流，再回 reference.md 查語法。中文化 reference.md 不在 v1.20.0 範圍（也不在任何已立案 milestone）。
- **D-73:** **`dbcli skill --install <platform>` 加 `--lang en|zh-TW`，預設 `en`**。不從 `DBCLI_LANG` env 或系統 `LANG` 自動推斷。理由：(1) 既有 install 行為（無 flag = 英文）零破壞；(2) container / CI 環境 env 不可靠；(3) 顯式 flag 對 agent / 文件都好寫範例（`dbcli skill --install claude --lang zh-TW`）。Phase 26 commander 改動只 +1 個 string option，installer 內部根據 lang 決定要拷貝 `SKILL.md` 或 `SKILL.zh-TW.md` 為目標檔（檔名統一為 `SKILL.md` 在目標目錄，與既有契約一致）。
- **D-74:** **檔名統一為 `SKILL.zh-TW.md`**，跟隨 `README.zh-TW.md` 既有 region-suffix 慣例。不採 `SKILL.zh.md`。Installer 目標檔名保留為 `SKILL.md`（不論來源是 `SKILL.md` 或 `SKILL.zh-TW.md`），agent / 平台目錄不會出現第二個檔名。

### B. feature-matrix audit row + Release gate（DOCS-03）

- **D-75:** **單列 `audit` row + N/A 跨引擎**，沿用 `recover` / `skill` precedent。Notes 欄位列出 4 個子指令（tail / show / clear / health）與 tier 對照。不拆 4 列、不拆 2 列（readonly + clear）。理由：audit 為 engine-independent local capability，跨引擎 N/A 已表達清楚；拆列只是增加表格噪音。
- **D-76:** **side-effect tier 對應**：`audit tail` / `audit show` / `audit health` = `readonly`；`audit clear` = `local-write`。直接對齊 Phase 24 已落地的 `src/adapters/capabilities.ts`。Side-effect tiers 表的 examples 欄位補 audit subcommands（`audit tail` 進 readonly 例、`audit clear` 進 local-write 例）。不把 `audit clear` 標 `interactive`（D-45 互動確認屬於 commander 層 prompt，不改變 tier；tier 表達的是「對連線 DB / 本地檔的副作用」，clear 副作用是寫本地檔系統）。
- **D-77:** **`scripts/release-check.sh` 加 doc-presence step**，**release-blocking**。實作走純 shell grep（與其他 step 風格一致），不寫 TypeScript integration test。理由：(1) 與 `--max-warnings=0` release-blocking precedent 同層；(2) 純 grep 比 `bun test` 啟動快 10x，適合放在 step 序列開頭；(3) doc 漂移屬於「forgot to update」類缺陷，shell grep 抓得到就夠。
- **D-78:** **doc-presence check 的 grep 範圍鎖兩條**：
  1. `docs/feature-matrix.md` 含「以 `| `audit`` 開頭的 row」— 不依賴 sentinel comment，直接抓 markdown table row。
  2. `CHANGELOG.md` 含 `## [<package.json version>]` heading — 用 `node -p` 讀 `package.json` 抽 version，再 grep。

  **不**把 SKILL.md / SKILL.zh-TW.md 的「Audit Log usage」heading 納入此 check（D-73 + AGENTS.md PR review 已守）；**不**對 README 加 sentinel HTML comment。Sentinel marker 屬於 cargo-cult；release 守的應該是「對外文件存在性」，內容正確性靠 PR review + 既有 contract test。

### C. Planner Discretion（保留給 planner / researcher）

以下三塊 user 明確選擇「lock as planner discretion」，CONTEXT.md 給建議默認；planner 在 PLAN.md 階段可改動但要記錄理由。

- **E. Phase 23-04 partial coverage disclosure（DOCS-04 honesty）** — 建議：CHANGELOG `### Changed` 區段加單行 known-limitation：

  > Audit log captures `query`, `inspect`, and diagnostic-surface commands in v1.20.0; coverage for `insert / update / delete / export / q / schema` is tracked as Phase 23-04 follow-up (see `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`). Recovery envelope linkage is unaffected.

  理由：STATE.md / 25-J1-COVERAGE-MATRIX.md 已把這條 follow-up 公開成 known backlog；CHANGELOG 揭露讓 agent / 升級用戶不會把它當 silent bug。不採「block release 直到 23-04 上」（會把 v1.20.0 卡到下個 sprint）、不採「silent + 之後 patch 補上」（誠信問題）。

- **F. README D1 upgrade-impact 配置（DOCS-04）** — 建議：
  1. `README.md` / `README.zh-TW.md` 新增 top-level `## Audit Log`（在 `## AI Integration Guide` 之後、`## Troubleshooting` 之前），首段用 `>` blockquote 標 default-on 升級影響：

     > **Default ON since v1.20.0.** Existing projects will begin creating `.dbcli/audit/<connection>.jsonl` on first command. Set `audit.enabled = false` in `.dbcli` to opt out.
  2. `CHANGELOG.md` 在 `### Changed` 重複一行帶 `**Default-on, upgrade impact:**` 前綴。
  3. 採 top-level section 而非塞進「Recovery & Guided Remediation」子段：audit log 與 recovery 是兩個獨立 capability，混在一起會誤導 user 以為 audit 只在失敗時觸發。

- **G. `docs/user/{en,zh-TW}/index.{md,html}` parity 範圍（AGENTS.md 強制）** — 建議：
  1. `Health, Diagnostics & Recovery` table 加 `audit` row（一行 description）— 對齊 `recover --apply` 同表格 surface。
  2. `Database Engine Support Matrix` **不**加 audit row（該表是 engine-by-engine feature 對照，audit 是 cross-engine local capability，列上去語意錯）。
  3. `AI Agent Integration` 段加一條 bullet：`**Audit Log**: see SKILL.md / README §Audit Log`。
  4. `.html` 與 `.md` 同步（AGENTS.md format parity rule），en / zh-TW 同步（AGENTS.md multi-language parity rule）— 共 4 檔。
  5. **不**為 audit 寫獨立大段內容到 user docs index；index 是入口型 surface，深度章節留在 SKILL.md / reference.md / README §Audit Log。

planner 可選擇把 E / F / G 任一拆出獨立 plan，或合進 DOCS-04 一個 plan。如果 planner 對 F 的 README 位置（top-level vs 子段）想改動，必須在 PLAN.md 裡點出與 D-77 / D-78 doc-presence check 的相容性（check 不會驗 README 結構，但 PR review 會）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 26 source-of-truth specs

- `.planning/ROADMAP.md` §«Phase 26: Docs, Skill & Release Gate» — phase boundary, success criteria, requirement mapping (DOCS-01 / -03 / -04)。
- `.planning/REQUIREMENTS.md` §DOCS — DOCS-01 / -03 / -04 verbatim text (line 67-72)。
- `.planning/STATE.md` §«Accumulated Context» — D1–D6 locked decisions + Phase 25 J1 asymmetry carried-forward note (line 168)。

### Prior phase CONTEXT.md（影響 Phase 26 描述的 runtime 行為）

- `.planning/phases/21-audit-writer-foundation/21-CONTEXT.md` — Writer foundation + `.dbcli/audit/` storage + `audit.enabled` config（D1 / CONFIG-* 起源）。
- `.planning/phases/22-entry-schema-redaction-contract/22-CONTEXT.md` — Entry schema + redaction contract（D3）。
- `.planning/phases/23-engine-integration-rejection-paths/23-CONTEXT.md` — Engine integration（**Phase 23-04 follow-up 揭露 base**）。
- `.planning/phases/24-audit-cli/24-CONTEXT.md` — `dbcli audit` CLI 表面 + D-31..D-46（subcommand 名稱、`--for-agent` / `--brief` shape、`audit clear` 互動確認）— SKILL.md 範例必須對齊此契約。
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md` — D-50..D-61（envelope linkage、`audit_recent` 嵌入 inspect/guide/recover）— SKILL.md「forensics 情境」範例直接引用。
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` — Phase 23-04 partial coverage 全表（6 unwired commands 清單）— CHANGELOG known-limitation 引用來源。

### 對外文件目標檔（Phase 26 會寫入）

- `assets/SKILL.md` — 既有 393 行英文 SKILL；新增「Audit Log usage」段（DOCS-01）。
- `assets/SKILL.zh-TW.md` — **新檔**；SKILL.md 全檔中譯（D-71 / D-74）。
- `assets/reference.md` — 既有 1254 行英文 reference；新增 `### audit` subcommand 區段（搭配 Phase 24 `dbcli audit` 表面）。**不**做中文化（D-72）。
- `docs/feature-matrix.md` — 新增 `audit` row（D-75）+ Side-effect tiers 表 examples 補 audit（D-76）。
- `README.md` / `README.zh-TW.md` — 新增 top-level `## Audit Log` 段 + D1 upgrade-impact blockquote（建議 F）。
- `CHANGELOG.md` — 新增 `## [1.20.0] - <release date>` 段（Added / Changed；含 D1 impact + Phase 23-04 known limitation）。
- `docs/user/en/index.md`、`docs/user/en/index.html`、`docs/user/zh-TW/index.md`、`docs/user/zh-TW/index.html` — 同步加 audit table row + AI Agent Integration bullet（建議 G）。

### 工具 / 配置（Phase 26 會修改或新增 check）

- `scripts/release-check.sh` — 既有 7 step；新增 doc-presence check（D-77 / D-78）為第 0 或第 8 step（planner 決定位置）。
- `src/commands/skill.ts` — 新增 `--lang en|zh-TW` commander option（D-73）+ installer 內部 source-file 選擇邏輯。
- `src/adapters/capabilities.ts` — **read-only reference**；Side-effect tier 對照來源（D-76 必須對齊此檔，不另定 enum）。
- `CONTRIBUTING.md` §«Release Process» — pre-release checklist；Phase 26 完成後在此補一行 doc-presence check（與 release-check.sh 同步）。
- `AGENTS.md` §«Development Lifecycle» — Multi-language Parity + Format Parity rule（建議 G 的 doctrine 來源）。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/i18n/message-loader.ts` — 既有 `en` + `zh-TW` locale loader、`DBCLI_LANG` env 解析；Phase 26 commander 加 `--lang` flag 不需動 i18n core，只是把 flag 值轉成 file-picker 路徑。
- `README.md` ⇄ `README.zh-TW.md` split-file pattern — 直接套用到 `SKILL.md` ⇄ `SKILL.zh-TW.md`。
- `docs/user/{en,zh-TW}/index.{md,html}` 既有 4-檔 parity layout — 已有 mirror 結構，新增 audit content 只是「在 4 個檔同位置加同樣段落」的機械工作。
- `scripts/release-check.sh` 既有 7-step shell pattern — 加第 8 step `doc-presence` 走同樣 `step '8/8 ...'` + `set -euo pipefail` 風格、不引入 node-based test framework。
- `src/adapters/capabilities.ts` SideEffectTier enum — D-76 直接 reuse；feature-matrix 表格的 tier 值不得另定義。

### Established Patterns

- **i18n message keys 走 `t()` + `t_vars()`**（`src/i18n/message-loader.ts`）— Phase 26 若需要在 `dbcli skill --install --lang zh-TW` 加完成訊息，沿用既有 key 命名空間（`skill.install.*`）。
- **doc-key sentinel** — `docs/user/{en,zh-TW}/index.md` 用 `<!-- doc-key: xxx -->` 標 section（line 152 `advanced-tools` 為例）。Phase 26 加 audit row / bullet 時建議用同 sentinel pattern（不是 release-check 抓的，而是給 doc maintainer 工具用）。
- **CHANGELOG `## [x.y.z] - yyyy-mm-dd` heading 格式** — Keep a Changelog 標準；D-78 grep 直接抓此 heading。

### Integration Points

- **`dbcli skill --install <platform> --lang <lang>` 進入點**：`src/commands/skill.ts` 既有 commander chain — Phase 26 加 `.option('--lang <lang>', '...', 'en')` + install handler 根據 lang 選來源檔（branch on `lang === 'zh-TW'` → 拷貝 `assets/SKILL.zh-TW.md` else `assets/SKILL.md`）。Target 目錄與檔名不變（目標永遠是 `SKILL.md`）。
- **release gate 的 single source of truth**：`docs/feature-matrix.md` §«Required CI validation» + `CONTRIBUTING.md` §«Release Process» — 兩處都要在 Phase 26 結尾加上「doc-presence check」這條 step（與 `release-check.sh` 同步）。
- **AGENTS.md parity 鎖**：對 `SKILL.md` ⇄ `SKILL.zh-TW.md`、`README.md` ⇄ `README.zh-TW.md`、`docs/user/{en,zh-TW}/index.{md,html}` 任一單檔修改未同步另一檔，後續 PR review 都應退單；Phase 26 不必為此寫 automated check（doctrine + review 足夠）。

</code_context>

<specifics>
## Specific Ideas

- D1 upgrade impact 語氣要「冷靜陳述事實 + 一行 opt-out 指令」，不要寫 alarm 樣式（避免 v1.20.0 被誤讀為 breaking release — semver 上它是 minor、預設行為改動屬於 audit 觀測層而非 API 層）。
- SKILL.md「Audit Log usage」段必須給兩個具體 use case：
  1. **Session handoff** — agent A 結束時、agent B 接手前，B 跑 `dbcli audit tail --for-agent --n 10` 得知前一 session 在這個連線上做了什麼。
  2. **Forensics** — 跑 `dbcli recover --format json` 看到 `audit_recent` 嵌入內容、用 `recovery_ref` ⇄ `audit_ref` 雙向 cross-ref 重建失敗現場。
- 中譯 SKILL 時，技術詞彙（command 名、檔案路徑、JSON 鍵）**保留英文**；只翻 narrative 段落與「why use it」解釋。對齊 `README.zh-TW.md` 既有風格。
- 雙語 SKILL 第一次落地 PR 建議走「先英文版加 Audit Log 段 + zh-TW 版同步」一起 ship，不要分兩個 PR — AGENTS.md parity rule 不允許英文先 land 而中文落後一個 sprint。

</specifics>

<deferred>
## Deferred Ideas

- **`assets/reference.md` 中文化** — 1254 行密度極高的 cheatsheet 翻譯成本與 ROI 不對等；deferred 直到觀察到非英文用戶 / agent 寫的需求訊號（v1.21.x 或之後）。
- **`docs/user/{en,zh-TW}/index.{md,html}` 加 Audit Log 獨立大段** — Phase 26 只在 index 補 table row + bullet；獨立「Audit Log」chapter 不在 v1.20.0 範圍（user 一旦要深度教學就回 SKILL.md / README §Audit Log）。
- **`release-check.sh` 加 SKILL.md 雙語 heading 一致性自動 check** — D-78 已決定不抓；deferred 給「真的發生英文有段、中文漏段」的事件後再加。
- **Audit log 對外發布 marketing material（blog post / Twitter）** — 非工程範圍；不在 Phase 26 / GSD workflow 內，由 user 自行決定。
- **Phase 23-04（wire writeAuditEntry into 6 unwired catch blocks）** — 已記錄在 STATE.md / 25-J1-COVERAGE-MATRIX.md / CHANGELOG known-limitation；本 phase 不執行，留給 v1.20.x 之後的 patch milestone。

</deferred>

---

*Phase: 26-docs-skill-release-gate*
*Context gathered: 2026-05-16*
