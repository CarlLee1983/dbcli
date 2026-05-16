---
phase: 26-docs-skill-release-gate
plan: A
type: execute
wave: 1
depends_on: []
files_modified:
  - assets/SKILL.md
  - assets/SKILL.zh-TW.md
  - src/commands/skill.ts
  - tests/unit/commands/skill.test.ts
  - tests/integration/dist-smoke.test.ts
autonomous: true
requirements: [DOCS-01]
requirements_addressed: [DOCS-01]
tags: [docs, skill, i18n, commander, audit-log]

must_haves:
  truths:
    - "`assets/SKILL.zh-TW.md` exists with full Traditional Chinese translation of `SKILL.md` (D-71)."
    - "Both `assets/SKILL.md` (EN) and `assets/SKILL.zh-TW.md` (ZH) contain a top-level `## Audit Log usage` (EN) / `## Audit Log 使用` (ZH) section with handoff + forensics scenarios (DOCS-01)."
    - "`dbcli skill --install <platform> --lang en|zh-TW` accepts the flag, validates via commander `choices(['en','zh-TW'])`, defaults to `en` (D-73)."
    - "`dbcli skill --output <file> --lang zh-TW` writes ZH content; default (no `--lang`) writes EN — zero break to v1.19.1 callers (D-73)."
    - "Target install filename remains `SKILL.md` regardless of source — `getInstallPath()` is UNCHANGED (D-74)."
  artifacts:
    - path: "assets/SKILL.zh-TW.md"
      provides: "Full ZH translation of SKILL.md with new Audit Log 使用 section"
      contains: "name: dbcli"
    - path: "assets/SKILL.md"
      provides: "EN SKILL with new `## Audit Log usage` section"
      contains: "## Audit Log usage"
    - path: "src/commands/skill.ts"
      provides: "--lang en|zh-TW commander option + resolveSkillSource() branch"
      exports: ["skillCommand", "registerSkillCommand", "SkillOptions"]
    - path: "tests/unit/commands/skill.test.ts"
      provides: "Unit coverage for --lang zh-TW write + default EN regression"
    - path: "tests/integration/dist-smoke.test.ts"
      provides: "Integration coverage for packaged ZH SKILL via --lang zh-TW"
  key_links:
    - from: "src/commands/skill.ts"
      to: "assets/SKILL.zh-TW.md"
      via: "resolveSkillSource('zh-TW') -> packageAssetPath('SKILL.zh-TW.md')"
      pattern: "packageAssetPath\\('SKILL\\.zh-TW\\.md'\\)"
    - from: "tests/integration/dist-smoke.test.ts"
      to: "assets/SKILL.zh-TW.md (via dist tarball)"
      via: "dbcli skill --output <tmp> --lang zh-TW"
      pattern: "--lang.*zh-TW"
---

<objective>
Ship bilingual SKILL.md infrastructure: full `SKILL.zh-TW.md` translation + a new `## Audit Log usage` section (EN + ZH) describing session-handoff and forensics agent workflows; add `--lang en|zh-TW` source-selector option to `dbcli skill --install` / `dbcli skill --output` with `en` as default; extend smoke + unit tests so `--lang zh-TW` is regression-locked.

Purpose: DOCS-01 lands as a release artifact: ZH-reading agents/users can install native-language SKILL.md while default EN behaviour stays byte-identical. AGENTS.md Multi-language Parity becomes a hard contract (EN and ZH ship in the same PR/plan, never independently).

Output: Updated EN SKILL with audit section, NEW full ZH SKILL, `--lang` flag wired through skill command, extended tests covering both languages.

Implements decisions: D-71 (full ZH translation, not stub), D-72 (reference.md stays EN-only — DO NOT touch reference.md in this plan), D-73 (`--lang en|zh-TW`, default `en`, no env auto-detect), D-74 (target filename stays `SKILL.md`; `getInstallPath()` unchanged).
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

# Phase 24 + 25 surfaces this SKILL section describes
@.planning/phases/24-audit-cli/24-CONTEXT.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md

# Existing skill command surface this plan extends
@src/commands/skill.ts
@assets/SKILL.md
@README.zh-TW.md

