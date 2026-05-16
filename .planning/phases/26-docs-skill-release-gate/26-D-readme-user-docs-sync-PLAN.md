---
phase: 26-docs-skill-release-gate
plan: D
type: execute
wave: 3
depends_on:
  - 26-C
files_modified:
  - README.md
  - README.zh-TW.md
  - docs/user/en/index.md
  - docs/user/en/index.html
  - docs/user/zh-TW/index.md
  - docs/user/zh-TW/index.html
autonomous: true
requirements: [DOCS-04]
requirements_addressed: [DOCS-04]
tags: [docs, readme, user-docs, i18n, audit-log]

must_haves:
  truths:
    - "Both `README.md` and `README.zh-TW.md` have a new top-level `## Audit Log` section (EN) / `## 稽核日誌 (Audit Log)` section (ZH) placed between AI Integration Guide and Troubleshooting (Discretion F item 1)."
    - "The first paragraph of each new section is a `>` blockquote containing the D1 default-on upgrade-impact callout (`**Default ON since v1.20.0.** ...`) — calm-factual tone, not alarm (CONTEXT specifics line 151)."
    - "All 4 user-docs files (`docs/user/{en,zh-TW}/index.{md,html}`) have a new `audit` table row inside `<!-- doc-key: diagnostics-recovery -->` AND a new `Audit Log` bullet inside `<!-- doc-key: ai-agent-integration -->` (Discretion G items 1 + 3 + 4)."
    - "No new doc-key sentinel introduced (`scripts/check-user-docs.ts` 14-key list stays frozen; Pitfall 4 + Discretion G item 5)."
    - "No `audit` row added to `## Database Engine Support Matrix` in user-docs (audit is cross-engine local; Discretion G item 2)."
    - "`bun run docs:check` exits 0 (4-file parity holds)."
    - "`bun run release:check` exits 0 end-to-end (proves Phase 26 is shippable)."
  artifacts:
    - path: "README.md"
      provides: "Top-level `## Audit Log` section with D1 blockquote + known-limitation"
      contains: "## Audit Log"
    - path: "README.zh-TW.md"
      provides: "Top-level `## 稽核日誌 (Audit Log)` section with D1 blockquote (ZH) + known-limitation"
      contains: "## 稽核日誌"
    - path: "docs/user/en/index.md"
      provides: "audit table row + AI Agent Integration bullet (inside existing doc-keys)"
    - path: "docs/user/en/index.html"
      provides: "audit card + AI agent bullet (HTML mirror of .md)"
    - path: "docs/user/zh-TW/index.md"
      provides: "ZH audit table row + AI agent bullet"
    - path: "docs/user/zh-TW/index.html"
      provides: "ZH HTML mirror"
  key_links:
    - from: "README.md (## Audit Log)"
      to: "assets/SKILL.md (## Audit Log usage)"
      via: "deeper agent workflows cross-link"
      pattern: "SKILL\\.md.*Audit Log usage"
    - from: "README.md (Known limitation)"
      to: ".planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md"
      via: "Phase 23-04 follow-up pointer"
      pattern: "Phase 23-04"
    - from: "docs/user/en/index.md (audit row + bullet)"
      to: "docs/user/en/index.html (audit card + bullet)"
      via: "AGENTS.md format parity rule + bun run docs:check"
      pattern: "audit"
---

<objective>
Land the final user-facing documentation for v1.20.0: top-level `## Audit Log` section in both READMEs (EN + ZH) with prominent D1 default-on upgrade-impact blockquote, and a synchronized table row + AI agent bullet across all 4 `docs/user/*/index.{md,html}` files — strictly inside existing doc-keys so `scripts/check-user-docs.ts` parity stays green.

Purpose: DOCS-04 user-facing narrative — existing users upgrading to v1.20.0 see the audit log mentioned at the README level (not just CHANGELOG), with a calm-factual tone explaining the new `.dbcli/audit/<conn>.jsonl` directory and the one-line opt-out. User-docs index files (the polished "marketing" surfaces) gain a single table row + bullet — no standalone audit chapter, no new doc-key (Pitfall 4). Phase 26 is then fully shippable: `bun run release:check` end-to-end green confirms gate.

Output: 6 documentation files updated; 4 of them governed by `docs:check` parity rules.

