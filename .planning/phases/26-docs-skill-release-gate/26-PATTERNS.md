# Phase 26: Docs, Skill & Release Gate - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 16 (14 modify + 1 create + 1 trivial bump)
**Analogs found:** 16 / 16

> Pattern map for planner consumption. Each entry is **role classification → closest analog (path:line range) → 3-15 line excerpt → copy-verbatim vs adapt guidance → pitfalls**.
> Source-of-truth references: `26-CONTEXT.md` D-71..D-78 + Discretion E/F/G; `26-RESEARCH.md` §Patterns/Pitfalls/Code Examples.

---

## File Classification

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `assets/SKILL.zh-TW.md` | CREATE (markdown asset, ZH translation) | static asset | `README.zh-TW.md` (split-file ZH twin) + `assets/SKILL.md` (structure mirror) | exact |
| `assets/SKILL.md` | MODIFY-MD (add `## Audit Log usage` section) | static asset | `assets/SKILL.md:53-72` (`## Agent Task Packs`) | exact |
| `assets/reference.md` | MODIFY-MD (add `### audit` subcommand block) | static asset | `assets/reference.md:631-720` (`### recover`) + `:584-629` (`### recovery`) | exact |
| `docs/feature-matrix.md` | MODIFY-MD (row + tier examples) | static asset | `docs/feature-matrix.md:39-40` (`recover`/`skill` N/A rows) + `:46-53` (Side-effect tiers) | exact |
| `README.md` | MODIFY-MD (add `## Audit Log` top-level section) | static asset | `README.md:155-192` (`### Recovery & Guided Remediation`) — structure analog | role-match |
| `README.zh-TW.md` | MODIFY-MD (ZH mirror) | static asset | `README.zh-TW.md:75-102` (`### 復原與引導式修復`) | role-match |
| `CHANGELOG.md` | MODIFY-MD (add `## [1.20.0]` section) | static asset | `CHANGELOG.md:48-86` (`## [1.17.0]` — Added/Changed/Security/Internal) | exact |
| `docs/user/en/index.md` | MODIFY-MD (table row + bullet inside existing doc-keys) | static asset | `docs/user/en/index.md:140-150` (`diagnostics-recovery` table) + `:192-201` (`ai-agent-integration` bullets) | exact |
| `docs/user/en/index.html` | MODIFY-MD (HTML mirror) | static asset | `docs/user/en/index.html:236-251` (recover card) + `:325-335` (AI integration bullets) | exact |
| `docs/user/zh-TW/index.md` | MODIFY-MD (ZH mirror) | static asset | `docs/user/zh-TW/index.md:140-150` + `:192-201` | exact |
| `docs/user/zh-TW/index.html` | MODIFY-MD (ZH HTML mirror) | static asset | structurally identical to `en/index.html` | exact |
| `CONTRIBUTING.md` | MODIFY-MD (§Release Process checklist line) | static asset | `CONTRIBUTING.md:285-295` (Pre-Release Checklist bullet list) | exact |
| `scripts/release-check.sh` | MODIFY-CODE (add step 8/8, renumber 1/7..7/7 → 1/8..7/8) | event-driven (shell pipeline) | `scripts/release-check.sh:1-29` (all 7 existing steps share one pattern) | exact |
| `src/commands/skill.ts` | MODIFY-CODE (add `--lang` option + source-file branch) | request-response (CLI) | `src/commands/skill.ts:13-17` + `:44-86` + `:213-218` (option chain) | exact |
| `package.json` | MODIFY-CODE (version bump 1.19.1 → 1.20.0) | config | n/a (single-field edit — no analog excerpt needed) | trivial |
| `tests/integration/dist-smoke.test.ts` | EXTEND-TEST (add ZH smoke assertion — optional per Open Q1) | request-response | `tests/integration/dist-smoke.test.ts:49-56` (`skill --output writes packaged SKILL.md`) | exact |
| `tests/unit/commands/skill.test.ts` | EXTEND-TEST (add `--lang zh-TW` + invalid-lang cases) | request-response | `tests/unit/commands/skill.test.ts:38-68` (3 existing test bodies) | exact |

---

## Pattern Assignments

### 1. `assets/SKILL.zh-TW.md` (CREATE — full SKILL.md translation)

**Analog 1 — split-file ZH twin header:** `README.zh-TW.md:1-9`

```markdown
# dbcli — 為 AI 代理設計的資料庫 CLI

**語言：** [English](./README.md) | [繁體中文](./README.zh-TW.md)

統一的資料庫 CLI 工具，讓 AI 代理（Claude Code、Gemini、Copilot、Cursor）能安全地查詢、探索與操作資料庫。

**核心價值：** AI 代理可透過單一、具權限控管的 CLI 工具，在敏感資料保護下安全且智慧地存取專案資料庫。
```

**Analog 2 — SKILL.md frontmatter + opening:** `assets/SKILL.md:1-9`

```markdown
---
name: dbcli
description: Database CLI for AI agents with permission-based access control. Use to set up new connections, query, inspect schemas, insert/update/delete, export results, and blacklist sensitive columns/tables. ...
---

# dbcli

Database CLI for AI agents with permission-based access control.

## AI agent workflow (follow in order)
```

**What to copy verbatim:**
- The `---` YAML frontmatter block **including** `name: dbcli` (D-73 / Pitfalls 1/2/3 — dist-smoke + i18n test assert `^---` and `name: dbcli`).
- `description:` field key (single line). **Translation rule per CONTEXT specifics line 155:** narrative is translated; the field name `description:` stays English; the YAML parses identically.
- All command names, file paths (`assets/`, `.dbcli/`, `~/.claude/...`), JSON keys (`recovery_ref`, `audit_ref`, `audit_recent`), flag names (`--for-agent`, `--brief`, `--n`, `--recovery-ref`), exit codes, error code constants (`CONN_REFUSED`, `PERMISSION_DENIED`, ...).

**What to adapt (translate):**
- All narrative prose (numbered list intros, "Use to ...", boundary explanations, "## Quick start" → "## 快速開始", etc.).
- Section headings: `## AI agent workflow (follow in order)` → `## AI 代理工作流程（依序執行）`. Mirror `README.zh-TW.md`'s heading tone — keep parenthetical English originals when the term is technical (`### 復原與引導式修復 (Recovery & Guided Remediation)` style at README.zh-TW.md:75).
- Optional first-line language link mirroring README precedent (RESEARCH §Architecture Patterns Pattern 1): planner decides whether to add `**Languages:** [English](./SKILL.md) | [繁體中文](./SKILL.zh-TW.md)` after frontmatter.