<interfaces>
<!-- Existing exports the executor will consume. Extracted from src/commands/skill.ts:13-22, 44-86, 92-156, 210-227 -->

From src/commands/skill.ts:

```typescript
// Module constants (line 13-17) — EXTEND, do not remove
const SKILL_SOURCE_PATH = packageAssetPath('SKILL.md')      // KEEP for checkSkillUpdates()
const REFERENCE_SOURCE_PATH = packageAssetPath('reference.md') // KEEP unchanged (D-72)

// Public interface (line 19-22) — EXTEND with lang?
export interface SkillOptions {
  install?: string
  output?: string
  // ADD: lang?: 'en' | 'zh-TW'
}

// Public handler signature (unchanged)
export async function skillCommand(_program: Command, options: SkillOptions): Promise<void>

// Public registration (line 210-227) — EXTEND option chain
export function registerSkillCommand(program: Command): Command
```

From src/utils/package-root.ts:

```typescript
export function packageAssetPath(filename: string): string
// Resolves `<package-root>/assets/<filename>`; works in both dev and packaged dist
```

From src/adapters/capabilities.ts (lines 111-122) — READ-ONLY reference, do not edit in this plan:

```typescript
auditTail:   cap('supported', 'readonly',     'Reads JSONL audit entries; never writes to engines.'),
auditShow:   cap('supported', 'readonly',     'Looks up a single audit entry by id prefix or recovery_ref.'),
auditHealth: cap('supported', 'readonly',     'Renders AuditLogger.getHealth() snapshot.'),
auditClear:  cap('supported', 'local-write',  'Removes <conn>.jsonl + .jsonl.1 from local disk; never touches DB.'),
```

The SKILL audit-section examples MUST cite tiers consistent with these (D-76 lock — referenced again in Plan B).
</interfaces>
</context>

<execution_order>
Tasks within this plan are NOT independent. Execute in this order: **A-2 → A-1 → A-3 → A-4**.