Implements decisions: Discretion F (top-level `## Audit Log` in both READMEs, between AI Integration Guide and Troubleshooting, `>` blockquote with default-on callout, calm-factual tone), Discretion G (1) `audit` row in `diagnostics-recovery` table only, (2) NO row in `engine-support` matrix, (3) `Audit Log` bullet in `ai-agent-integration`, (4) `.md` + `.html` parity, (5) no standalone chapter / no new doc-key.

Depends on: Plan C (CHANGELOG version + release-check step must exist before final docs sweep). Wave 3.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/26-docs-skill-release-gate/26-CONTEXT.md
@.planning/phases/26-docs-skill-release-gate/26-RESEARCH.md
@.planning/phases/26-docs-skill-release-gate/26-PATTERNS.md
@.planning/phases/26-docs-skill-release-gate/26-VALIDATION.md

# Source of truth for known-limitation cross-link
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md

# Files modified
@README.md
@README.zh-TW.md
@docs/user/en/index.md
@docs/user/en/index.html
@docs/user/zh-TW/index.md
@docs/user/zh-TW/index.html

# Read-only references
@scripts/check-user-docs.ts

# Prior plan outputs
@.planning/phases/26-docs-skill-release-gate/26-A-SUMMARY.md
@.planning/phases/26-docs-skill-release-gate/26-B-SUMMARY.md
@.planning/phases/26-docs-skill-release-gate/26-C-SUMMARY.md

<interfaces>
<!-- Existing structural anchors in README.md -->

From README.md (verify line numbers in your read):
- Insert `## Audit Log` AFTER `## AI Integration Guide` section ends (~line 1253) and BEFORE `## Troubleshooting` (~line 1256). README is NOT checked by `scripts/check-user-docs.ts` — safe to add `## ` section freely (RESEARCH Pattern 5).

From README.zh-TW.md:
- Insert `## 稽核日誌 (Audit Log)` at the analogous position — after `## AI 整合指南` (~line 1043) and before `## 故障排除` (~line 1152). Use bilingual heading hybrid `中文 (English)` per README.zh-TW.md:75 precedent.

<!-- Existing user-docs structure -->

`docs/user/en/index.md` (PATTERNS §8):
- `<!-- doc-key: diagnostics-recovery -->` block at line 140-150 — currently has 6 rows (doctor / check / diff / report / guide / recover --apply). Append 1 row.
- `<!-- doc-key: ai-agent-integration -->` block at line 192-201 — currently has 4 numbered bullets. Append bullet 5.

`docs/user/en/index.html` (PATTERNS §9):
- `<!-- doc-key: diagnostics-recovery -->` at line 236-251 has 3 cards (doctor / report / recover). Add 4th card (audit).
- `<!-- doc-key: ai-agent-integration -->` at line 325-335 has 4 `<li>` items. Add 5th.

`docs/user/zh-TW/index.{md,html}` (PATTERNS §10): structurally identical to EN counterparts; only narrative text translates.

<!-- check-user-docs.ts constraint -->

`scripts/check-user-docs.ts:3-19` has a FROZEN array of 14 required doc-keys. Adding a new `<!-- doc-key: audit -->` would create a 15th key with no required-list enforcement — permanent maintenance liability. Discretion G item 5 explicit lock: inline into existing keys ONLY.
</interfaces>
</context>

<execution_order>
Tasks within this plan are sequential. Execute in this order: **D-1 -> D-2 -> D-3 -> D-4 -> D-5 -> D-6**.

- D-1, D-2 (READMEs EN + ZH) ship together — AGENTS.md Multi-language Parity rule.
- D-3, D-4, D-5, D-6 (4 user-docs files) ship together — `bun run docs:check` parity rule.
- Run `bun run docs:check` after D-6.
- Run `bun run release:check` as final verification after all 6 tasks land.
</execution_order>

<tasks>