**Pitfalls (RESEARCH Pitfalls 1, 11):**
- Do NOT remove or rename `name: dbcli` — `tests/integration/dist-smoke.test.ts:55` asserts `/name: dbcli/`.
- Do NOT translate any string inside backticks/code fences. `dbcli 稽核 末端` is wrong — must remain `dbcli audit tail`.
- The new "Audit Log 使用" section must land **together** with the EN "Audit Log usage" addition in `SKILL.md` (CONTEXT specifics line 156 — AGENTS.md parity rule forbids EN-first / ZH-later).

---

### 2. `assets/SKILL.md` — add `## Audit Log usage` (MODIFY-MD)

**Analog:** `assets/SKILL.md:53-72` (`## Agent Task Packs` — closest existing "stand-alone capability with two workflows" section)

```markdown
## Agent Task Packs

When the user asks for a database workflow (e.g. "diagnose this slow query", "audit
permissions", "review long-running operations"), prefer published task templates
over inventing steps from memory.

```bash
dbcli skill tasks list --format json                              # discover
dbcli skill tasks show <task>                                     # inspect
dbcli skill tasks plan <task> --param key=value --format json     # generate plan
```

The plan output is an ordered list of dbcli commands with rationale and risk
labels. Execute them one at a time — task plans do **not** override blacklist,
schema, dry-run, or confirmation requirements.

Tasks live under `assets/tasks/` (builtin), `.dbcli-shared/tasks/` (shared), and
`.dbcli/tasks/` (local override).
```

**What to copy verbatim (structure):**
- Heading level `## ` (NOT `### ` — Audit Log usage is a peer of Agent Task Packs / Quick start / Permission levels).
- Opening paragraph pattern: "When the user does X, prefer Y over Z" → adapt to handoff/forensics.
- Fenced `bash` block listing 3-6 canonical commands with inline `# comment` describing each.
- Closing paragraph with file-system locations (`.dbcli/audit/<connection>.jsonl`) and cross-reference to `reference.md`.

**What to adapt (CONTEXT specifics lines 152-154 + RESEARCH Example 5):**
- Two named scenarios: (1) **Session handoff** — `dbcli audit tail --for-agent --n 10`; (2) **Forensics** — `dbcli recover --format json` → `audit_recent` embed → `recovery_ref` ⇄ `audit_ref` cross-walk.
- Reference Phase 24 surface (D-31..D-46): `audit tail / show / clear / health`, `--for-agent`, `--brief`, `--recovery-ref`.
- Reference Phase 25 surface (D-50..D-61): `audit_recent: AuditEntryBrief[]` embedded in `inspect / guide / recover` `--for-agent` JSON.

**Pitfalls:**
- Pitfall 3 — keep lines 6-8 (`# dbcli` + tagline) untouched; insert new `## Audit Log usage` **after** Agent Task Packs (line 72) or before `## Quick start` (line 74) — not as a frontmatter replacement.
- Pitfall 1 — leave YAML frontmatter `description:` field alone unless adding the word "audit" as a trigger. If updated, validate the line still parses as YAML and `name: dbcli` survives.

---

### 3. `assets/reference.md` — add `### audit` subcommand block (MODIFY-MD, EN-only per D-72)

**Analog:** `assets/reference.md:631-720` (`### recover`) and `:584-629` (`### recovery`)

Excerpt from `### recover` (lines 631-647) showing the canonical structure:

```markdown
### recover

(v1.17.0+) Inspect or apply the last recovery plan saved by `--recovery`.

| Flag | Purpose | Default |
|---|---|---|
| `--apply` | Execute the saved plan under risk gating. | off (inspect only) |
| `--from <path>` | Read the envelope from this file instead of `.dbcli/last-recovery.json`. ... | — |
| `--allow-write <tier>` | Open the risk gate. Values: `readonly-cmd` ... | `none` |
| `--no-verify` | Skip the verify step appended after a successful `--apply`. | off (verify runs by default) |
| `--format <format>` | `markdown` \| `json`. | `markdown` for inspect, `json` for `--apply` |

#### Plan source resolution

1. `--from <path>` if provided. ...
```

**What to copy verbatim (structure):**
- `### audit` heading + 1-line description + `(v1.20.0+)` version pin.
- Flag table with columns `| Flag | Purpose | Default |`.
- `#### ` subsections (e.g. `#### Subcommands`, `#### Exit codes`, `#### Boundaries`, `#### Permission`) — match `### recover`'s subsection rhythm.
- Closing `**Permission:** n/a` line (style at `### recovery` line 629).

**What to adapt:**
- Document all 4 subcommands per Phase 24 contract (D-31..D-46): `audit tail`, `audit show`, `audit clear`, `audit health`. Each with its own flag table.
- Tier per D-76: tail / show / health = `readonly`; clear = `local-write` (mention `audit clear` shows an interactive confirmation prompt, but tier stays `local-write` — NOT `interactive`. RESEARCH §Anti-Patterns line 313 explicit).

**Pitfalls:**
- D-72 lock — **do NOT translate this file**. ZH twin `reference.zh-TW.md` is deferred (CONTEXT deferred line 163).
- Don't fabricate flags. Phase 24 contract is the source of truth: `--n`, `--all`, `--for-agent`, `--brief`, `--recovery-ref <id>`, `<id-prefix>` positional (≥4 chars), `--format json|table`.

---

### 4. `docs/feature-matrix.md` — `audit` row + Side-effect tiers (MODIFY-MD)

**Analog 1 — `recover` row (engine-independent N/A row):** `docs/feature-matrix.md:39-40`

```markdown
| `recover` | N/A | N/A | N/A | N/A | N/A | N/A | Automated remediation and multi-turn protocol; engine-independent logic operating on saved envelopes. |
| `skill` | N/A | N/A | N/A | N/A | N/A | N/A | Skill generation is engine-independent. New: `skill tasks list/show/plan` exposes plan-only Agent Task Packs ...; plans never execute commands. |
```

**Analog 2 — Side-effect tiers table:** `docs/feature-matrix.md:46-53`