- A-2 creates `assets/SKILL.zh-TW.md` (needed by A-1's unit test that reads ZH content).
- A-1 extends `src/commands/skill.ts` + unit tests (depends on A-2's ZH file existing).
- A-3 adds the `## Audit Log usage` section to `assets/SKILL.md` (independent of A-1/A-2 but paired with A-2 for parity).
- A-4 extends dist-smoke (depends on A-1 + A-2 + a fresh `bun run build`).
</execution_order>

<tasks>

<task type="auto">
  <name>Task A-2: Create `assets/SKILL.zh-TW.md` — full Traditional Chinese translation (D-71)</name>
  <files>assets/SKILL.zh-TW.md</files>

  <read_first>
    - assets/SKILL.md (full 393 lines — source of truth for structure + technical terms)
    - README.zh-TW.md (lines 1-9 for header pattern; lines 75-102 for bilingual heading style `中文 (English)`, tone for narrative translation)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«1. assets/SKILL.zh-TW.md (CREATE)» (Analog 1 + 2, verbatim vs adapt guidance, Pitfalls)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«Pattern S3 — Bilingual technical-term policy» (KEEP English: command names, file paths, JSON keys, flags, error codes; TRANSLATE: narrative prose, headings, "why use it" explanations)
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Common Pitfalls» Pitfall 1, 3, 11
  </read_first>

  <action>
    Create `assets/SKILL.zh-TW.md` as a complete Traditional Chinese translation of `assets/SKILL.md`. This is NOT a stub or "audit section only" file — D-71 explicit: full file translation, parity with README.zh-TW.md split-file pattern.

    **MANDATORY structural elements (Pitfall 1 — `tests/integration/dist-smoke.test.ts:55` asserts these via `/^---/` + `/name: dbcli/`):**

    1. YAML frontmatter delimiter `^---` on line 1.
    2. `name: dbcli` line (unchanged English — it is a YAML field name + product name, not narrative).
    3. `description:` field (single-line YAML) — translate ONLY the narrative portion (the sentence describing what dbcli is). KEEP English for the field name `description:` itself.
    4. Closing `---` frontmatter delimiter.
    5. `# dbcli` H1 (UNCHANGED — product name).
    6. Tagline equivalent of `Database CLI for AI agents with permission-based access control` — translate to ZH.

    **Translation rules (PATTERNS §«Pattern S3»):**

    - **KEEP English (do NOT translate):**
      - All command names: `dbcli`, `query`, `inspect`, `audit tail`, `audit show`, `audit clear`, `audit health`, `recover`, `recover --apply`, etc.
      - All file paths: `.dbcli/`, `.dbcli/audit/<connection>.jsonl`, `assets/`, `~/.claude/skills/dbcli/`, `tests/helpers/sensitive-output.ts`.
      - All JSON keys: `recovery_ref`, `audit_ref`, `audit_recent`, `session_id`, `side_effect_tier`, `target`, `success`, `redacted_sql`.
      - All flag names: `--for-agent`, `--brief`, `--n`, `--all`, `--recovery-ref`, `--lang`, `--dry-run`, `--recovery`, `--format`, `--output`.
      - All error/code constants: `CONN_REFUSED`, `PERMISSION_DENIED`, etc.
      - Anything inside backticks or code fences — DO NOT TRANSLATE (Pitfall 11: `dbcli 稽核 末端` is WRONG; must remain `dbcli audit tail`).

    - **TRANSLATE (narrative prose + headings):**
      - Section headings: `## AI agent workflow (follow in order)` → `## AI 代理工作流程（依序執行）`; `## Quick start` → `## 快速開始`; `## Permission levels` → `## 權限等級`; etc.
      - Use bilingual hybrid for technical capability sections following README.zh-TW.md:75 precedent: e.g., `### 復原與引導式修復 (Recovery & Guided Remediation)`.
      - All "When the user asks for X, prefer Y" narrative prose.
      - All "Boundaries:", "Why use it:", parameter explanations.

    - **Heading parity with EN SKILL.md:** every `^##` and `^###` line in EN must have a ZH counterpart at the SAME nesting level. Validate (after Task A-3 adds the EN audit section): `diff <(grep -cE '^##' assets/SKILL.md) <(grep -cE '^##' assets/SKILL.zh-TW.md)` shows equal counts.

    **Audit Log section — include from the start of this file (paired with Task A-3):** AGENTS.md parity rule (CONTEXT specifics line 156) forbids EN-first / ZH-later — both land in the same plan/commit.

    Content for the ZH audit section (mirror Task A-3's EN content, translated per the rules above):

    ```markdown
    ## Audit Log 使用

    當需要跨 session 或事後 forensics 重建工具歷史時，請優先使用 audit log，而非從零開始查詢 DB 狀態。

    **情境 1 — Session handoff（接手前一個 agent 的工作）：**

    ```bash
    dbcli audit tail --for-agent --n 10           # 最近 10 筆（JSON envelope）
    dbcli audit tail --all --for-agent --n 20     # 跨連線合併（D4）
    ```

    取回 agent-facing JSON envelope，包含 `session_id` / `engine` / `command` / `target` / `success`，協助新 agent 快速掌握前一段工作脈絡。技術細節：metadata-only，**不**包含原始 SQL body / cell 值 / params（D3 鎖定）。

    **情境 2 — Forensics（重建失敗現場）：**

    ```bash
    dbcli recover --format json                   # 觀察 audit_recent 嵌入 + recovery_ref
    dbcli audit show <id-prefix>                  # 完整單筆 entry（≥4 字元 prefix）
    dbcli audit show --recovery-ref <envelope-id> # 反向找出觸發 envelope 的 audit entry
    ```

    `inspect` / `guide` / `recover` / `recover --apply` 的 agent JSON 內嵌 `audit_recent: AuditEntryBrief[]`（最近 5 筆），無須額外呼叫 audit CLI 即可看到歷史脈絡。Envelope 的 `audit_ref` 與 audit entry 的 `recovery_ref` 互為雙向指標。

    **已知限制（v1.20.0）：** Bi-directional 連結僅在 `query` / `inspect` / diagnostic 表面寫入；`insert` / `update` / `delete` / `export` / `q` / `schema` 失敗路徑暫未含 `audit_ref`，追蹤於 Phase 23-04 follow-up（見 `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`）。Recovery envelope 既有 linkage 不受影響。

    詳細指令參考：[`reference.md`](./reference.md) §audit（英文）。
    ```

    **Placement:** insert the audit section AT THE SAME relative position as the EN section will land (Task A-3) — after the ZH equivalent of `## Agent Task Packs`, before the ZH equivalent of `## Quick start`.

    **Optional first-line language link (RESEARCH §«Architecture Patterns» Pattern 1 — recommended):** add immediately after the frontmatter closing `---`:
    ```markdown
    **Languages:** [English](./SKILL.md) | [繁體中文](./SKILL.zh-TW.md)
    ```
    Mirrors README precedent; recommended ON.
  </action>

  <verify>
    <automated>test -f assets/SKILL.zh-TW.md && head -1 assets/SKILL.zh-TW.md | grep -qE '^---$' && grep -q '^name: dbcli$' assets/SKILL.zh-TW.md && grep -q '^## Audit Log 使用' assets/SKILL.zh-TW.md && grep -q 'dbcli audit tail --for-agent' assets/SKILL.zh-TW.md && grep -q '25-J1-COVERAGE-MATRIX' assets/SKILL.zh-TW.md</automated>
  </verify>

  <done>
    - `assets/SKILL.zh-TW.md` exists.
    - First line is `---` (frontmatter delimiter).
    - Contains `name: dbcli` literal.
    - Contains `## Audit Log 使用` heading.
    - Contains `dbcli audit tail --for-agent` (English command verbatim).
    - Contains `25-J1-COVERAGE-MATRIX` reference.
    - No translated command names: `grep -E '稽核 末端|查詢 表|顯示 結構' assets/SKILL.zh-TW.md` returns no matches (exit 1).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task A-1: Extend skillCommand with `--lang` selector + extend unit tests</name>
  <files>src/commands/skill.ts, tests/unit/commands/skill.test.ts</files>

  <read_first>
    - src/commands/skill.ts (full file — current 228 lines; the EXACT lines to modify are 13-22, 44-56, 210-227)
    - tests/unit/commands/skill.test.ts (full file — extend existing test pattern lines 38-68)
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Code Examples» Example 1 + Example 2 (ready-to-paste commander option + resolveSkillSource())
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«13. src/commands/skill.ts» (Analog 1/2/3 + Pitfall 2 — `getInstallPath()` MUST stay unchanged)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«15. tests/unit/commands/skill.test.ts» (new test bodies)
    - tests/integration/i18n.test.ts:128-132 (target-path assertion that locks `SKILL.md` filename — DO NOT break)
    - assets/SKILL.zh-TW.md (must exist — created in Task A-2)
  </read_first>

  <behavior>
    - Test 1 (NEW): `default --lang en prints EN SKILL to stdout` — calling `skillCommand({} as any, { lang: 'en' })` produces `logOutput` containing `# dbcli` and `Database CLI for AI agents`.
    - Test 2 (NEW): `writes ZH SKILL when --lang zh-TW with --output` — call writes a file whose content matches `/Audit Log 使用|稽核日誌|繁體中文/`.
    - Test 3 (REGRESSION): existing `prints SKILL.md to stdout by default` (`skillCommand({} as any, {})`) still passes byte-identically (defensive `options.lang ?? 'en'` inside `skillCommand` makes commander-bypass calls work).
    - Test 4 (REGRESSION): existing `writes to custom output file` still passes (no `--lang` supplied → EN content).
    - Test 5 (REGRESSION): existing `fails for unknown platform` still passes.
  </behavior>

  <action>
    Implement TWO atomic edits:

    **Edit 1 — `src/commands/skill.ts`:**

    1. KEEP `SKILL_SOURCE_PATH` (line 14) and `REFERENCE_SOURCE_PATH` (line 17) constants exactly as-is. They are still needed by `checkSkillUpdates()` (line 92-120) which compares installed file content to the **English** source. PATTERNS §13 Pitfall.

    2. Extend `SkillOptions` (line 19-22) by adding ONE field:
       ```typescript
       export interface SkillOptions {
         install?: string // platform: claude, gemini, copilot, cursor
         output?: string // custom output file path
         lang?: 'en' | 'zh-TW' // source language for SKILL content (default 'en', D-73)
       }
       ```

    3. Add a private helper BELOW the constants block (after line 17, before the `export interface`):
       ```typescript
       /**
        * Resolve the SKILL source markdown file path based on the requested language.
        * `--lang` is a SOURCE-FILE SELECTOR, not a `DBCLI_LANG` integration (D-73).
        * Target install/output filename stays `SKILL.md` regardless of source (D-74).
        */
       function resolveSkillSource(lang: string): string {
         if (lang === 'zh-TW') return packageAssetPath('SKILL.zh-TW.md')
         return packageAssetPath('SKILL.md')
       }
       ```

    4. Inside `skillCommand` (line 44-86), replace ONLY the file-reading block (currently line 46-50) to use the resolver:
       ```typescript
       // 1. Read static SKILL.<lang>.md (single source of truth; D-73 source selector)
       const lang = options.lang ?? 'en' // defensive: commander supplies default, but unit tests bypass commander
       const skillSourcePath = resolveSkillSource(lang)
       const skillFile = Bun.file(skillSourcePath)
       if (!(await skillFile.exists())) {
         throw new Error(`Skill source not found: ${skillSourcePath}`)
       }
       ```
       The existing `refFile = Bun.file(REFERENCE_SOURCE_PATH)` block on lines 51-54 stays untouched — D-72: reference.md is EN-only.

    5. Extend the commander chain in `registerSkillCommand` (lines 210-227). First, add `Option` to the imports at the top:
       ```typescript
       import { Command, Option } from 'commander'
       ```
       Then add the new option after the `--output` line:
       ```typescript
       return program
         .command('skill')
         .description(t('skill.description'))
         .option(
           '--install <platform>',
           'Install to platform directory (claude, gemini, copilot, cursor, codex, windsurf)'
         )
         .option('--output <path>', 'Write skill to file instead of stdout')
         .addOption(
           new Option('--lang <lang>', 'Source language for SKILL content').choices(['en', 'zh-TW']).default('en')
         )
         .action(/* unchanged */)
       ```
       Rationale: `.addOption(new Option().choices(['en','zh-TW']).default('en'))` enforces whitelist validation server-side via commander's `InvalidArgumentError` (RESEARCH §«Don't Hand-Roll» row 1; mitigates T-26-01).

    6. DO NOT touch `getInstallPath()` (lines 126-156) — D-74 lock. Target is always `SKILL.md` regardless of source language. `tests/integration/i18n.test.ts:128` asserts the literal install path `.../SKILL.md`; any deviation breaks that test.

    **Edit 2 — `tests/unit/commands/skill.test.ts`:**

    Append two new `test(...)` blocks at the end of the file (after the existing "fails for unknown platform" test, before the closing brace of the `describe` block). Use the existing `logSpy` / `errorSpy` / `exitSpy` setup verbatim — do not duplicate.

    ```typescript
    test('default --lang en prints EN SKILL to stdout', async () => {
      await skillCommand({} as any, { lang: 'en' })
      expect(logOutput).toContain('# dbcli')
      expect(logOutput).toContain('Database CLI for AI agents')
    })

    test('writes ZH SKILL when --lang zh-TW with --output', async () => {
      const testFile = join(process.cwd(), 'test-skill-zh.md')
      if (existsSync(testFile)) unlinkSync(testFile)
      try {
        await skillCommand({} as any, { output: testFile, lang: 'zh-TW' })
        expect(existsSync(testFile)).toBe(true)
        const content = await Bun.file(testFile).text()
        expect(content).toMatch(/Audit Log 使用|稽核日誌|繁體中文/)
      } finally {
        if (existsSync(testFile)) unlinkSync(testFile)
      }
    })
    ```
  </action>

  <verify>
    <automated>bun test tests/unit/commands/skill.test.ts</automated>
  </verify>

  <done>
    - `src/commands/skill.ts` exports `SkillOptions` with `lang?: 'en' | 'zh-TW'`.
    - `resolveSkillSource(lang: string)` exists and branches between `SKILL.md` / `SKILL.zh-TW.md`.
    - `registerSkillCommand` registers `--lang` via `.addOption(new Option(...).choices(['en','zh-TW']).default('en'))`.
    - `getInstallPath()` is unchanged (manual diff check shows zero modifications to lines 126-156).
    - `bun test tests/unit/commands/skill.test.ts` runs 5 tests, all green.
    - `grep -q "resolveSkillSource" src/commands/skill.ts` exits 0.
    - `grep -q "lang?: 'en' | 'zh-TW'" src/commands/skill.ts` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task A-3: Add `## Audit Log usage` section to `assets/SKILL.md` (EN)</name>
  <files>assets/SKILL.md</files>

  <read_first>
    - assets/SKILL.md (full 393 lines; INSERT POINT is after the `## Agent Task Packs` block ends ~line 72, before `## Quick start` ~line 74 — verify by `grep -n '^## ' assets/SKILL.md`)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«2. assets/SKILL.md» (Analog: `## Agent Task Packs` lines 53-72)
    - .planning/phases/26-docs-skill-release-gate/26-CONTEXT.md §«Specific Ideas» (two named scenarios: session handoff + forensics)
    - .planning/phases/24-audit-cli/24-CONTEXT.md (D-31..D-46 — flag names: `--for-agent`, `--brief`, `--n`, `--recovery-ref`, `<id-prefix>` ≥4 chars)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-50..D-61 — `audit_recent: AuditEntryBrief[]` embed surface)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md (the 6 unwired commands list for the known-limitation footer)
  </read_first>

  <action>
    Insert exactly ONE new top-level (`## `) section into `assets/SKILL.md`, immediately AFTER the existing `## Agent Task Packs` section ends and BEFORE the existing `## Quick start` section. Do NOT modify the frontmatter (lines 1-4), the `# dbcli` H1 (line 6), or the tagline (line 8) — Pitfall 1 + 3 (RESEARCH §«Common Pitfalls»).

    Insert this content VERBATIM:

    ```markdown
    ## Audit Log usage

    Use the audit log when you need cross-session history or forensics on what dbcli
    has done on this database, rather than re-querying live DB state from scratch.

    **Scenario 1 — Session handoff (picking up where another agent left off):**

    ```bash
    dbcli audit tail --for-agent --n 10           # last 10 entries as JSON envelope
    dbcli audit tail --all --for-agent --n 20     # cross-connection merged view (D4)
    ```

    Returns an agent-facing JSON envelope with `session_id` / `engine` / `command` /
    `target` / `success` per entry. Metadata-only by design — never raw SQL bodies,
    `--param` values, or result cell contents (D3 lock).

    **Scenario 2 — Forensics (reconstructing a failure):**

    ```bash
    dbcli recover --format json                   # inspect audit_recent embed + recovery_ref
    dbcli audit show <id-prefix>                  # full entry by id prefix (>=4 chars)
    dbcli audit show --recovery-ref <envelope-id> # find entry that emitted an envelope
    ```

    The `inspect` / `guide` / `recover` / `recover --apply` agent JSON output embeds
    `audit_recent: AuditEntryBrief[]` (last 5 entries) — a fresh session has immediate
    history context. The envelope's `audit_ref` and the audit entry's `recovery_ref`
    point at each other; agents can pivot either direction.

    **Known limitation (v1.20.0):** Bi-directional linkage is wired for `query`,
    `inspect`, and diagnostic surfaces. The commands `insert / update / delete /
    export / q / schema` emit single-direction recovery envelopes (no `audit_ref`)
    in v1.20.0; full coverage is tracked as Phase 23-04 follow-up. Recovery envelope
    linkage from the envelope side is unaffected.

    Audit entries are written to `.dbcli/audit/<connection>.jsonl` with rotation at
    ~10 MB or 1000 entries. `audit.enabled = false` in `.dbcli` opts out (default ON
    since v1.20.0). For flag reference see [`reference.md`](./reference.md) §audit.
    ```

    **Hard constraints:**
    - Heading level is `## ` (top-level, peer of Agent Task Packs / Quick start).
    - The frontmatter MUST remain `name: dbcli` (`tests/integration/dist-smoke.test.ts:55` assertion). Do not modify lines 1-4.
    - The `# dbcli` H1 (line 6) and tagline (line 8) MUST remain literal (`tests/unit/commands/skill.test.ts:38-42` assertions). Do not modify lines 6-8.
    - All command names and JSON keys stay verbatim — no decoration, no shell-line continuation backslashes, no Markdown link auto-wrapping inside the fenced bash block.
    - `[reference.md](./reference.md)` link uses relative path matching existing SKILL.md cross-refs.
  </action>

  <verify>
    <automated>grep -qE '^## Audit Log usage$' assets/SKILL.md && grep -q 'dbcli audit tail --for-agent --n 10' assets/SKILL.md && grep -q 'audit_recent: AuditEntryBrief' assets/SKILL.md && grep -qE '25-J1-COVERAGE-MATRIX|Phase 23-04 follow-up' assets/SKILL.md && head -8 assets/SKILL.md | grep -q '^name: dbcli$' && grep -q '^# dbcli$' assets/SKILL.md && bun test tests/unit/commands/skill.test.ts</automated>
  </verify>

  <done>
    - `assets/SKILL.md` contains `^## Audit Log usage$`.
    - Frontmatter `name: dbcli` is intact.
    - `# dbcli` H1 + tagline `Database CLI for AI agents` are intact.
    - Section contains both scenarios (Session handoff + Forensics) with the exact command-line examples specified.
    - Known limitation paragraph cites Phase 23-04 and lists all 6 unwired commands.
    - `bun test tests/unit/commands/skill.test.ts` passes (regression check: default-stdout test still finds `# dbcli`).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task A-4: Extend `tests/integration/dist-smoke.test.ts` with `--lang zh-TW` packaged-asset assertion</name>
  <files>tests/integration/dist-smoke.test.ts</files>

  <read_first>
    - tests/integration/dist-smoke.test.ts (full file; the EXACT test to mirror is lines 49-56 `skill --output writes packaged SKILL.md`)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«16. tests/integration/dist-smoke.test.ts»
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Open Questions» Q1 (recommendation: add the assertion)
    - scripts/build.ts (verify it copies `assets/*` wholesale — Pitfall 5 / Assumption A3)
    - package.json:37-43 (`files: ["assets/", "dist/", ...]` whole-directory inclusion)
  </read_first>

  <behavior>
    - Test (NEW): `skill --output --lang zh-TW writes packaged ZH SKILL` — after `bun run build`, the packaged dist must successfully serve the ZH SKILL via `--lang zh-TW`. Assertions: exit code 0, output file starts with `---` frontmatter, contains `name: dbcli`, contains ZH content marker (`Audit Log 使用` OR `稽核日誌` OR `繁體中文`).
  </behavior>

  <action>
    Append ONE new `test(...)` block to `tests/integration/dist-smoke.test.ts`, immediately after the existing `test('skill --output writes packaged SKILL.md', ...)` block (around line 56). Mirror the existing test's structure verbatim — same `run([...], workdir)` invocation, same `readFileSync(out, 'utf8')` pattern.

    ```typescript
    test('skill --output --lang zh-TW writes packaged ZH SKILL', () => {
      const out = join(workdir, 'SKILL.zh-TW.md')
      const r = run(['skill', '--output', out, '--lang', 'zh-TW'], workdir)
      expect(r.status).toBe(0)
      const text = readFileSync(out, 'utf8')
      expect(text).toMatch(/^---/) // YAML frontmatter delimiter
      expect(text).toMatch(/name: dbcli/) // Pitfall 1: same frontmatter contract as EN
      expect(text).toMatch(/Audit Log 使用|稽核日誌|繁體中文/) // ZH content marker
    })
    ```

    **Pre-execution sanity check (before committing):** run `bun run build` once locally and confirm `dist/cli.mjs` produces and `bun test tests/integration/dist-smoke.test.ts` passes the new test. If `bun run build` errors with `Skill source not found` resolving `SKILL.zh-TW.md`, then `scripts/build.ts` is explicitly enumerating files — in that case, ALSO update `scripts/build.ts` to include `assets/SKILL.zh-TW.md` (RESEARCH Assumption A3). If `package.json:files` whole-copies `assets/` and `packageAssetPath()` resolves at runtime, no build.ts change is needed.
  </action>

  <verify>
    <automated>bun run build && bun test tests/integration/dist-smoke.test.ts</automated>
  </verify>

  <done>
    - `tests/integration/dist-smoke.test.ts` contains the new `skill --output --lang zh-TW writes packaged ZH SKILL` test.
    - `bun test tests/integration/dist-smoke.test.ts` shows all tests green (original `skill --output writes packaged SKILL.md` + the new ZH test).
    - `bun run build` succeeds without `Skill source not found` errors.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI argv → skillCommand | User-supplied `--lang` value crosses from shell into `resolveSkillSource()` which uses it as a filename selector. |
| `assets/*.md` → file write | Whatever ZH content lands in `assets/SKILL.zh-TW.md` will be installed verbatim onto user systems via `dbcli skill --install`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-26-01 | Tampering / Input Validation (ASVS V5) | `--lang <value>` argv → `resolveSkillSource(lang)` → `packageAssetPath(filename)` | mitigate | Commander `.addOption(new Option('--lang <lang>').choices(['en','zh-TW']).default('en'))` enforces server-side whitelist BEFORE `resolveSkillSource` is called. A malicious `--lang ../../../etc/passwd` is rejected at commander's parse layer with `InvalidArgumentError`. Severity: LOW (path traversal blocked by enum-only choices). Verified by: commander's built-in `choices()` test + manual smoke `bun run src/cli.ts skill --lang ../../etc/passwd` exits non-zero with `Allowed choices are en, zh-TW` message. |
| T-26-01b | Tampering / Information Disclosure | `assets/SKILL.zh-TW.md` content authored by humans (not auto-translated) | accept | Translation content is human-reviewed (manual-only verification per VALIDATION.md). PR review ensures no accidental SQL/path leakage. Severity: LOW (SKILL.md is public documentation; no PII/secrets). |

**ASVS coverage:** V5 (Input Validation) for `--lang` flag whitelist; V7 (Error Handling) for `Skill source not found` error message (already routed through existing `t_vars('errors.message', ...)` at skill.ts:83).
</threat_model>

<verification>
After all 4 tasks complete:

```bash
# Unit + integration
bun test tests/unit/commands/skill.test.ts
bun test tests/integration/dist-smoke.test.ts
bun test tests/integration/i18n.test.ts   # MUST stay green (D-74: SKILL.md target filename)

# Build + smoke
bun run build
ls -la dist/cli.mjs
test -f assets/SKILL.zh-TW.md && echo "ZH source present"

# Structural sanity
grep -qE '^## Audit Log usage$' assets/SKILL.md
grep -qE '^## Audit Log 使用' assets/SKILL.zh-TW.md
grep -q 'resolveSkillSource' src/commands/skill.ts
grep -q "lang?: 'en' | 'zh-TW'" src/commands/skill.ts
```
</verification>

<success_criteria>
- `assets/SKILL.zh-TW.md` exists with full ZH translation (DOCS-01 part 1)
- `assets/SKILL.md` has `## Audit Log usage` section (DOCS-01 part 2)
- `dbcli skill --install <platform> --lang en|zh-TW` works, defaults to `en` (DOCS-01 part 3)
- Existing `dbcli skill` (no flags) behaviour byte-identical to v1.19.1 (zero-break)
- `tests/integration/i18n.test.ts` stays green (D-74: target SKILL.md path unchanged)
- All new + existing skill tests pass
- T-26-01 mitigated via commander `choices()` whitelist
</success_criteria>

<output>
After completion, create `.planning/phases/26-docs-skill-release-gate/26-A-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. Set `requirements-completed: [DOCS-01]`. Note in Decisions: "Used `.addOption(new Option().choices(['en','zh-TW']).default('en'))` per D-73 + RESEARCH Don't-Hand-Roll row 1 (auto InvalidArgumentError, no new i18n key)."
</output>