<task type="auto">
  <name>Task D-1: Add `## Audit Log` section to `README.md` (EN)</name>
  <files>README.md</files>

  <read_first>
    - README.md (full file — locate `## AI Integration Guide` section end and `## Troubleshooting` section start; insertion point is between them)
    - README.md:155-192 (`### Recovery & Guided Remediation` analog block — structure to mirror)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«5. README.md» (Discretion F default placement + verbatim content)
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Code Examples» Example 5 (full README §Audit Log skeleton)
    - .planning/phases/26-docs-skill-release-gate/26-CONTEXT.md §«Specific Ideas» line 151 (tone: calm factual + opt-out one-liner; NOT alarm)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md (Known limitation citation source)
  </read_first>

  <action>
    Insert a new top-level (`## `) section into `README.md` between `## AI Integration Guide` and `## Troubleshooting`. The section MUST be inserted at heading level `## ` (NOT `###`) — Discretion F default: top-level capability section.

    Insert this content VERBATIM:

    ```markdown
    ---

    ## Audit Log

    > **Default ON since v1.20.0.** Existing projects will begin creating
    > `.dbcli/audit/<connection>.jsonl` on first command after upgrading.
    > Set `audit.enabled = false` in `.dbcli` to opt out.

    Every command that touches a database writes a structured JSONL entry to
    `.dbcli/audit/<connection>.jsonl`. Inspect the recent history with:

    ```bash
    dbcli audit tail --n 10                    # last 10 entries on current connection
    dbcli audit tail --all --for-agent         # cross-connection JSON envelope
    dbcli audit show <uuid-prefix>             # full entry by id prefix (>=4 chars)
    dbcli audit show --recovery-ref <uuid>     # find entry that emitted a recovery envelope
    dbcli audit health                         # writer state, rotation %, last write status
    dbcli audit clear                          # erase audit log for current connection (prompts y/N)
    ```

    Entries are **metadata-only** — never raw SQL bodies, never `--param` values,
    never result cell contents. Redaction comes from the same source as v1.19.1's
    agent-facing JSON contracts (`tests/helpers/sensitive-output.ts`).

    **Recovery envelope linkage.** When a `--recovery` failure writes
    `.dbcli/last-recovery.json`, the audit entry's `recovery_ref` field and the
    envelope's `audit_ref` field reference each other. Agents can pivot between
    audit history and recovery envelopes from either direction. The
    `inspect` / `guide` / `recover` / `recover --apply` JSON output embeds
    `audit_recent: AuditEntryBrief[]` (last 5 entries) so a fresh session has
    immediate context.

    **Known limitation (v1.20.0):** Bi-directional linkage is wired for `query`,
    `inspect`, and diagnostic surfaces. The DML commands `insert / update / delete /
    export / q / schema` emit single-direction recovery envelopes (no `audit_ref`)
    in v1.20.0; full coverage is tracked as Phase 23-04 follow-up. See
    [`.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`](./.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md)
    for the full matrix.

    For deeper agent workflows (session handoff, forensics walk-through), see
    [`assets/SKILL.md`](./assets/SKILL.md) §Audit Log usage.

    ---
    ```

    **Hard constraints (Discretion F + PATTERNS §5 Pitfalls):**
    - Heading is `## Audit Log` (top-level). Do NOT use `### `.
    - First child of the section is the `>` blockquote — verbatim wording starting `**Default ON since v1.20.0.**`. Discretion F item 1 explicit.
    - Tone is calm-factual: state what happens + one-line opt-out. Do NOT add words like "WARNING", "IMPORTANT", "ALERT" — CONTEXT specifics line 151 lock: v1.20.0 is semver-minor; the audit log is observability-tier, not API-tier.
    - Insertion point: between `## AI Integration Guide` and `## Troubleshooting`. Use the existing `---` thematic-break style around the section (mirrors other top-level sections like `## Multi-connection Support`).
    - Do NOT add `<!-- audit-section -->` sentinel HTML comments — D-78 lock + RESEARCH Don't-Hand-Roll row 5.
  </action>

  <verify>
    <automated>grep -qE '^## Audit Log$' README.md && grep -qE 'Default ON since v1\.20\.0' README.md && grep -qF 'audit.enabled = false' README.md && grep -q '25-J1-COVERAGE-MATRIX' README.md && grep -q 'insert / update / delete / export / q / schema' README.md && grep -qF 'audit_recent: AuditEntryBrief' README.md</automated>
  </verify>

  <done>
    - `README.md` contains `^## Audit Log$` heading.
    - First content under heading is a `>` blockquote starting with `**Default ON since v1.20.0.**`.
    - Section cites the 6 unwired commands and links to `25-J1-COVERAGE-MATRIX.md`.
    - Cross-link to `assets/SKILL.md` §Audit Log usage present.
    - No `<!-- audit-section -->` sentinels added.
    - Tone is calm-factual (no alarm words).
  </done>
</task>