```markdown
| Tier | Meaning | Examples |
| --- | --- | --- |
| `readonly` | Reads remote or local state without mutating the connected database. ... | `list`, `schema`, `query`, `inspect`, `report`, `guide` |
| `dry-run` | Produces or applies a gated plan only when an explicit dry-run or allow flag is present. | `recover`, write commands with `--dry-run` |
| `local-write` | Writes local project or user configuration/artifacts, but does not mutate the connected database. | `use`, `queries`, `blacklist`, `skill`, `upgrade` |
| `db-write` | Mutates the connected database or datastore. ... | `insert`, `update`, `delete`, `migrate` |
| `interactive` | Requires prompt/TTY interaction and may write local configuration after user input. | `init`, `shell` |
```

**What to copy verbatim:**
- Row template ``| `<cmd>` | N/A | N/A | N/A | N/A | N/A | N/A | <note> |`` — D-78 grep target is ``^\| `audit` `` (RESEARCH Pitfall 7).
- Side-effect tiers `Examples` cells — append (don't rewrite).

**What to adapt (D-75 + D-76):**
- New single row immediately after the `skill` row (line 40):
  ```
  | `audit` | N/A | N/A | N/A | N/A | N/A | N/A | Cross-engine local capability writing `.dbcli/audit/<conn>.jsonl`. Subcommands: `tail` / `show` / `health` (`readonly`), `clear` (`local-write`). |
  ```
- Side-effect tiers updates: append `audit tail` (and/or `audit show`, `audit health`) to the `readonly` row's Examples; append `audit clear` to the `local-write` row's Examples. Tier strings MUST mirror `src/adapters/capabilities.ts:111-122` exactly — DO NOT invent a 6th tier or rename.

**Pitfalls:**
- RESEARCH §Anti-Patterns line 308 — never redefine tier values here; capabilities.ts is the SoT.
- RESEARCH Pitfall 7 — D-78 grep pattern ``'^\| `audit` '`` is anchored to start-of-line + backtick-wrapped name + single trailing space. If anyone reformats the table (e.g., extra leading whitespace, tab vs space, `audit` without backticks), the grep silently fails the gate.

---

### 5. `README.md` — add top-level `## Audit Log` (MODIFY-MD)

**Analog — structurally adjacent capability section:** `README.md:155-192` (`### Recovery & Guided Remediation`)

```markdown
### Recovery & Guided Remediation

```bash
# Lookup recovery commands for a code
dbcli recovery --code CONN_REFUSED --format json

# Execute a failing command with recovery opt-in
dbcli query "SELECT 1" --recovery

# (v1.17.0+) Inspect or apply the last saved recovery plan
dbcli recover                       # View last plan (Markdown)
dbcli recover --apply               # Execute safe steps (readonly/dry-run)
```

Machine-readable error envelope with guided remediation. As of v1.16.0 every
first-party command accepts the `--recovery` flag. ...

- **Risk Gating:** `--apply` is safe-by-default, running only `readonly` and `dry-run` steps. ...
- **Verification:** After a successful `--apply`, dbcli automatically runs a verification step ...
- **Multi-turn Protocol:** ...
```

**What to copy verbatim (structure only):**
- Heading + opening fenced `bash` block listing every command flavour with `# comment` annotations.
- Narrative paragraph explaining purpose + version gate (`As of v1.20.0 ...`).
- Bullet list summarising key behaviours/properties.

**What to adapt (Discretion F + RESEARCH Example 5):**
- Heading level is `## ` (top-level, **not** `###`) — F default is "top-level section between `## AI Integration Guide` (README.md:1147) and `## Troubleshooting` (README.md:1256)". Insert at line ~1254 (after `## AI Integration Guide` block ends).
- First child is a `>` blockquote with the D1 upgrade-impact callout:
  > **Default ON since v1.20.0.** Existing projects will begin creating `.dbcli/audit/<connection>.jsonl` on first command after upgrading. Set `audit.enabled = false` in `.dbcli` to opt out.
- Tone: per CONTEXT specifics line 151 — cool factual statement + opt-out one-liner. NOT alarm style (v1.20.0 is a minor, not breaking).
- Add a "Known limitation (v1.20.0)" sub-paragraph citing Phase 23-04 6 unwired commands (`insert / update / delete / export / q / schema`) — pointer to `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`.
- Cross-link footer: ``For deeper agent workflows (session handoff, forensics walk-through), see [`assets/SKILL.md`](./assets/SKILL.md) §Audit Log usage.``

**Pitfalls:**
- D-78 lock — do NOT add `<!-- audit-section -->` HTML sentinels; release-check does NOT grep README.
- README is **not** checked by `scripts/check-user-docs.ts` (RESEARCH §Pattern 5) — free to add `## ` section without breaking doc-key parity.
- If planner reconsiders Discretion F position (e.g., subsection under Recovery), must call out in PLAN.md that D-78 grep is unaffected (true — it doesn't touch README) but PR review will challenge.

---

### 6. `README.zh-TW.md` — `## Audit Log` ZH mirror (MODIFY-MD)

**Analog:** `README.zh-TW.md:75-102` (`### 復原與引導式修復 (Recovery & Guided Remediation)`)

```markdown
### 復原與引導式修復 (Recovery & Guided Remediation)

```bash
# 查詢特定代碼的復原指令
dbcli recovery --code CONN_REFUSED --format json

# 執行指令並在失敗時啟用復原信封
dbcli query "SELECT 1" --recovery
```

具備引導修復能力的機器可讀錯誤信封。自 v1.16.0 起，所有核心指令皆支援 `--recovery` 旗標。...

- **風險門控 (Risk Gating)：** `--apply` 預設為安全優先，僅執行 `readonly` 與 `dry-run` 步驟。...
```

**What to copy (structure + ZH conventions):**
- Heading bilingual hybrid: `## 稽核日誌 (Audit Log)` — mirrors README.zh-TW.md's pattern of `中文 (English)` for capability section names (line 75 precedent).
- `>` blockquote translated; **English** technical terms in backticks (`audit.enabled = false`, `.dbcli/audit/<connection>.jsonl`).
- Bullet labels bilingual: `**風險門控 (Risk Gating)：**` style — apply to whatever bullets the EN README §Audit Log uses.

**What to adapt:**
- Same content as EN README, translated narrative; same insertion point relative to ZH §AI 整合指南 (line 1043) and §故障排除 (line 1152).

**Pitfalls:**
- AGENTS.md Multi-language Parity — landing EN-only is forbidden (CONTEXT specifics line 156). Both README sections ship in the **same** plan/PR/commit.
- Pitfall 11 — code/flags/paths in backticks stay English. No `dbcli 稽核` translation.

---

### 7. `CHANGELOG.md` — `## [1.20.0]` section (MODIFY-MD)

**Analog (best precedent for feature release with upgrade-impact):** `CHANGELOG.md:48-86` (`## [1.17.0]`)

```markdown
## [1.17.0] - 2026-05-10

### Added

- `dbcli recover` top-level command. Without `--apply`, prints the auto-saved last envelope (Markdown by default, JSON with `--format json`); with `--apply`, executes the recovery plan under risk gating.
- `--apply` runs `tier=readonly` and `tier=dry-run` steps by default ...
- ... (16 Added bullets total)

### Changed

- `dbcli recover --apply` defaults to `--format json` for machine-readability; ...
- `dbcli init` and `dbcli init --force` recovery steps are now marked `interactive: true`; ...

### Security

- **Trust boundary on `--apply`**: envelope `risk`, `dbWrite`, and `interactive` fields are no longer authoritative ...

### Internal

- New modules under `src/core/recovery/`: `apply-types`, `apply-shell`, `apply-allowlist`, ...
```

**Secondary analog (Keep-a-Changelog single-line shape):** `CHANGELOG.md:9-27` (`## [1.19.1]` — `### Changed` / `### Fixed` / `### Tests`).

**What to copy verbatim:**
- `## [<version>] - <YYYY-MM-DD>` heading format — D-78 grep target `## [${PKG_VERSION}]` is matched with `grep -F` so brackets are literal (RESEARCH Pitfall 8).
- Subsection order: `### Added` → `### Changed` → `### Internal` (optionally `### Security`, `### Fixed`, `### Tests`).
- Bullet style: backtick-wrapped command/file/flag names + bold for emphasis labels (`**Default-on, upgrade impact:**`).
- Italic prefix for known limitations: `_Known limitation (Phase 23-04 follow-up):_ ...` (RESEARCH §Pattern 3 draft line 255).

**What to adapt (RESEARCH §Pattern 3 + Discretion E):**
- `## [1.20.0] - 2026-05-17` (or current release date — Open Q3, planner may use placeholder `<release-date>` and let Carl pin at tag time).
- `### Added`: list all v1.20.0 audit log surfaces (writer foundation + `audit.enabled` config; `tail / show / clear / health` subcommands; `--all`, `--for-agent`, `--brief`, `--recovery-ref` flags; recovery envelope bi-directional `recovery_ref` / `audit_ref` linkage; `audit_recent: AuditEntryBrief[]` embed in inspect/guide/recover; `--lang en|zh-TW` on `skill --install`; new `assets/SKILL.zh-TW.md`).
- `### Changed`: lead with **Default-on D1 callout** (Discretion F item 2) using `**Default-on, upgrade impact:**` prefix; second line additive shape change on inspect/guide/recover JSON (`audit_recent` field — additive); third line **known limitation** per Discretion E:
  > _Known limitation (Phase 23-04 follow-up):_ Audit log captures `query`, `inspect`, and diagnostic-surface commands in v1.20.0; coverage for `insert / update / delete / export / q / schema` is tracked as Phase 23-04 follow-up (see `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`). Recovery envelope linkage is unaffected.
- `### Internal`: new modules under `src/core/audit/{logger,lock,rotation,reader,recent,session-id,types,integration-helper}.ts`; new tests `tests/integration/{audit-contract,audit-envelope,recovery-audit-link}.test.ts`; new release-check step 8/8 doc-presence.

**Pitfalls:**
- Pitfall 6 + 10 — `package.json` version MUST bump to 1.20.0 in the SAME commit/plan as adding `## [1.20.0]` heading (RESEARCH Plan C sequencing).
- Pitfall 8 — version heading uses literal `[` `]` brackets; release-check.sh greps with `-F` not `-E` so `[` is literal.
- Keep historical entries immutable — DO NOT edit `## [1.0.0]` "audit logging deferred" note (RESEARCH §State of the Art line 558).

---

### 8. `docs/user/en/index.md` — table row + bullet (MODIFY-MD)

**Analog 1 — `Health, Diagnostics & Recovery` table:** `docs/user/en/index.md:140-150`

```markdown
<!-- doc-key: diagnostics-recovery -->
### Health, Diagnostics & Recovery

| Command | Description |
| :--- | :--- |
| `doctor` | Runs system and connection diagnostics. |
| `check [table]` | Analyzes data health (orphans, nulls, duplicates). |
| `diff` | Compares schema snapshots to detect changes. |
| `report` | Generates a comprehensive health/perf report. |
| `guide <goal>` | Generates a step-by-step troubleshooting plan (e.g., `slow-query`). |
| `recover --apply` | **Automated Recovery**: Applies the last suggested recovery plan. |
```

**Analog 2 — `AI Agent Integration` bullets:** `docs/user/en/index.md:192-201`

```markdown
<!-- doc-key: ai-agent-integration -->
## AI Agent Integration

`dbcli` is designed to be the "DB driver" for AI agents.

1.  **SKILL.md**: Provide the agent with the `SKILL.md` (via `dbcli skill`) so it knows the safe command paths.
2.  **Recovery Envelopes**: When a command fails, use `--recovery` to get a machine-readable JSON error with a suggested fix.
3.  **Risk Gating**: Agents use `dbcli plan`, the per-command `--plan` preflight on `insert`/`update`/`delete`, and `--dry-run` to verify their actions before committing changes.
4.  **Context Efficiency**: `inspect --for-agent` provides exactly the metadata the agent needs to orient itself without bloating its context window.
```

**What to copy verbatim:**
- Table row template ``| `<cmd>` | <desc>. |`` — same indentation/spacing as `recover --apply` row.
- Bullet style — numbered list, `**Label**: description` shape.

**What to adapt (Discretion G):**
- Add ONE row inside `<!-- doc-key: diagnostics-recovery -->`:
  ```
  | `audit tail` | **Audit Log**: Tails `.dbcli/audit/<conn>.jsonl` (agent-facing JSONL). Use `--for-agent --n 10` for session-handoff JSON. |
  ```
- Add ONE bullet (5th item) inside `<!-- doc-key: ai-agent-integration -->`:
  ```
  5.  **Audit Log**: see [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log).
  ```

**Pitfalls:**
- Pitfall 4 — DO NOT add `<!-- doc-key: audit -->`. `scripts/check-user-docs.ts` has frozen 14 required keys; adding a 15th creates a permanent silent gap. Inline into the 2 existing keys.
- G item 2 — do NOT add an `audit` row to `## Database Engine Support Matrix` (`docs/user/en/index.md:178-189`); audit is cross-engine local.
- G item 5 — no standalone `## Audit Log` chapter in user-docs index (depth lives in README + SKILL.md).

---

### 9. `docs/user/en/index.html` — HTML mirror (MODIFY-MD)

**Analog 1 — `diagnostics-recovery` card layout:** `docs/user/en/index.html:236-251`

```html
<!-- doc-key: diagnostics-recovery -->
<h3 id="diagnostics">Health & Diagnostics</h3>
<div class="grid grid-cols-1 gap-4 mb-12">
    <div class="flex items-center gap-6 p-6 paper-card border-l-4 border-l-primary">
        <div class="px-4 py-2 bg-primary/10 text-primary rounded-md font-black text-xs uppercase tracking-widest">doctor</div>
        <span class="text-text-muted font-medium">Validates environment, connectivity, and configuration integrity.</span>
    </div>
    <div class="flex items-center gap-6 p-6 paper-card border-l-4 border-l-primary">
        <div class="px-4 py-2 bg-primary/10 text-primary rounded-md font-black text-xs uppercase tracking-widest">recover</div>
        <span class="text-text-muted font-medium">Executes automated remediation plans for common failure modes.</span>
    </div>
</div>
```

**Analog 2 — `ai-agent-integration` bullets:** `docs/user/en/index.html:325-335`

```html
<!-- doc-key: ai-agent-integration -->
<section id="ai">
    <h2>🤖 AI Agent Integration</h2>
    <ul>
        <li><strong>Machine-Readable Errors</strong>: JSON-formatted <code>--recovery</code> envelopes.</li>
        <li><strong>Context Optimization</strong>: <code>--for-agent</code> flag reduces token bloat.</li>
        <li><strong>Risk Gating</strong>: <code>dbcli plan</code> for raw SQL ...</li>
        <li><strong>Expert Task Packs</strong>: Guided workflows for diagnosis and auditing.</li>
    </ul>
</section>
```

**What to copy verbatim:**
- Card `<div>` structure with classes `flex items-center gap-6 p-6 paper-card border-l-4 border-l-primary` + inner badge `<div class="px-4 py-2 bg-primary/10 text-primary rounded-md font-black text-xs uppercase tracking-widest">`. Alternate `border-l-primary` / `border-l-secondary` like existing siblings (doctor/recover use `primary`, `report` uses `secondary`).
- `<li><strong>Label</strong>: description</li>` shape for AI integration bullets.

**What to adapt (Discretion G item 4 — `.md` ⇄ `.html` parity):**
- Add an `audit` card right after the `recover` card (line 250):
  ```html
  <div class="flex items-center gap-6 p-6 paper-card border-l-4 border-l-secondary">
      <div class="px-4 py-2 bg-secondary/10 text-secondary rounded-md font-black text-xs uppercase tracking-widest">audit</div>
      <span class="text-text-muted font-medium">Tails the per-connection audit log (<code>.dbcli/audit/&lt;conn&gt;.jsonl</code>); use <code>--for-agent</code> for handoff JSON.</span>
  </div>
  ```
- Add bullet to AI agent `<ul>`:
  ```html
  <li><strong>Audit Log</strong>: <code>audit tail --for-agent</code> for session handoff; bi-directional <code>recovery_ref</code> / <code>audit_ref</code> links.</li>
  ```

**Pitfalls:**
- `bun run docs:check` (`scripts/check-user-docs.ts`) verifies md/html doc-key order identical — both files must end up with same `<!-- doc-key: ... -->` set (no new key).
- HTML escaping: `<conn>` must be `&lt;conn&gt;` inside `<span>` text (look at line 261 `migrate &lt;action&gt;` precedent).

---

### 10. `docs/user/zh-TW/index.md` + `docs/user/zh-TW/index.html` (MODIFY-MD, ZH mirror)

**Analog:** `docs/user/zh-TW/index.md:140-150` (ZH `### 健康度、診斷與修復`) + `:192-200` (ZH `## AI 代理整合`).

```markdown
<!-- doc-key: diagnostics-recovery -->
### 健康度、診斷與修復

| 指令 | 說明 |
| :--- | :--- |
| `doctor` | 執行環境與連線診斷。 |
| `recover --apply` | **自動化修復**：自動執行上次建議的故障修復計畫。 |
```

**What to copy / adapt:**
- Same row template, ZH description text. New row example:
  ```
  | `audit tail` | **稽核日誌**：讀取 `.dbcli/audit/<conn>.jsonl`（agent-facing JSONL）；使用 `--for-agent --n 10` 取得 session handoff JSON。|
  ```
- New AI 代理整合 bullet:
  ```
  5.  **稽核日誌 (Audit Log)**：詳見 [`SKILL.md`](../../../assets/SKILL.md) / [`README §Audit Log`](../../../README.md#audit-log)。
  ```
- HTML version mirrors `docs/user/en/index.html` card + bullet structure exactly; only the visible text strings are translated (badge label `audit` stays English since it's a command name).

**Pitfalls:**
- Same 4-file parity rule (G item 4): edits must land together in one plan. `scripts/check-user-docs.ts` runs as part of release gate via implicit `bun run docs:check`.

---

### 11. `CONTRIBUTING.md` — §Release Process checklist (MODIFY-MD)

**Analog:** `CONTRIBUTING.md:285-295` (Pre-Release Checklist bullet list)

```markdown
Run all of these before pushing a `vX.Y.Z` tag and confirm green:

- [ ] `bun run typecheck` — `tsc --noEmit` 無錯誤
- [ ] `bun test` — 單元 + 整合測試（含 `tests/integration/dist-smoke.test.ts` 守護 packaged assets path）綠燈
- [ ] `bun run lint` — `--max-warnings=0`，任何新 ESLint warning 都會擋下 release
- [ ] `bun run build` — `dist/cli.mjs` 與 `dist/assets/` 產出成功
- [ ] `./dist/cli.mjs --help` / `./dist/cli.mjs --version` 可執行（dist smoke）
- [ ] `CHANGELOG.md` 加上新版本區段（Added / Changed / Fixed / Removed）
- [ ] `.planning/STATE.md` 的 milestone 段落、Release Gate 表格與 `last_updated` 已更新
- [ ] `package.json` 的 `version` 已 bump（透過 `npm version patch|minor|major`）
```

**What to copy:**
- Bullet shape `- [ ] \`<cmd>\` — <ZH description>`.

**What to adapt (sync with `release-check.sh` step 8/8):**
- Insert ONE new bullet (placement preference: after the `bun run build` row, before `CHANGELOG.md` row — release-gate steps first, then doc artifacts):
  ```
  - [ ] `bash scripts/release-check.sh` 第 8/8 步 doc-presence — `docs/feature-matrix.md` 含 `audit` row、`CHANGELOG.md` 含 `## [<version>]` heading（D-78）
  ```
- Also update the line `The release gate is defined in [docs/feature-matrix.md → Required CI validation]` (line 281) and `feature-matrix.md:55-71` if it still says "release gate is four commands" — Phase 26 makes it 8 steps. RESEARCH §Integration Points line 143 explicit.

**Pitfalls:**
- These two files (`CONTRIBUTING.md` + `docs/feature-matrix.md` Required CI validation block) are **dual sources of truth** for the release gate. If they drift, PR review is the only enforcement — sync them in the same plan.

---

### 12. `scripts/release-check.sh` — add step 8/8 doc-presence (MODIFY-CODE)

**Analog:** `scripts/release-check.sh:1-29` (entire current script)

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step '1/7 bun audit'
bun audit

step '2/7 prettier --check'
bunx prettier --check "src/**/*.ts" "tests/**/*.ts"

step '3/7 typecheck'
bun run typecheck

step '4/7 lint'
bun run lint

step '5/7 test'
bun test

step '6/7 build'
bun run build

step '7/7 dist smoke'
bun test tests/integration/dist-smoke.test.ts

printf '\n\033[1;32m✓ release:check passed\033[0m\n'
```

**What to copy verbatim:**
- Shebang `#!/usr/bin/env bash` + `set -euo pipefail` (Pitfall 9 — preserve fail-fast contract).
- `step()` function definition with ANSI blue chevron.
- Step label format `step 'N/M ...'`.

**What to adapt (D-77 / D-78 + RESEARCH Example 3):**
- Sed renumber all `1/7`..`7/7` → `1/8`..`7/8` (RESEARCH Pitfall 9 — single `sed -i '' 's|/7 |/8 |g'` on macOS).
- Append new step 8/8 **after** dist smoke (Option A from RESEARCH §Pattern 4 line 271 — recommended):
  ```bash
  step '8/8 doc-presence'
  PKG_VERSION=$(node -p "require('./package.json').version")
  if ! grep -qE '^\| `audit` ' docs/feature-matrix.md; then
    echo "  ✗ docs/feature-matrix.md missing 'audit' row" >&2
    exit 1
  fi
  if ! grep -qF "## [${PKG_VERSION}]" CHANGELOG.md; then
    echo "  ✗ CHANGELOG.md missing '## [${PKG_VERSION}]' heading" >&2
    exit 1
  fi
  echo "  ✓ feature-matrix has audit row"
  echo "  ✓ CHANGELOG.md has ## [${PKG_VERSION}] heading"
  ```

**Pitfalls:**
- Pitfall 7 — grep pattern MUST use **single quotes** wrapping the whole pattern; backticks are literal inside single quotes. Double quotes would invoke shell command substitution and fail with `audit: command not found`.
- Pitfall 8 — version heading grep MUST be `grep -qF` (fixed string) not `-qE`; `[` `]` are regex metacharacters.
- Pitfall 6 / 10 — sequence: bump `package.json` version → write `## [1.20.0]` in CHANGELOG → THEN run `release:check`. If you reverse the order, step 8/8 fails on either side.
- Pitfall 9 — renumber every existing `step '...' line`; mixing `5/7 test` with `8/8 doc-presence` is ugly even though it functions.
- Do NOT introduce a `bun test` for doc-presence (D-77 lock: pure shell, ~10× faster).

---

### 13. `src/commands/skill.ts` — `--lang en|zh-TW` option + source-file branch (MODIFY-CODE)

**Analog 1 — module constants:** `src/commands/skill.ts:13-22`

```typescript
/** Absolute path to the static SKILL.md (relative to package root) */
const SKILL_SOURCE_PATH = packageAssetPath('SKILL.md')

/** Long-form command reference (sibling to SKILL in assets/ and in install dir) */
const REFERENCE_SOURCE_PATH = packageAssetPath('reference.md')

export interface SkillOptions {
  install?: string // platform: claude, gemini, copilot, cursor
  output?: string // custom output file path
}
```

**Analog 2 — file read with existence check:** `src/commands/skill.ts:46-56`

```typescript
// 1. Read static SKILL.md (single source of truth)
const skillFile = Bun.file(SKILL_SOURCE_PATH)
if (!(await skillFile.exists())) {
  throw new Error(`Skill source not found: ${SKILL_SOURCE_PATH}`)
}
const refFile = Bun.file(REFERENCE_SOURCE_PATH)
if (!(await refFile.exists())) {
  throw new Error(`Skill reference not found: ${REFERENCE_SOURCE_PATH}`)
}
const skillMarkdown = await skillFile.text()
const referenceMarkdown = await refFile.text()
```

**Analog 3 — commander option registration:** `src/commands/skill.ts:210-227`

```typescript
export function registerSkillCommand(program: Command): Command {
  return program
    .command('skill')
    .description(t('skill.description'))
    .option(
      '--install <platform>',
      'Install to platform directory (claude, gemini, copilot, cursor, codex, windsurf)'
    )
    .option('--output <path>', 'Write skill to file instead of stdout')
    .action(async (options: Record<string, unknown>) => {
      try {
        await skillCommand(program, options)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })
}
```

**What to copy verbatim:**
- Commander `.option(flag, description, defaultValue?)` 3-arg signature (Commander 13 supports this — RESEARCH Pattern 2 line 215).
- `Bun.file(path).exists()` guard + throw `Skill source not found: ${path}` (Pitfall 5).
- Surrounding try/catch + `console.error(t_vars('errors.message', ...))` + `process.exit(1)` (lines 81-85).

**What to adapt (D-73 / D-74 + RESEARCH Example 1+2):**
- Extend `SkillOptions` interface:
  ```typescript
  export interface SkillOptions {
    install?: string
    output?: string
    lang?: 'en' | 'zh-TW'  // NEW
  }
  ```
- Replace module-level `SKILL_SOURCE_PATH` with a resolver function (RESEARCH Example 2):
  ```typescript
  function resolveSkillSource(lang: string): string {
    if (lang === 'zh-TW') return packageAssetPath('SKILL.zh-TW.md')
    return packageAssetPath('SKILL.md')
  }
  ```
  Call inside `skillCommand`: `const skillSourcePath = resolveSkillSource(options.lang ?? 'en')`.
- Reference file (`REFERENCE_SOURCE_PATH`) stays English-only (D-72) — DO NOT branch on lang.
- Add option chain:
  ```typescript
  .option('--lang <lang>', 'Source language for SKILL content: en (default) or zh-TW', 'en')
  ```
  Or strict validation (recommended — RESEARCH §Don't Hand-Roll row 1):
  ```typescript
  import { Option } from 'commander'
  .addOption(new Option('--lang <lang>', 'Source language for SKILL content').choices(['en', 'zh-TW']).default('en'))
  ```
- Open Q2 default — `--lang` flows into BOTH `--output` and `--install` paths (single `skillMarkdown = await Bun.file(skillSourcePath).text()` already serves both at skill.ts:60 + skill.ts:70). No separate branch needed.

**Pitfalls:**
- Pitfall 2 — DO NOT change `getInstallPath()` (lines 126-156). D-74 lock: target filename stays `SKILL.md` regardless of source. `tests/integration/i18n.test.ts:128` asserts the literal path `~/.claude/skills/dbcli/SKILL.md`.
- Pitfall 3 — DO NOT touch the EN default behaviour. With no `--lang`, behaviour must be byte-identical to v1.19.1 (commander default `'en'` ensures this).
- RESEARCH §Anti-Patterns line 309/310 — `--lang` is a SOURCE-FILE SELECTOR not a locale switch. DO NOT read `DBCLI_LANG` env to set the default.
- `checkSkillUpdates()` (skill.ts:92-120) compares installed file to `SKILL_SOURCE_PATH` (English source). If you delete that constant entirely, this comparison breaks. Either: (a) keep the constant for `checkSkillUpdates()` only, or (b) make `checkSkillUpdates()` compare against the lang the install was performed with — out of scope; recommend (a).

---

### 14. `package.json` — version bump (MODIFY-CODE, trivial)

**Change:** `"version": "1.19.1"` → `"version": "1.20.0"` (line 3).

**Pitfalls (RESEARCH Pitfall 6 + 10):**
- Must happen in same plan as adding `## [1.20.0]` to CHANGELOG.md.
- D-78 grep uses `node -p "require('./package.json').version"` at runtime — if the bump and the CHANGELOG section land in different commits, release-check fails non-deterministically between them.
- Recommended sequencing in plan C: (1) `npm version minor --no-git-tag-version` (bumps package.json without committing); (2) add CHANGELOG `## [1.20.0]` section; (3) edit `release-check.sh` step 8/8; (4) run `bun run release:check` end-to-end.

---

### 15. `tests/unit/commands/skill.test.ts` — extend with `--lang` cases (EXTEND-TEST)

**Analog:** `tests/unit/commands/skill.test.ts:38-68` (all 3 existing tests)

```typescript
test('prints SKILL.md to stdout by default', async () => {
  await skillCommand({} as any, {})
  expect(logOutput).toContain('# dbcli')
  expect(logOutput).toContain('Database CLI for AI agents')
})

test('writes to custom output file', async () => {
  const testFile = join(process.cwd(), 'test-skill.md')
  if (existsSync(testFile)) unlinkSync(testFile)
  try {
    await skillCommand({} as any, { output: testFile })
    expect(existsSync(testFile)).toBe(true)
    const content = await Bun.file(testFile).text()
    expect(content).toContain('# dbcli')
    expect(errorOutput).toContain('Skill written to')
  } finally {
    if (existsSync(testFile)) unlinkSync(testFile)
  }
})

test('fails for unknown platform', async () => {
  try {
    await skillCommand({} as any, { install: 'nonexistent' })
  } catch { /* either throws or exits */ }
  expect(exitCode).toBe(1)
  expect(errorOutput).toContain('Unknown platform')
})
```

**What to copy:**
- spy setup (`logSpy` / `errorSpy` / `exitSpy`) + `beforeEach` reset block (lines 11-36) — already in place, do not duplicate.
- File-write pattern: write to `join(process.cwd(), '<tmp>.md')` + cleanup in `finally`.
- Negative-path pattern (try/catch + `expect(exitCode).toBe(1)`).

**What to adapt (RESEARCH §Wave 0 Gaps line 642):**
- New test 1 — `--lang zh-TW` writes ZH content:
  ```typescript
  test('writes ZH SKILL when --lang zh-TW with --output', async () => {
    const testFile = join(process.cwd(), 'test-skill-zh.md')
    if (existsSync(testFile)) unlinkSync(testFile)
    try {
      await skillCommand({} as any, { output: testFile, lang: 'zh-TW' })
      const content = await Bun.file(testFile).text()
      expect(content).toMatch(/Audit Log 使用|稽核日誌|繁體中文/)
    } finally {
      if (existsSync(testFile)) unlinkSync(testFile)
    }
  })
  ```
- New test 2 — `--lang en` default still works (regression):
  ```typescript
  test('default --lang en prints EN SKILL to stdout', async () => {
    await skillCommand({} as any, { lang: 'en' })
    expect(logOutput).toContain('# dbcli')
    expect(logOutput).toContain('Database CLI for AI agents')
  })
  ```
- (If planner uses `.choices(['en', 'zh-TW'])`) — invalid-lang case is auto-handled by commander's `InvalidArgumentError` at the option-parsing layer, NOT inside `skillCommand`. So an invalid-lang unit test belongs at the `registerSkillCommand` integration level, not here. RESEARCH §Don't Hand-Roll row 1.

**Pitfalls:**
- The existing tests run `skillCommand({} as any, {})` directly bypassing commander — commander default value of `'en'` is NOT supplied. Defensive default inside `skillCommand` is needed: `const lang = options.lang ?? 'en'` (RESEARCH Example 2 line 461). Without this defensive default, the new `default --lang en` test would still pass (commander supplies it via wrapping in real CLI usage) — but bypass calls in unit tests need the defensive line.

---

### 16. `tests/integration/dist-smoke.test.ts` — optional ZH smoke (EXTEND-TEST)

**Analog:** `tests/integration/dist-smoke.test.ts:49-56`

```typescript
test('skill --output writes packaged SKILL.md', () => {
  const out = join(workdir, 'SKILL.md')
  const r = run(['skill', '--output', out], workdir)
  expect(r.status).toBe(0)
  const text = readFileSync(out, 'utf8')
  expect(text).toMatch(/^---/) // frontmatter
  expect(text).toMatch(/name: dbcli/)
})
```

**What to copy:**
- Same `run(['skill', '--output', out], workdir)` + `readFileSync(out, 'utf8')` + `expect(r.status).toBe(0)` shape.
- Frontmatter assertions `^---` + `name: dbcli` — the ZH file MUST also pass these (Pitfall 1 — D-74 + ZH SKILL keeps same YAML frontmatter format).

**What to adapt (RESEARCH Open Q1 — planner decides):**
- Add (optional but recommended):
  ```typescript
  test('skill --output --lang zh-TW writes packaged ZH SKILL', () => {
    const out = join(workdir, 'SKILL.zh-TW.md')
    const r = run(['skill', '--output', out, '--lang', 'zh-TW'], workdir)
    expect(r.status).toBe(0)
    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/^---/)
    expect(text).toMatch(/name: dbcli/)
    expect(text).toMatch(/Audit Log 使用|稽核日誌|繁體中文/) // ZH-specific content
  })
  ```

**Pitfalls:**
- Pitfall 5 — this is the regression guard that `assets/SKILL.zh-TW.md` ships in the npm tarball. Without this assertion, an accidental `files:` array trim in `package.json` could silently drop the ZH file from packaged dist.
- The `beforeAll` block rebuilds dist (lines 30-41) — adding ZH content to `assets/SKILL.zh-TW.md` will automatically be picked up; no `scripts/build.ts` change needed IF the build script copies `assets/` wholesale (RESEARCH §Assumption A3 — planner must verify by reading `scripts/build.ts` once at start of Plan A).

---

## Shared Patterns

### Pattern S1 — Markdown table-row insertion (applies to: feature-matrix.md, user/{en,zh-TW}/index.md)

**Source contract:**
- `docs/feature-matrix.md:39` — ``| `recover` | N/A | N/A | N/A | N/A | N/A | N/A | <note> |``
- `docs/user/en/index.md:150` — ``| `recover --apply` | **<bold-label>**: <desc>. |``

**Apply to:** all 4 user-docs index.md (en + zh-TW) + feature-matrix.md.
**Pitfall:** D-78 grep is anchored — ``^\| `audit` `` must match exactly (single leading `|`, single space, backtick-`audit`-backtick, single trailing space). DO NOT prettier-reformat the table.

---

### Pattern S2 — doc-key sentinel discipline (applies to: docs/user/{en,zh-TW}/index.{md,html})

**Source contract:** `scripts/check-user-docs.ts:3-19` (frozen list of 14 required doc-keys).

**Apply to:** all 4 user-docs files.
**Rule:** Audit content lives inside existing keys `diagnostics-recovery` and `ai-agent-integration` ONLY (Discretion G item 5 + Pitfall 4). DO NOT introduce `<!-- doc-key: audit -->`.

---

### Pattern S3 — Bilingual technical-term policy (applies to: SKILL.zh-TW.md, README.zh-TW.md, docs/user/zh-TW/index.{md,html})

**Source contract (CONTEXT specifics line 155, RESEARCH Pitfall 11):**

> 中譯時，技術詞彙（command 名、檔案路徑、JSON 鍵）保留英文；只翻 narrative 段落與「why use it」解釋。

**Apply to:** every ZH file modified or created in this phase.
**Examples:**
- KEEP English: `dbcli audit tail --for-agent --n 10`, `.dbcli/audit/<connection>.jsonl`, `audit_recent`, `recovery_ref`, `audit_ref`, `audit.enabled = false`, `CONN_REFUSED`.
- TRANSLATE: narrative paragraphs, section headings (bilingual `中文 (English)` pattern when name is technical).
- HYBRID labels: `**風險門控 (Risk Gating)：**`, `### 稽核日誌 (Audit Log)`.

---

### Pattern S4 — D1 upgrade-impact callout (applies to: README.md, README.zh-TW.md, CHANGELOG.md)

**Source contract (Discretion F + RESEARCH Example 5):**

EN README blockquote:
```markdown
> **Default ON since v1.20.0.** Existing projects will begin creating
> `.dbcli/audit/<connection>.jsonl` on first command after upgrading.
> Set `audit.enabled = false` in `.dbcli` to opt out.
```

CHANGELOG `### Changed` first bullet (verbatim prefix mandatory):
```markdown
- **Default-on, upgrade impact:** `audit.enabled = true` by default — existing projects will start creating `.dbcli/audit/<connection>.jsonl` on first command after upgrade. Set `audit.enabled = false` in `.dbcli` to opt out. (D1)
```

**Apply to:** these three files MUST contain the callout. Tone: cool factual + opt-out one-liner (CONTEXT specifics line 151).

---

### Pattern S5 — release-check.sh step idiom (applies only to: scripts/release-check.sh)

**Source contract:** `scripts/release-check.sh:6-29` — every step is `step '<N/M> <label>'` followed by a single command (or guarded block). `set -euo pipefail` halts on any non-zero.

**New step constraint (D-77):** must use pure shell (`grep`, `node -p`) — NO `bun test`. Step 8/8 runs in ~50 ms vs `bun test`'s ~3 s startup.

---

## No Analog Found

None. Every Phase 26 file has a direct or close analog in the existing tree.

---

## Metadata

**Analog search scope:** `src/commands/`, `scripts/`, `tests/`, `assets/`, `docs/`, `README*.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `package.json`.
**Files scanned:** 16 modify/create targets + 4 read-only references (`src/adapters/capabilities.ts:111-122`, `src/utils/package-root.ts`, `scripts/check-user-docs.ts:3-19`, `tests/integration/i18n.test.ts:128-132`).
**Cross-cutting locks:** D-71 (full ZH translation), D-72 (reference.md stays EN), D-73 (no env-based default), D-74 (target filename stays SKILL.md), D-75 / D-76 (single audit row, tier alignment with capabilities.ts), D-77 / D-78 (pure-shell doc-presence step + 2 grep targets).
**Pattern extraction date:** 2026-05-17