<task type="auto">
  <name>Task D-2: Add `## 稽核日誌 (Audit Log)` section to `README.zh-TW.md` (ZH mirror)</name>
  <files>README.zh-TW.md</files>

  <read_first>
    - README.zh-TW.md (full file — locate `## AI 整合指南` end ~line 1043 and `## 故障排除` start ~line 1152; insertion point is between them)
    - README.zh-TW.md:75-102 (`### 復原與引導式修復 (Recovery & Guided Remediation)` analog — bilingual heading style + bullet labels)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«6. README.zh-TW.md» (verbatim content + Pitfall 11 — backticked tech terms stay English)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«Pattern S3 — Bilingual technical-term policy»
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«Pattern S4 — D1 upgrade-impact callout»
  </read_first>

  <action>
    Insert this new top-level section into `README.zh-TW.md` at the analogous position (between `## AI 整合指南` and `## 故障排除`). Use bilingual heading `## 稽核日誌 (Audit Log)` per README.zh-TW.md:75 precedent.

    Insert this content VERBATIM:

    ```markdown
    ---

    ## 稽核日誌 (Audit Log)

    > **自 v1.20.0 起預設啟用。** 既有專案在升級後第一次執行 dbcli 指令時，將會開始在
    > `.dbcli/audit/<connection>.jsonl` 寫入結構化稽核紀錄。
    > 如需停用，請在 `.dbcli` 設定 `audit.enabled = false`。

    每個接觸資料庫的指令都會寫入一筆結構化 JSONL 紀錄至
    `.dbcli/audit/<connection>.jsonl`。可用以下指令檢視歷史：

    ```bash
    dbcli audit tail --n 10                    # 當前連線最近 10 筆
    dbcli audit tail --all --for-agent         # 跨連線合併（agent JSON envelope）
    dbcli audit show <uuid-prefix>             # 完整單筆 entry（>=4 字元 prefix）
    dbcli audit show --recovery-ref <uuid>     # 反向找出觸發 envelope 的 entry
    dbcli audit health                         # writer 狀態、rotation 用量、最近寫入結果
    dbcli audit clear                          # 清空當前連線的 audit log（互動確認）
    ```

    Entries 為 **metadata-only** — 不含原始 SQL body、不含 `--param` 值、不含 result cell。
    Redaction 沿用 v1.19.1 agent-facing JSON 合約的同一來源
    （`tests/helpers/sensitive-output.ts`），不重複定義。

    **與 recovery envelope 的雙向連結。** 當 `--recovery` 路徑失敗寫入
    `.dbcli/last-recovery.json` 時，audit entry 的 `recovery_ref` 與 envelope 的
    `audit_ref` 互為指標。Agent 可從任一側跳到另一側。`inspect` / `guide` / `recover` /
    `recover --apply` 的 JSON 輸出會內嵌 `audit_recent: AuditEntryBrief[]`（最近 5 筆），
    讓新 session 立即擁有歷史脈絡。

    **已知限制（v1.20.0）：** Bi-directional 連結僅在 `query` / `inspect` / diagnostic
    表面寫入；DML 指令 `insert / update / delete / export / q / schema` 失敗時
    emit 的 envelope 暫未含 `audit_ref`，追蹤於 Phase 23-04 follow-up。完整對照表見
    [`.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`](./.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md)。
    Recovery envelope 自身的 linkage 不受影響。

    進階 agent 工作流程（session handoff、forensics walk-through）詳見
    [`assets/SKILL.md`](./assets/SKILL.md) §Audit Log usage（英文）或
    [`assets/SKILL.zh-TW.md`](./assets/SKILL.zh-TW.md) §Audit Log 使用。

    ---
    ```

    **Hard constraints (PATTERNS S3 + S4 + Pitfall 11):**
    - Heading bilingual hybrid: `## 稽核日誌 (Audit Log)` — matches README.zh-TW.md:75 style for technical capability sections.
    - All inline command names, flag names, file paths, JSON keys STAY ENGLISH inside backticks: `dbcli audit tail`, `--for-agent`, `.dbcli/audit/<connection>.jsonl`, `audit.enabled`, `recovery_ref`, `audit_ref`, `audit_recent: AuditEntryBrief[]`, `tests/helpers/sensitive-output.ts`.
    - Blockquote opening label `**自 v1.20.0 起預設啟用。**` (ZH translation of "Default ON since v1.20.0") — matches PATTERNS S4 ZH callout.
    - Cross-link BOTH SKILL.md and SKILL.zh-TW.md (ZH readers may want either) — added bonus over EN README which only links SKILL.md.
    - No `<!-- audit-section -->` sentinels.
  </action>

  <verify>
    <automated>grep -qE '^## 稽核日誌 \(Audit Log\)$' README.zh-TW.md && grep -qF '自 v1.20.0 起預設啟用' README.zh-TW.md && grep -qF 'audit.enabled = false' README.zh-TW.md && grep -q '25-J1-COVERAGE-MATRIX' README.zh-TW.md && grep -qF 'SKILL.zh-TW.md' README.zh-TW.md</automated>
  </verify>

  <done>
    - `README.zh-TW.md` contains `^## 稽核日誌 \(Audit Log\)$`.
    - D1 blockquote present with `自 v1.20.0 起預設啟用` opening.
    - All technical terms in backticks remain English.
    - Cross-links to both SKILL.md and SKILL.zh-TW.md present.
    - Section structure mirrors EN README's `## Audit Log` (same paragraphs in same order, translated narrative).
  </done>
</task>

<task type="auto">
  <name>Task D-3: Add `audit tail` row + AI Agent bullet to `docs/user/en/index.md`</name>
  <files>docs/user/en/index.md</files>

  <read_first>
    - docs/user/en/index.md (full file — locate `<!-- doc-key: diagnostics-recovery -->` at line 140 + `<!-- doc-key: ai-agent-integration -->` at line 192)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«8. docs/user/en/index.md» (verbatim row + bullet text + Pitfalls)
    - scripts/check-user-docs.ts (lines 3-19 — frozen 14 doc-key list)
  </read_first>

  <action>
    Two atomic edits inside EXISTING doc-keys (Pitfall 4 — do NOT add a 15th doc-key):

    **Edit 1 — append one row to the Health, Diagnostics & Recovery table.** Locate `<!-- doc-key: diagnostics-recovery -->` (line 140) and its table. After the existing `recover --apply` row (line 150), append:

    ```markdown
    | `audit tail` | **Audit Log**: Tails `.dbcli/audit/<conn>.jsonl` (agent-facing JSONL). Use `--for-agent --n 10` for session-handoff JSON. |
    ```

    The row must immediately follow the `recover --apply` row, before any blank line or closing `<!-- doc-key: ... -->` boundary.

    **Edit 2 — append a bullet to the AI Agent Integration list.** Locate `<!-- doc-key: ai-agent-integration -->` (line 192). After the existing 4th bullet (line 200, `Context Efficiency`), append a 5th numbered bullet:

    ```markdown
    5.  **Audit Log**: see [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log).
    ```

    Matches the existing `1.  `, `2.  `, `3.  `, `4.  ` formatting (single tab, period, two-space indent).

    **Hard constraints (Discretion G items 1, 3, 4, 5; Pitfall 4):**
    - The audit row goes ONLY in `<!-- doc-key: diagnostics-recovery -->` — NOT in `<!-- doc-key: engine-support -->` (Discretion G item 2: audit is cross-engine local; adding to engine matrix is semantically wrong).
    - The bullet goes ONLY in `<!-- doc-key: ai-agent-integration -->`.
    - Do NOT add `<!-- doc-key: audit -->` anywhere. The 14-key frozen list in `scripts/check-user-docs.ts:3-19` must stay at 14.
    - Do NOT create a standalone `## Audit Log` chapter in user-docs index (Discretion G item 5 lock — deep content lives in README + SKILL.md).
  </action>

  <verify>
    <automated>grep -qF '`audit tail`' docs/user/en/index.md && grep -qF '**Audit Log**: Tails' docs/user/en/index.md && grep -qF '**Audit Log**: see' docs/user/en/index.md && ! grep -qF '<!-- doc-key: audit -->' docs/user/en/index.md</automated>
  </verify>

  <done>
    - `docs/user/en/index.md` `<!-- doc-key: diagnostics-recovery -->` block contains a row for `audit tail`.
    - `<!-- doc-key: ai-agent-integration -->` block contains a 5th bullet for `**Audit Log**:`.
    - No new doc-key sentinel introduced.
    - No row added to `<!-- doc-key: engine-support -->`.
  </done>
</task>

<task type="auto">
  <name>Task D-4: Mirror EN edits in `docs/user/en/index.html` (HTML card + bullet)</name>
  <files>docs/user/en/index.html</files>

  <read_first>
    - docs/user/en/index.html (full file — locate `<!-- doc-key: diagnostics-recovery -->` at line 236 + `<!-- doc-key: ai-agent-integration -->` at line 325)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«9. docs/user/en/index.html» (verbatim HTML card + bullet + escaping note)
  </read_first>

  <action>
    Two atomic edits matching the .md edits from Task D-3:

    **Edit 1 — append an `audit` card to the diagnostics grid.** Locate `<!-- doc-key: diagnostics-recovery -->` (line 236) and the inner `<div class="grid grid-cols-1 gap-4 mb-12">` block. After the `recover` card (`</div>` closes around line 250), insert ONE new card before the grid's closing `</div>`:

    ```html
    <div class="flex items-center gap-6 p-6 paper-card border-l-4 border-l-secondary">
        <div class="px-4 py-2 bg-secondary/10 text-secondary rounded-md font-black text-xs uppercase tracking-widest">audit</div>
        <span class="text-text-muted font-medium">Tails the per-connection audit log (<code>.dbcli/audit/&lt;conn&gt;.jsonl</code>); use <code>--for-agent</code> for handoff JSON.</span>
    </div>
    ```

    Use `border-l-secondary` (not `border-l-primary`) to alternate visual rhythm — `doctor` and `recover` use `primary`, `report` uses `secondary`, so `audit` continues the alternation per existing pattern (PATTERNS §9 Analog 1 line 422).

    **Edit 2 — append an `<li>` to the AI Agent Integration list.** Locate `<!-- doc-key: ai-agent-integration -->` (line 325) and the `<ul>` block. After the existing 4th `<li>` (`Expert Task Packs`, line 333), append:

    ```html
    <li><strong>Audit Log</strong>: <code>audit tail --for-agent</code> for session handoff; bi-directional <code>recovery_ref</code> / <code>audit_ref</code> links.</li>
    ```

    Match the existing `<li><strong>Label</strong>: description</li>` shape.

    **Hard constraints (PATTERNS §9 Pitfalls):**
    - HTML escape `<conn>` as `&lt;conn&gt;` inside `<span>` text — follow the `migrate &lt;action&gt;` precedent at line 261.
    - The card and bullet must land inside the SAME doc-key sections as the .md edits — `bun run docs:check` asserts md/html parity by doc-key order, and any drift fails the parity check.
    - No new `<!-- doc-key: audit -->` (Pitfall 4 lock).
  </action>

  <verify>
    <automated>grep -qF 'border-l-secondary' docs/user/en/index.html && grep -qF '>audit</div>' docs/user/en/index.html && grep -qF 'Tails the per-connection audit log' docs/user/en/index.html && grep -qF '&lt;conn&gt;.jsonl' docs/user/en/index.html && grep -qF '<strong>Audit Log</strong>:' docs/user/en/index.html && ! grep -qF '<!-- doc-key: audit -->' docs/user/en/index.html</automated>
  </verify>

  <done>
    - `docs/user/en/index.html` has an `audit` card inside `<!-- doc-key: diagnostics-recovery -->`.
    - The card uses `border-l-secondary` alternation.
    - `&lt;conn&gt;` is HTML-escaped (not raw `<conn>`).
    - AI agent `<ul>` has a 5th `<li>` for Audit Log.
    - No new doc-key sentinel introduced.
  </done>
</task>

<task type="auto">
  <name>Task D-5: Mirror EN edits in `docs/user/zh-TW/index.md` (ZH .md)</name>
  <files>docs/user/zh-TW/index.md</files>

  <read_first>
    - docs/user/zh-TW/index.md (full file — locate `<!-- doc-key: diagnostics-recovery -->` + `<!-- doc-key: ai-agent-integration -->` at the analogous line positions to EN)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«10. docs/user/zh-TW/index.{md,html}» (verbatim ZH row + bullet text)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«Pattern S3» (bilingual technical-term policy)
  </read_first>

  <action>
    Two atomic edits matching Task D-3's structure (same doc-keys, ZH-translated text):

    **Edit 1 — append one row to `<!-- doc-key: diagnostics-recovery -->` table.** After the existing `recover --apply` row, append:

    ```markdown
    | `audit tail` | **稽核日誌**：讀取 `.dbcli/audit/<conn>.jsonl`（agent-facing JSONL）；使用 `--for-agent --n 10` 取得 session handoff JSON。|
    ```

    **Edit 2 — append a 5th bullet to `<!-- doc-key: ai-agent-integration -->` list.** After the existing 4th bullet, append:

    ```markdown
    5.  **稽核日誌 (Audit Log)**：詳見 [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log)。
    ```

    **Hard constraints (Discretion G items 1, 3, 4, 5; Pattern S3):**
    - Command names `audit tail`, flag names `--for-agent`, `--n`, file paths `.dbcli/audit/<conn>.jsonl` stay English (inside backticks).
    - Section labels translate (`**稽核日誌**：`, `**稽核日誌 (Audit Log)**：`).
    - Same doc-keys as EN. No `<!-- doc-key: audit -->`. No engine-support row.
    - Bullet number formatting matches EN (`5.  ` with two-space indent).
  </action>

  <verify>
    <automated>grep -qF '`audit tail`' docs/user/zh-TW/index.md && grep -qF '**稽核日誌**：讀取' docs/user/zh-TW/index.md && grep -qF '**稽核日誌 (Audit Log)**：詳見' docs/user/zh-TW/index.md && ! grep -qF '<!-- doc-key: audit -->' docs/user/zh-TW/index.md</automated>
  </verify>

  <done>
    - `docs/user/zh-TW/index.md` `<!-- doc-key: diagnostics-recovery -->` block has the ZH audit row.
    - `<!-- doc-key: ai-agent-integration -->` block has the ZH audit bullet.
    - Technical terms stay English (in backticks).
    - No new doc-key sentinel.
  </done>
</task>

<task type="auto">
  <name>Task D-6: Mirror EN HTML edits in `docs/user/zh-TW/index.html` + run `docs:check` + `release:check`</name>
  <files>docs/user/zh-TW/index.html</files>

  <read_first>
    - docs/user/zh-TW/index.html (full file — locate the analogous diagnostics-recovery grid + ai-agent-integration `<ul>` blocks)
    - docs/user/en/index.html (Task D-4 output — Task D-6 must mirror this structurally; only visible text strings translate)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«10. docs/user/zh-TW/index.{md,html}»
  </read_first>

  <action>
    Two atomic edits matching Task D-4's structure (same HTML classes, ZH-translated text):

    **Edit 1 — append `audit` card inside `<!-- doc-key: diagnostics-recovery -->` grid.** Use the same HTML class structure as Task D-4. The badge label `audit` stays English (it's a command name). Translate the visible description text:

    ```html
    <div class="flex items-center gap-6 p-6 paper-card border-l-4 border-l-secondary">
        <div class="px-4 py-2 bg-secondary/10 text-secondary rounded-md font-black text-xs uppercase tracking-widest">audit</div>
        <span class="text-text-muted font-medium">讀取每連線的 audit log（<code>.dbcli/audit/&lt;conn&gt;.jsonl</code>）；使用 <code>--for-agent</code> 取得 handoff JSON。</span>
    </div>
    ```

    **Edit 2 — append `<li>` inside `<!-- doc-key: ai-agent-integration -->` list.**

    ```html
    <li><strong>稽核日誌 (Audit Log)</strong>：<code>audit tail --for-agent</code> 用於 session handoff；envelope 雙向連結 <code>recovery_ref</code> / <code>audit_ref</code>。</li>
    ```

    **After all 6 D-tasks complete, run the full verification chain:**

    ```bash
    # 1. Parity check (existing tool)
    bun run docs:check

    # 2. Full release gate (validates entire Phase 26)
    bun run release:check
    ```

    Both must exit 0. If `docs:check` fails:
    - "Missing doc-key" → audit edit landed outside an existing key. Re-check Tasks D-3..D-6.
    - "doc-key order mismatch" → the 4 files have differing doc-key sequences. Reorder edits within existing keys, do NOT add new keys.
    - "Duplicate doc-key" → accidental copy. Remove the duplicate.

    If `release:check` fails:
    - Step 8/8 doc-presence failing means Plan B's audit row or Plan C's CHANGELOG section drifted. Check `grep -E '^\| \`audit\` ' docs/feature-matrix.md` and `grep -F '## [1.20.0]' CHANGELOG.md`.
    - Step 2/8 prettier failing → run `bunx prettier --write` on the changed `src/` / `tests/` files (Plan A's edits).
  </action>

  <verify>
    <automated>grep -qF '稽核日誌 (Audit Log)' docs/user/zh-TW/index.html && grep -qF '&lt;conn&gt;.jsonl' docs/user/zh-TW/index.html && grep -qF 'border-l-secondary' docs/user/zh-TW/index.html && ! grep -qF '<!-- doc-key: audit -->' docs/user/zh-TW/index.html && bun run docs:check && bun run release:check</automated>
  </verify>

  <done>
    - `docs/user/zh-TW/index.html` has the `audit` card + ZH bullet.
    - All 4 user-docs files have audit content in `diagnostics-recovery` + `ai-agent-integration` doc-keys.
    - `bun run docs:check` exits 0 (4-file parity preserved).
    - `bun run release:check` exits 0 (full 8-step gate green — Phase 26 is shippable).
    - No `<!-- doc-key: audit -->` introduced in any of the 4 user-docs files.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| README/CHANGELOG -> user reading agent | An upgrading user's awareness of the new default-on audit log behaviour relies on the D1 blockquote being prominent + cool-toned. Missed = surprised user. |
| docs/user/* (md + html) -> parity check | `scripts/check-user-docs.ts` enforces 4-file mirror; bypassing via a new doc-key would create a silent maintenance liability. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-26-03 | Information Disclosure (indirect) / ASVS V11 Business Logic | README D1 default-on blockquote omission or de-emphasis | mitigate | The `>` blockquote is placed as the FIRST child of the new `## Audit Log` section (top-level, between AI Integration Guide and Troubleshooting); the upgrade-impact callout uses bold `**Default ON since v1.20.0.**` opening; opt-out one-liner is the third line of the blockquote. Severity: LOW (informational, not security). Verified by: `grep -qE 'Default ON since v1\.20\.0' README.md` and the equivalent ZH grep. PR review confirms placement + tone. |

**ASVS coverage:** V11 (Business Logic) — D1 default-on behaviour is correctly communicated to upgrading users in both READMEs. No new code introduced; this is documentation only.

**T-26-03 stated explicitly:** An upgrading user who runs `dbcli query "..."` after a `bun install dbcli@1.20.0` will see `.dbcli/audit/` appear without prior reading would be a Surprise Class A. The README blockquote + CHANGELOG `**Default-on, upgrade impact:**` prefix (Plan C) form the two documentation mitigation surfaces; this plan installs the README half.
</threat_model>

<verification>
After all 6 tasks complete:

```bash
# README parity
grep -qE '^## Audit Log$' README.md
grep -qE '^## 稽核日誌 \(Audit Log\)$' README.zh-TW.md

# 4-file user-docs parity — audit referenced in all 4
grep -lE '(audit tail|>audit</div>)' docs/user/en/index.md docs/user/en/index.html docs/user/zh-TW/index.md docs/user/zh-TW/index.html
# Expect: 4 lines

# No new doc-key in any of the 4 files
grep -l '<!-- doc-key: audit -->' docs/user/en/index.md docs/user/en/index.html docs/user/zh-TW/index.md docs/user/zh-TW/index.html
# Expect: no output (no file matches)

# Parity tooling
bun run docs:check

# Final phase verification
bun run release:check
```
</verification>

<success_criteria>
- `README.md` and `README.zh-TW.md` both have a top-level `## Audit Log` / `## 稽核日誌 (Audit Log)` section with D1 blockquote + Phase 23-04 known-limitation (DOCS-04 part 1)
- All 4 `docs/user/*/index.{md,html}` files have an `audit` table row + AI agent bullet inside existing doc-keys (DOCS-04 part 2)
- No new doc-key sentinel created (Pitfall 4 mitigated; `check-user-docs.ts` 14-key list frozen)
- `bun run docs:check` exits 0 (4-file parity preserved)
- `bun run release:check` exits 0 end-to-end (Phase 26 fully shippable; T-26-02 and T-26-03 mitigations confirmed live)
- ZH technical terms (command names, flags, file paths, JSON keys) stay English inside backticks (Pattern S3)
</success_criteria>

<output>
After completion, create `.planning/phases/26-docs-skill-release-gate/26-D-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. Set `requirements-completed: [DOCS-04]`. Note in Decisions:
- "README `## Audit Log` placed top-level (Discretion F default) between AI Integration Guide and Troubleshooting in both EN + ZH READMEs."
- "User-docs audit content lives inside existing doc-keys `diagnostics-recovery` and `ai-agent-integration` only (Discretion G item 5); no new doc-key added (check-user-docs.ts 14-key list stays frozen)."
- "ZH README cross-links both SKILL.md and SKILL.zh-TW.md (bonus over EN README which only links SKILL.md) to give ZH readers a direct path to native-language deep content."
- "Phase 26 verified shippable: `bun run release:check` 8/8 green."

After SUMMARY: update `.planning/STATE.md` Position to mark Phase 26 complete and update Release Gate table to note doc-presence step active.
</output>
