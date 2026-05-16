# Phase 26: Docs, Skill & Release Gate - Research

**Researched:** 2026-05-16
**Domain:** Documentation engineering + release tooling (no runtime changes)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (DO NOT propose alternatives, only investigate implementation)

- **D-71:** `assets/SKILL.zh-TW.md` is a **full SKILL.md translation**, not a stub. New "Audit Log usage / Audit Log 使用" section lands on EN + ZH simultaneously. Locks AGENTS.md Multi-language Parity doctrine.
- **D-72:** `assets/reference.md` **stays English-only**. DOCS-01 names SKILL.md only; reference.md 1254-line cheatsheet ZH translation is deferred.
- **D-73:** `dbcli skill --install <platform>` gains `--lang en|zh-TW`, **default `en`**. No `DBCLI_LANG` env / system `LANG` auto-detection. Existing install behaviour (no flag = English) is zero-breaking.
- **D-74:** Filename = `SKILL.zh-TW.md` (matches `README.zh-TW.md` precedent; not `SKILL.zh.md`). Installer **target** filename stays `SKILL.md` regardless of source — agent / platform dirs never see two filenames.
- **D-75:** Single `audit` row in `docs/feature-matrix.md`, **N/A across all six engines** (follows `recover` / `skill` precedent). Notes column lists 4 subcommands with their tier mapping. Do not split into 4 rows or 2 rows.
- **D-76:** Side-effect tier mapping locked: `audit tail` / `audit show` / `audit health` = **`readonly`**; `audit clear` = **`local-write`**. Aligns with `src/adapters/capabilities.ts:111-122` (already shipped). Side-effect tiers table examples column adds `audit tail` to readonly row and `audit clear` to local-write row.
- **D-77:** `scripts/release-check.sh` gains **doc-presence step** as a **release-blocking** shell-grep step (pure shell, NOT a TypeScript integration test). Faster than `bun test`, fits step-sequence style.
- **D-78:** Doc-presence grep targets are **two** items:
  1. `docs/feature-matrix.md` contains a markdown row beginning with `` | `audit` ``.
  2. `CHANGELOG.md` contains `## [<package.json version>]` heading (version read via `node -p` from `package.json`).

  Do **not** grep SKILL.md / SKILL.zh-TW.md for the "Audit Log usage" heading (D-73 + PR review covers parity). Do **not** add sentinel HTML comments to README.

### Claude's Discretion (defaults to investigate; planner decides)

- **E. Phase 23-04 partial-coverage disclosure** — Default: CHANGELOG `### Changed` single-line known-limitation citing 6 unwired commands (`insert / update / delete / export / q / schema`) and pointing at `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`. Planner may adjust the exact placement (Added/Changed/Notes) but the disclosure must ship.
- **F. README D1 upgrade-impact placement** — Default: new top-level `## Audit Log` section in `README.md` + `README.zh-TW.md`, positioned **between `## AI Integration Guide` and `## Troubleshooting`**. First paragraph uses `>` blockquote labelled **Default ON since v1.20.0** with opt-out one-liner (`audit.enabled = false`). CHANGELOG `### Changed` repeats one line with `**Default-on, upgrade impact:**` prefix.
- **G. `docs/user/{en,zh-TW}/index.{md,html}` parity scope** — Default: (1) add `audit` row to `Health, Diagnostics & Recovery` table; (2) **do NOT** add audit to `Database Engine Support Matrix` (audit is cross-engine local); (3) `AI Agent Integration` section adds one bullet `**Audit Log**: see SKILL.md / README §Audit Log`; (4) `.md` ⇄ `.html` parity + `en` ⇄ `zh-TW` parity = 4 files; (5) no standalone audit chapter in user docs (depth lives in SKILL.md / reference.md / README).

### Deferred Ideas (OUT OF SCOPE — ignore)

- `assets/reference.md` ZH translation (defer to v1.21.x+ if non-EN signal emerges)
- Standalone Audit Log chapter in `docs/user/*/index.*` (4-file table-row + bullet only)
- Automated SKILL.md ⇄ SKILL.zh-TW.md heading-consistency check in release-check.sh (D-78 lock)
- Marketing material (blog / Twitter) for audit log release
- Phase 23-04 implementation (wire `writeAuditEntry` into 6 commands) — known limitation only, not executed here
- Additional SKILL languages beyond en/zh-TW (日/韓/簡中)
- Tamper-evident / hash-chain checks on release-check.sh (compliance roadmap)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOCS-01 | SKILL.md adds bilingual "Audit Log usage" chapter (handoff + forensics scenarios); EN body + new `SKILL.zh-TW.md` ZH twin; `dbcli skill --install --lang en\|zh-TW` flag (default `en`) | §Standard Stack (commander option + i18n key namespace); §Architecture Patterns (split-file mirror); §Code Examples (installer branch on `lang`); §Common Pitfalls (packaged assets path, test fixture HOME) |
| DOCS-03 | `docs/feature-matrix.md` adds single `audit` row (N/A) + Side-effect tiers examples (audit subcommands); `scripts/release-check.sh` gains shell-grep doc-presence step (feature-matrix audit row + CHANGELOG version heading) | §Architecture Patterns (release-check 7-step sequence); §Code Examples (shell-grep with `set -euo pipefail`); §Common Pitfalls (backtick-in-grep-pattern, `node -p` reliability) |
| DOCS-04 | README.md / README.zh-TW.md add top-level `## Audit Log` section + D1 upgrade-impact blockquote; CHANGELOG.md adds v1.20.0 section with Added/Changed (incl. D1 callout + Phase 23-04 known limitation pointing at `25-J1-COVERAGE-MATRIX.md`) | §Architecture Patterns (Keep a Changelog format); §Code Examples (v1.19.1 / v1.17.0 CHANGELOG precedents); §Common Pitfalls (en/zh-TW parity, package.json version bump alignment) |
</phase_requirements>

## Summary

Phase 26 is **a documentation-only release-gate phase**. No runtime / engine code changes are expected. The four code touchpoints are: (1) `src/commands/skill.ts` (+1 commander option `--lang en|zh-TW`, +1 conditional source-file branch); (2) `resources/lang/{en,zh-TW}/messages.json` (potentially +1-2 keys for the new flag's error message — only if planner adds custom validation); (3) `scripts/release-check.sh` (+1 shell step); (4) `package.json` version bump `1.19.1` → `1.20.0` (driven by D-78's `node -p` version grep — see §Common Pitfalls Pitfall 6).

All other work is content editing across **11 files**: `assets/SKILL.md` (extend), `assets/SKILL.zh-TW.md` (new), `assets/reference.md` (add `### audit` subcommand section), `docs/feature-matrix.md` (extend), `README.md` + `README.zh-TW.md` (new section), `CHANGELOG.md` (new version section), `docs/user/{en,zh-TW}/index.{md,html}` (4 files synced). The phase's risk profile is **silent inconsistency** between parallel files, not runtime correctness — which is why D-77 (release-blocking grep) and `scripts/check-user-docs.ts` (existing parity check) are the two validation backbones.

The biggest research surprises are: (1) `package.json` is still at `1.19.1` — D-78's `node -p require('./package.json').version` grep will fail until the version bump happens in this phase; (2) `tests/integration/dist-smoke.test.ts:50-56` already asserts SKILL.md `^---` frontmatter + `name: dbcli` — adding the new "Audit Log usage" section is structurally safe but the dist-smoke must also continue to pass if/when `SKILL.zh-TW.md` is added to packaged assets; (3) `scripts/check-user-docs.ts` already enforces parity across 14 required doc-keys — Phase 26 should **NOT** add a new doc-key; instead reuse existing `diagnostics-recovery` (table row) and `ai-agent-integration` (bullet) sections to avoid breaking that script.

**Primary recommendation:** Ship as **4 plans** — (A) SKILL bilingual + `--lang` flag (DOCS-01), (B) feature-matrix + side-effect tiers (DOCS-03 doc half), (C) release-check.sh doc-presence + CONTRIBUTING sync + version bump (DOCS-03 gate half), (D) README/CHANGELOG/user-docs index (DOCS-04). Run `bun run release:check` at the end of (D) as the phase-completion proof.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SKILL.md bilingual content | Static asset (packaged via `assets/`) | — | Read-only at runtime by `skill --install`; ships in npm tarball via `files: ["assets/"]` (package.json:37-43) |
| `--lang` flag dispatch | CLI / Commander | i18n loader (reuse only) | `src/commands/skill.ts` reads file path conditionally; `--lang` is a **filename selector**, not a `DBCLI_LANG` integration (D-73 explicit) |
| Installer target path | CLI / filesystem | — | `getInstallPath()` (skill.ts:126-156) unchanged — target is always `SKILL.md` regardless of source (D-74) |
| feature-matrix row + tier examples | Documentation (markdown) | Capability registry (`src/adapters/capabilities.ts`, read-only reference) | D-76 mirrors `auditTail/Show/Health/Clear` rows already at capabilities.ts:111-122 |
| release-check doc-presence | Build tooling / shell script | — | `scripts/release-check.sh` step 7→8 (or 0→1, see Pitfall 9); pure shell, no Node test runner |
| CHANGELOG v1.20.0 section | Documentation (markdown) | — | `Keep a Changelog` format, grep'd by D-78 via `## [<version>]` heading pattern |
| README §Audit Log | Documentation (markdown) | — | Top-level section in en + zh-TW; planner-discretion F decides positioning |
| User docs parity (4 files) | Documentation | `scripts/check-user-docs.ts` (existing parity check) | docs-key sentinels already enforced; G constrains to table row + AI bullet only |

## Standard Stack

### Core (already shipped — Phase 26 only consumes these)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Commander.js | 13.0.0 | CLI option declaration (`--lang` flag) | Already used in `src/commands/skill.ts:213-218` `.option('--install <platform>', ...)` — same idiom applies [VERIFIED: package.json:62, skill.ts:213-218] |
| Bun shell `$` | bundled | `mkdir -p` cross-platform fallback | Already used in `skill.ts:194` for install path creation; no new dep needed [VERIFIED: skill.ts:6,194] |
| `node -p` | Node 22 (system) | Read `package.json` version inside release-check.sh | D-78 pattern; portable across macOS/Linux/Windows-bash [VERIFIED: `node --version` v22.17.1 installed on this machine] |

### Supporting (already shipped — no version changes in Phase 26)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| i18n loader (`@/i18n/message-loader`) | internal | If planner adds `--lang` validation error message | Only needed if invalid lang values produce a localized error; D-73 implies `commander` choice validation suffices [VERIFIED: skill.ts:9, messages.json:221-226 has `skill.*` namespace] |
| `Bun.file()` API | bundled | Read SKILL source file conditionally based on `--lang` | Same pattern as existing skill.ts:47,51 — no new pattern [VERIFIED: skill.ts:47-55] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node -p require('./package.json').version` | `jq -r .version package.json` | `jq` is not a guaranteed dependency on contributor machines; `node` is (engines node >=18). D-78 already specifies `node -p`. [REJECTED — keep node -p] |
| Pure shell `grep` for audit row | `awk` / `sed` extraction | `grep -q` is sufficient for presence check (`-q` returns 0/1, `set -e` halts on failure). Avoid `awk`/`sed` for byte-perfect matching with backticks. [VERIFIED via Pitfall 7 below] |
| Adding doc-presence as `bun test` | Shell step inside release-check.sh | D-77 lock — shell is ~10× faster than spinning up `bun test`, fits the existing 7-step shell style. |
| TypeScript loader for SKILL.zh-TW.md | Add ZH path as alternate `packageAssetPath('SKILL.zh-TW.md')` | Direct file-path branch is simpler than introducing a loader abstraction; aligns with skill.ts:14-17 conventions. |

**Installation:** No new npm packages. Only `package.json` version bump (1.19.1 → 1.20.0).

**Version verification:**
- Commander 13.0.0 — pinned in `package.json:62` [VERIFIED: package.json]
- Bun runtime — `1.3.10` installed [VERIFIED: `bun --version`]
- Node — `v22.17.1` installed [VERIFIED: `node --version`]
- Current dbcli version in `package.json` — `1.19.1` (NOT YET bumped to 1.20.0; bump is a Phase 26 task — see Pitfall 6)

## Architecture Patterns

### System Architecture Diagram

```
                                Phase 26 Documentation Pipeline
                                ──────────────────────────────────────

  Source authoring                Validation                           Distribution
  ───────────────                 ──────────                           ────────────

  assets/SKILL.md  ─────┐                                          ┌── npm tarball
                        │                                          │   (files: ["assets/", ...])
  assets/SKILL.zh-TW.md ┤                                          │
  (NEW)                  │                                         │
                         ▼                                         │
  assets/reference.md ─►┌─────────────────────────────────┐  ──►   │  dist/cli.mjs
                        │ scripts/release-check.sh        │        │   (bundles assets path)
  docs/feature-matrix.md┤   1/8 bun audit                 │        │
                        │   2/8 prettier --check          │        │
  README.md ────────────┤   3/8 typecheck                 │        │
  README.zh-TW.md       │   4/8 lint                      │        │
                        │   5/8 test (bun test)           │        │
  CHANGELOG.md ─────────┤   6/8 build                     │        │
                        │   7/8 dist smoke                │        │
  docs/user/en/         │   8/8 doc-presence (NEW)        │        │
    index.md ───────────┤      ├── grep audit row in       │       │
    index.html          │      │   feature-matrix.md       │       │
  docs/user/zh-TW/      │      └── grep ## [<ver>] in      │       │
    index.md ───────────┤          CHANGELOG.md            │       │
    index.html          │                                  │       │
                        │ scripts/check-user-docs.ts       │ ──►   │  installed skill files
                        │   (parity, existing)             │        │   (claude/gemini/copilot/
                        └─────────────────────────────────┘         │    cursor/codex/windsurf)
                                                                    │
                                                                    │
              ┌─────────────────────────────────┐                   │
              │ src/commands/skill.ts           │                   │
  --lang ────►│   --lang en|zh-TW (NEW)         │                   │
              │     │                            │                  │
              │     ├── en  → assets/SKILL.md    │                  │
              │     └── zh-TW → SKILL.zh-TW.md   │                  │
              │                                  │                  │
              │   getInstallPath() unchanged     │                  │
              │   Target filename always SKILL.md│ ─────────────────┘
              └─────────────────────────────────┘
```

### Recommended Project Structure

No new directories. All Phase 26 files live in existing locations:

```
.
├── assets/
│   ├── SKILL.md                # extended (DOCS-01 EN)
│   ├── SKILL.zh-TW.md          # NEW (D-71/D-74)
│   └── reference.md            # extended (### audit subcommand, EN-only per D-72)
├── docs/
│   ├── feature-matrix.md       # extended (D-75/D-76)
│   └── user/
│       ├── en/{index.md,index.html}      # synced (Planner-discretion G)
│       └── zh-TW/{index.md,index.html}   # synced (Planner-discretion G)
├── scripts/
│   └── release-check.sh        # +1 step (D-77/D-78)
├── src/commands/
│   └── skill.ts                # +1 option, +1 branch (D-73)
├── README.md                   # +`## Audit Log` section (Planner-discretion F)
├── README.zh-TW.md             # +`## Audit Log` section (mirror)
├── CHANGELOG.md                # +v1.20.0 section (DOCS-04)
├── CONTRIBUTING.md             # +1 checklist line (sync with release-check)
└── package.json                # version bump 1.19.1 → 1.20.0
```

### Pattern 1: Split-file ZH translation mirror

**What:** Each user-facing markdown file in EN has a sibling `*.zh-TW.md` translation file.
**When to use:** SKILL.md gains a ZH twin (D-71); reference.md does not (D-72).
**Example precedent in this repo:** `README.md` ⇄ `README.zh-TW.md` (already shipped, line 1 of each cross-links the other). [VERIFIED: README.md:3 has `**Languages:** [English](./README.md) | [繁體中文](./README.zh-TW.md)`]

**Apply to SKILL:** Top of `assets/SKILL.md` does NOT currently advertise the ZH twin (frontmatter `name: dbcli` + `description:` only — line 1-3). Two options:
- Add a Languages link line right after the frontmatter (mirrors README precedent).
- Keep SKILL.md frontmatter-clean (agent-facing tool — extra link line is noise). Then put the cross-link in the `## AI agent workflow` block.

Planner decides. Recommended: minimal text link, mirroring README precedent.

### Pattern 2: Commander option default + filename selector

**What:** `--lang en|zh-TW` is a **source-file selector**, not an i18n locale switch.
**When to use:** D-73 — `--lang` MUST NOT consult `DBCLI_LANG` env. Default = `en`. Installer's TARGET filename is always `SKILL.md` (D-74).

**Example pattern (from existing skill.ts:213-218):**
```typescript
// Source: src/commands/skill.ts:210-227 (current)
return program
  .command('skill')
  .description(t('skill.description'))
  .option(
    '--install <platform>',
    'Install to platform directory (...)',
  )
  .option('--output <path>', 'Write skill to file instead of stdout')
  .action(async (options) => { await skillCommand(program, options) })
```

**Extension pattern (D-73):**
```typescript
// Source: planned addition
  .option(
    '--lang <lang>',
    'Source language for SKILL content: en (default) or zh-TW',
    'en',  // commander default value as 3rd arg
  )
```

Commander's `.choices(['en', 'zh-TW'])` is NOT used in 13.0.0 for `.option()` directly (only `.addOption(new Option().choices(...))`). For robustness — if planner wants validation — wrap in:
```typescript
.addOption(new Option('--lang <lang>', 'Source language').choices(['en', 'zh-TW']).default('en'))
```
[CITED: commander.js v13 docs — `new Option().choices()` pattern]

### Pattern 3: Keep a Changelog format

**What:** CHANGELOG.md uses `## [<version>] - YYYY-MM-DD` headings + `### Added/Changed/Fixed/Removed/Security/Internal/Notes` subsections.
**Example precedent (v1.17.0, v1.19.0, v1.19.1):**
- v1.19.1 (CHANGELOG.md:9) — Changed / Fixed / Tests
- v1.19.0 (CHANGELOG.md:28) — Added (single section, behavior-additive release)
- v1.17.0 (CHANGELOG.md:48) — Added / Changed / Security / Internal (4-section, biggest precedent for a feature release with upgrade-impact callout)

**v1.20.0 skeleton draft:**
```markdown
## [1.20.0] - <release-date>

### Added
- **Agent-facing Audit Log**: every db-touching command now writes a structured JSONL entry to `.dbcli/audit/<connection>.jsonl` ...
- `dbcli audit tail | show | clear | health` subcommands for inspecting / managing audit log
- `dbcli audit tail --all` cross-connection merged view; `--for-agent` / `--brief` shortcuts
- `dbcli audit show --recovery-ref <id>` bi-directional lookup
- Recovery envelope bi-directional linkage: `recovery_ref` (audit→envelope) ⇄ `audit_ref` (envelope→audit)
- `inspect` / `guide` / `recover` / `recover --apply` JSON output embeds `audit_recent: AuditEntryBrief[]` (N=5)
- `dbcli skill --install --lang en|zh-TW` to install ZH-translated SKILL.md
- Bilingual `assets/SKILL.zh-TW.md` (full translation of `SKILL.md`)

### Changed
- **Default-on, upgrade impact:** `audit.enabled = true` by default — existing projects will start creating `.dbcli/audit/<connection>.jsonl` on first command after upgrade. Set `audit.enabled = false` in `.dbcli` to opt out. (D1)
- `inspect` / `guide` / `recover` `--for-agent` JSON output gains `audit_recent` field (additive; shape stable; not a breaking change)
- _Known limitation (Phase 23-04 follow-up):_ Audit log captures `query`, `inspect`, and diagnostic-surface commands in v1.20.0; coverage for `insert / update / delete / export / q / schema` is tracked as Phase 23-04 follow-up (see `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`). Recovery envelope linkage is unaffected.

### Internal
- New modules: `src/core/audit/{logger,lock,rotation,reader,recent,session-id,types,integration-helper}.ts`
- `tests/integration/{audit-contract,audit-envelope,recovery-audit-link}.test.ts` contract tests added to release gate
- `scripts/release-check.sh` step 8/8 doc-presence grep
```

[CITED: CHANGELOG.md:48-86 v1.17.0 precedent for combined Added + Changed + Security release; CHANGELOG.md:9-26 v1.19.1 for Changed-only precedent]

### Pattern 4: release-check.sh step insertion

**What:** Pure shell step using `printf '\n\033[1;34m▶ %s\033[0m\n' "$*"`; runs under `set -euo pipefail` (failure halts).
**Current 7-step sequence:** bun audit → prettier --check → typecheck → lint → test → build → dist smoke [VERIFIED: release-check.sh:1-29]

**D-77 insertion point options (see Pitfall 9):**
- **Option A (recommended):** New step 8/8 AFTER `dist smoke`. Numbering becomes `1/8`..`8/8`. Pro: doc-presence depends on `CHANGELOG.md` having the version that the just-built dist embeds — running last guarantees those two artifacts agree. Con: 30+s deeper into the pipeline.
- **Option B:** New step 1/8 BEFORE `bun audit`. Pro: fastest fail on doc drift; doesn't depend on any build artifact. Con: requires `node -p` to read package.json which is fine, but introduces a "version not yet bumped" race during PR review.

**Recommendation:** Option A — doc-presence is a "ship-readiness" check, not a code-quality check. Place after build/smoke so a release candidate that fails doc-presence is the only thing blocking.

**Renumbering note:** All `step '1/7 ...'` strings must change to `1/8`. Trivial sed.

**Example code:**
```bash
# Source: planned addition to scripts/release-check.sh
step '8/8 doc-presence'
PKG_VERSION=$(node -p "require('./package.json').version")
grep -qE '^\| `audit` ' docs/feature-matrix.md \
  || { echo "Missing 'audit' row in docs/feature-matrix.md" >&2; exit 1; }
grep -qF "## [${PKG_VERSION}]" CHANGELOG.md \
  || { echo "Missing '## [${PKG_VERSION}]' heading in CHANGELOG.md" >&2; exit 1; }
echo "  ✓ feature-matrix has audit row"
echo "  ✓ CHANGELOG.md has ## [${PKG_VERSION}] heading"
```

[VERIFIED via Pitfall 7: backtick-in-pattern handled by quoting the whole pattern with single quotes; `-E` for extended regex; `-F` for fixed string to avoid `[` regex meta-character problem in version heading]

### Pattern 5: docs/user parity via existing `check-user-docs.ts`

**What:** `bun run docs:check` (package.json:53) runs `scripts/check-user-docs.ts`, which:
1. Asserts both EN and ZH locales have all 14 required `<!-- doc-key: ... -->` markers (line 4-19 of script)
2. Asserts md/html have identical doc-key order
3. Asserts no duplicates

**Phase 26 must NOT introduce a new doc-key.** Required keys are frozen at 14. The audit content lives inside two **existing** doc-keys:
- `<!-- doc-key: diagnostics-recovery -->` — table row addition (G item 1)
- `<!-- doc-key: ai-agent-integration -->` — bullet addition (G item 3)

**Why this matters:** If a planner accidentally adds `<!-- doc-key: audit -->` to one of the 4 files, the parity check passes but the required-keys check ignores it (only flags missing required keys). Adding it to all 4 files would also pass — but it would create a permanent maintenance liability with no enforcement. Stick to G's "inline into existing keys" rule.

### Anti-Patterns to Avoid

- **Re-defining tier values in feature-matrix.md:** The Side-effect tiers table (line 42-53) is "single source of truth in docs"; the **single source of truth in code** is `src/adapters/capabilities.ts` `SideEffectTier` union. D-76 mandates direct alignment — don't pick a 6th tier or rename one.
- **Treating `--lang zh-TW` as a locale switch:** D-73 explicit — it's a source-file selector. The CLI's i18n (`DBCLI_LANG`) is unrelated. The user could be running an English CLI with `--lang zh-TW` to install a ZH SKILL.md for a ZH-reading colleague's Cursor IDE.
- **Auto-detecting `DBCLI_LANG` to set `--lang` default:** D-73 forbids — env is unreliable in CI/containers; explicit flag is documentable and predictable.
- **Adding a new `## ` section to README between existing sections without re-checking `check-user-docs.ts`:** README is NOT checked by `check-user-docs.ts` (only `docs/user/*` is). Safe to add `## Audit Log` to README freely.
- **Modifying the existing audit-contract test file structure:** Phase 22 / Phase 24 / Phase 25 contract tests are immutable artifacts of release gates — Phase 26 must not alter them.
- **Putting `audit clear` under `interactive` tier in side-effect tiers table:** D-46/D-76 explicit — interactive prompts are commander layer; tier is about target side-effects. `audit clear` mutates local filesystem = `local-write`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Validating `--lang` value | Custom switch + manual error | Commander's `.addOption(new Option().choices(['en', 'zh-TW']))` | Built-in `commander.InvalidArgumentError` with auto-formatted message, no i18n key needed |
| Reading `package.json` version in shell | Manually `grep` + `sed` | `node -p "require('./package.json').version"` | D-78 mandates; portable; handles edge cases (whitespace, trailing commas) |
| Verifying parity between md/html user docs | Custom parser | `bun run docs:check` (existing) | Already covers required keys, order, duplicates — extending it for Phase 26 is unneeded |
| Auto-translating SKILL.md EN→ZH | LLM call / machine translation | Manual translation per AGENTS.md (technical terms stay English; narrative is translated) | Translation quality requires human-in-loop; CONTEXT.md `<specifics>` line 155 explicit |
| Sentinel HTML comments in README for grep | Add `<!-- audit-section -->` markers | Plain markdown `## Audit Log` heading | D-78 — release-check.sh does NOT grep README; sentinels would be cargo-cult |
| Cross-file SKILL heading parity check | New script to verify EN/ZH SKILL have same H2 set | PR review + AGENTS.md doctrine | Deferred (CONTEXT.md `<deferred>` line 166) — wait until parity drift actually happens before automating |

**Key insight:** Phase 26 is a documentation phase where the temptation is to over-engineer parity automation. The user's lock (D-78) is intentionally narrow — two grep checks against two specific failure modes (missing audit row, missing version section). Everything else relies on PR review + existing tooling (`docs:check`, `check-user-docs.ts`).

## Runtime State Inventory

> Phase 26 is a documentation phase with one minor code change (`--lang` flag). No data migration, no live-service config drift, no OS-registered state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 26 does not touch databases, `.dbcli/audit/*`, or `.dbcli/last-recovery.json`. Audit log runtime is feature-complete (Phase 21-25). | None |
| Live service config | None — no external services. `dbcli skill --install` writes to local filesystem only (claude/gemini/copilot/cursor/codex/windsurf platform dirs); existing installs of older SKILL.md will be flagged stale by `checkSkillUpdates()` (skill.ts:92-120) and re-installed by users running `dbcli skill --install` again — this is **existing behaviour**, not new. | None — user-initiated re-install handles it |
| OS-registered state | None — no Windows Task Scheduler / launchd / systemd / pm2 references in this phase. | None |
| Secrets / env vars | `DBCLI_LANG` (env var) is **explicitly NOT consumed** by `--lang` (D-73). No new env vars introduced. | None — verify by code review that `--lang` handler does not read `DBCLI_LANG` |
| Build artifacts / installed packages | `dist/cli.mjs` will be rebuilt by `release:check` step 6/8. **`SKILL.zh-TW.md` MUST be present in `assets/`** so it ships in the npm tarball — `package.json:37-43` `files: ["dist/", "assets/", ...]` is whole-directory inclusive, so adding `assets/SKILL.zh-TW.md` automatically ships. **Verify:** the dist-smoke test (tests/integration/dist-smoke.test.ts:49-56) only asserts on `SKILL.md` — it does NOT assert on `SKILL.zh-TW.md` presence in the tarball. Add a new dist-smoke assertion? See Open Question 1. | (1) Confirm `bun run build` after adding `SKILL.zh-TW.md` produces a dist that can find both files via `packageAssetPath()`. (2) Optionally extend `dist-smoke.test.ts` with a "skill --install --lang zh-TW writes ZH content" assertion. |

## Common Pitfalls

### Pitfall 1: `tests/integration/dist-smoke.test.ts` SKILL.md assertions

**What goes wrong:** Existing smoke test asserts `^---` (frontmatter) and `name: dbcli` are present in the output of `dbcli skill --output <file>`. If Phase 26 changes the frontmatter format or removes either marker, the smoke test fails — and it's release-blocking via `release-check.sh` step 7/8.
**Why it happens:** Phase 26 extends SKILL.md content but DOC-01 does not specify whether frontmatter changes. The `description:` field on SKILL.md:3 already lists triggers — adding "audit" as a trigger word is tempting.
**How to avoid:** Keep `name: dbcli` and the leading `---` frontmatter delimiter intact. If updating `description:` field, ensure it's still parseable as YAML and `name: dbcli` is still present.
**Warning signs:** `bun test tests/integration/dist-smoke.test.ts` failing after a SKILL.md edit.

### Pitfall 2: `tests/integration/i18n.test.ts:128-132` SKILL.md path assertion

**What goes wrong:** i18n test asserts the install message contains the path `/home/user/.claude/skills/dbcli/SKILL.md`. If Phase 26 changes `getInstallPath()` semantics (e.g., suffixing `.zh-TW` to the target filename), this test breaks.
**Why it happens:** D-74 explicitly says target filename remains `SKILL.md` regardless of source — but a planner unaware of this test could be tempted to use `SKILL.zh-TW.md` as target.
**How to avoid:** Keep `getInstallPath()` UNCHANGED. Only modify `skillCommand()` to read a different SOURCE file based on `options.lang`. Search for the literal string `SKILL.md` in `i18n.test.ts:128` before changing skill.ts.
**Warning signs:** `bun test tests/integration/i18n.test.ts` failure mentioning SKILL.md path.

### Pitfall 3: `tests/unit/commands/skill.test.ts:38-42` stdout content assertion

**What goes wrong:** Unit test asserts `logOutput` contains `# dbcli` and `Database CLI for AI agents` when `skillCommand({}, {})` is called with no flags. If Phase 26 changes the **default-language SKILL.md** main heading or tagline, the test fails.
**Why it happens:** EN SKILL.md is the default; planner extending the "Audit Log usage" section is safe, but if they replace the `# dbcli` heading they break this test.
**How to avoid:** Preserve EN SKILL.md lines 6-8 (`# dbcli\n\nDatabase CLI for AI agents...`). Add new content as new `## ` section, do not rewrite the heading.
**Warning signs:** `tests/unit/commands/skill.test.ts` test "prints SKILL.md to stdout by default" failing.

### Pitfall 4: Adding a new doc-key to `docs/user/*` breaks `bun run docs:check`

**What goes wrong:** `scripts/check-user-docs.ts:3-19` has a frozen array of 14 required doc-keys. Adding a new `<!-- doc-key: audit -->` to ONE file passes `assertSameOrder` (added everywhere) but creates a 15th key with no enforcement of its presence.
**Why it happens:** Misreading planner-discretion G as "audit deserves its own doc-key section."
**How to avoid:** G item (5) explicit — no standalone audit chapter. Add audit content INSIDE existing `diagnostics-recovery` (table row) and `ai-agent-integration` (bullet) doc-keys.
**Warning signs:** `bun run docs:check` failing OR a 15-key sentinel list appearing in any of the 4 files.

### Pitfall 5: `assets/SKILL.zh-TW.md` not appearing in packaged dist

**What goes wrong:** `package.json:37-43` `files: ["dist/", "assets/", "README.md", "CHANGELOG.md", "LICENSE"]` — Bun's `build` script (`scripts/build.ts`) controls what ends up in `dist/`. If the build script explicitly enumerates which assets to copy/embed (rather than copying whole `assets/` dir), `SKILL.zh-TW.md` may be missed.
**Why it happens:** Unknown without reading `scripts/build.ts`. `packageAssetPath()` returns `<root>/assets/SKILL.zh-TW.md` — for the file to resolve at runtime in dev, the file must exist in `assets/`. For packaged mode (npm install), the file must be present in the tarball (which `files:` controls — and `assets/` whole-directory inclusion means YES, it will ship).
**How to avoid:** Verify by `bun run build && ls -la dist/` after adding `SKILL.zh-TW.md`. Confirm `tests/integration/dist-smoke.test.ts` still passes. Optionally extend dist-smoke with an assertion for ZH file presence (see Open Question 1).
**Warning signs:** `dbcli skill --install --lang zh-TW` from outside dev tree raises `Skill source not found: <path>/assets/SKILL.zh-TW.md` (skill.ts:49-50 error pattern).

### Pitfall 6: `package.json` version still at 1.19.1 — D-78 grep will fail

**What goes wrong:** D-78 step 2: `node -p "require('./package.json').version"` returns `1.19.1` today. `grep -F "## [1.19.1]" CHANGELOG.md` returns a hit on existing v1.19.1 section, but it would falsely "pass" the doc-presence check before v1.20.0 content is added.
**Why it happens:** The check assumes `package.json` version is bumped to the **NEW** release version BEFORE running `release:check`. CONTRIBUTING.md:294 says "`package.json` 的 `version` 已 bump (透過 `npm version patch|minor|major`)" — this is part of the pre-release checklist.
**How to avoid:** **The version bump (1.19.1 → 1.20.0) MUST happen as a Phase 26 task** (probably plan C alongside the release-check.sh edit), and the CHANGELOG must have the `## [1.20.0]` heading BEFORE the doc-presence step runs. Sequence in plan C: (1) bump `package.json` version; (2) add `## [1.20.0]` section to CHANGELOG; (3) edit `release-check.sh` to add step 8/8; (4) run `bun run release:check` end-to-end to confirm.
**Warning signs:** `bun run release:check` step 8/8 fails with `Missing '## [1.20.0]' heading in CHANGELOG.md`.

### Pitfall 7: Backtick in grep pattern (`` | `audit` ``) needs careful escaping

**What goes wrong:** D-78 step 1 says grep for "rows beginning with `| `audit``". A backtick (`) inside a bash double-quoted string is interpreted as command substitution. Inside single-quotes it's literal. Inside `grep -E` patterns, backticks are literal characters — no escaping needed at the regex level.
**Why it happens:** Shell quoting confusion.
**How to avoid:** Use single-quoted grep pattern: `grep -qE '^\| `audit` ' docs/feature-matrix.md`. The pattern is anchored to line start `^`, escapes the pipe `\|` (NOT strictly needed in `-E` but harmless), then `` `audit` `` is literal (no shell interpolation inside single quotes), then a space delimiter.
**Verification:** Test against actual feature-matrix row format — line 39 shows `| \`recover\` | N/A | N/A | ...` (backtick-wrapped command name). Phase 26 row will be `| \`audit\` | N/A | N/A | ...`. The grep pattern `'^\| `audit` '` matches this.
**Warning signs:** Shell error `audit: command not found` (backtick treated as command sub) — caused by double-quotes around pattern. Use SINGLE quotes.

### Pitfall 8: `grep -F` vs `grep -E` for the CHANGELOG version pattern

**What goes wrong:** `## [1.20.0]` contains `[` and `]` which are regex metacharacters. With `grep -E` they'd start a character class. With `grep -F` (fixed string), they're literal.
**Why it happens:** Habitual use of `grep -qE`.
**How to avoid:** Use `grep -qF "## [${PKG_VERSION}]" CHANGELOG.md` — `-F` treats the pattern as a fixed string. Inside double-quotes the `${PKG_VERSION}` shell variable expands correctly.
**Warning signs:** Grep returning "no match" when the heading clearly exists (regex-interpreted as character class).

### Pitfall 9: Step number renumbering in release-check.sh

**What goes wrong:** Existing 7-step script has hardcoded `step '1/7 bun audit'`, `'2/7 prettier --check'`, ..., `'7/7 dist smoke'`. Adding a new step requires renumbering all 7 labels to `1/8`..`7/8` plus the new `8/8`.
**Why it happens:** Easy to miss one or two during sed.
**How to avoid:** Use a single `sed -i 's|/7 |/8 |g' scripts/release-check.sh` followed by appending the new step. Or write all 8 lines fresh.
**Warning signs:** Output mixing `5/7 test` and `8/8 doc-presence` — looks broken even if functionally correct.

### Pitfall 10: CHANGELOG already drifts from package.json — Phase 26 reset moment

**What goes wrong:** Today `package.json` = `1.19.1` and CHANGELOG.md:9 has `## [1.19.1] - 2026-05-14`. CONTRIBUTING.md:283 pre-release checklist says CHANGELOG must have the new version — this happens manually each release. Phase 26 is the moment to write v1.20.0's entry; if the version bump and CHANGELOG entry get out of sync (e.g., bumped package.json to 1.20.0 but forgot to add the CHANGELOG section), the new D-78 grep catches it.
**Why it happens:** Release-cycle muscle memory.
**How to avoid:** Plan C should explicitly include `## [1.20.0]` section creation AND `package.json` bump as paired steps.
**Warning signs:** D-78 step 2 grep failure — `Missing '## [1.20.0]' heading in CHANGELOG.md` — even after manual `npm version minor`.

### Pitfall 11: Translating technical terms in SKILL.zh-TW.md

**What goes wrong:** Over-translating breaks copy-paste workflow. If `dbcli audit tail --n 10 --for-agent` becomes `dbcli 稽核 末端 --筆數 10 --給代理`, agents (and humans) can't execute the commands.
**Why it happens:** Default translation instinct.
**How to avoid:** CONTEXT.md `<specifics>` line 155 explicit — "command names, file paths, JSON keys stay English." Only translate narrative paragraphs and "why use it" prose. Mirror README.zh-TW.md's existing tone (e.g., section heading is `dbcli skill` not `dbcli 技能`).
**Warning signs:** ZH SKILL.md containing translated command names that don't exist in CLI.

## Code Examples

Verified patterns from existing codebase (no external sources needed — this is an internal documentation phase).

### Example 1: Commander option with default value

```typescript
// Source: src/commands/skill.ts:210-227 (current implementation)
// Phase 26 adds a third .option() entry:
return program
  .command('skill')
  .description(t('skill.description'))
  .option('--install <platform>', 'Install to platform directory (...)')
  .option('--output <path>', 'Write skill to file instead of stdout')
  // NEW Phase 26 (D-73):
  .option('--lang <lang>', 'Source language: en (default) or zh-TW', 'en')
  .action(async (options: Record<string, unknown>) => { /* ... */ })
```

[VERIFIED: skill.ts:213-218 commander pattern; commander 13.0.0 supports the 3-arg `.option(flag, description, defaultValue)` signature]

### Example 2: Conditional source file selection

```typescript
// Source: src/commands/skill.ts:13-17 (current) + planned Phase 26 extension
import { packageAssetPath } from '@/utils/package-root'

// CURRENT:
const SKILL_SOURCE_PATH = packageAssetPath('SKILL.md')

// PHASE 26 — replace with helper inside skillCommand or precompute both:
function resolveSkillSource(lang: string): string {
  if (lang === 'zh-TW') {
    return packageAssetPath('SKILL.zh-TW.md')
  }
  return packageAssetPath('SKILL.md')
}

// Inside skillCommand:
async function skillCommand(_program: Command, options: SkillOptions): Promise<void> {
  const lang = options.lang ?? 'en'  // commander already supplies default, but defensive
  const skillSourcePath = resolveSkillSource(lang)
  const skillFile = Bun.file(skillSourcePath)
  if (!(await skillFile.exists())) {
    throw new Error(`Skill source not found: ${skillSourcePath}`)
  }
  // ... rest unchanged
}
```

The `SkillOptions` interface (skill.ts:19-22) gains `lang?: 'en' | 'zh-TW'`.

[VERIFIED: skill.ts:14, 19-22, 46-49 — file existence pattern]

### Example 3: Shell-only doc-presence step

```bash
# Source: planned addition to scripts/release-check.sh (after current line 27)
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

[VERIFIED via Pitfalls 7 + 8 above: single-quote pattern for backtick, `-F` for `[` literal match]

### Example 4: CHANGELOG version section skeleton (full draft)

See Pattern 3 above for the complete v1.20.0 draft. The skeleton follows v1.17.0 (CHANGELOG.md:48-86) Added/Changed/Internal structure, with v1.19.1 (CHANGELOG.md:9-26) Changed/Fixed/Tests as alternative layout reference.

### Example 5: README §Audit Log section skeleton

```markdown
<!-- After ## AI Integration Guide section (README.md:1253), before ## Troubleshooting (README.md:1256) -->

---

## Audit Log

> **Default ON since v1.20.0.** Existing projects will begin creating
> `.dbcli/audit/<connection>.jsonl` on first command after upgrading.
> Set `audit.enabled = false` in `.dbcli` to opt out.

Every command that touches a database writes a structured JSONL entry to
`.dbcli/audit/<connection>.jsonl`. Inspect the recent history with:

\`\`\`bash
dbcli audit tail --n 10                    # last 10 entries on current connection
dbcli audit tail --all --for-agent         # cross-connection JSON envelope
dbcli audit show <uuid-prefix>             # full entry by id prefix (>=4 chars)
dbcli audit show --recovery-ref <uuid>     # find entry that emitted a recovery envelope
dbcli audit health                         # writer state, rotation %, last write status
dbcli audit clear                          # erase audit log for current connection (prompts y/N)
\`\`\`

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
in v1.20.0; full coverage is tracked as Phase 23-04 follow-up.

For deeper agent workflows (session handoff, forensics walk-through), see
[`assets/SKILL.md`](./assets/SKILL.md) §Audit Log usage.

---
```

The ZH version (`README.zh-TW.md`) mirrors this structure with translated narrative; command names and paths stay English.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-language SKILL.md (English only) | Bilingual split-file (`SKILL.md` + `SKILL.zh-TW.md`) selected by `--lang` flag | This phase | ZH-reading agents/users can install native-language skill instructions |
| 7-step release-check.sh (no doc gates) | 8-step with grep-based doc-presence gate | This phase | CHANGELOG / feature-matrix drift caught at release time, not in production |
| `dbcli inspect` / `recover` output no audit context | Embed `audit_recent: AuditEntryBrief[]` in agent JSON | Phase 25 (shipped 2026-05-16) | Cross-session agent handoff has immediate context — documented in Phase 26 |
| Audit log absent | `.dbcli/audit/<conn>.jsonl` writes by default | Phase 21-25 (shipped) | Phase 26 documents the default-on D1 upgrade impact |

**Deprecated/outdated:**
- v1.10.0 SKILL.md note "audit logging deferred to post-v1.0" (still in CHANGELOG.md:726 as known limitation) — Phase 26 should add a Phase note to the v1.0.0 Known Limitations block noting it shipped in v1.20.0, or leave the historical block intact and rely on the v1.20.0 entry to communicate the change. Recommendation: leave historical entries immutable (Keep a Changelog convention) — readers can date-order.

## Assumptions Log

> Claims tagged `[ASSUMED]` that need user / planner confirmation. If empty, all claims are verified.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Planner-discretion F default (top-level `## Audit Log` between AI Integration Guide and Troubleshooting) is the best README placement | CONTEXT.md F, Pattern + Example 5 | Low — F is explicit "Claude's discretion"; planner can adjust without research changes |
| A2 | The new `--lang` flag does not need a new i18n key (commander's built-in `InvalidArgumentError` formatting is sufficient) | §Don't Hand-Roll row 1 | Low — if planner chooses `.choices(['en','zh-TW'])`, the error message is auto-generated and uniform; if they want a localized error, add `skill.invalid_lang` to both `resources/lang/{en,zh-TW}/messages.json` |
| A3 | `scripts/build.ts` whole-copies `assets/*` into dist tarball (verifying `SKILL.zh-TW.md` ships) | §Pitfall 5 | Medium — not directly verified by reading build.ts; planner should `bun run build` and `ls dist/` after adding the file. If build.ts enumerates files explicitly, add SKILL.zh-TW.md to its include list. |
| A4 | Phase 26 v1.20.0 release date will be the date the phase completes (used in `## [1.20.0] - <date>`) | CHANGELOG draft | Trivial — planner / user fills in actual release date during plan execution |

**Verification action for planner:** Before Plan A starts, read `scripts/build.ts` and confirm assumption A3. If build.ts uses explicit enumeration (rather than directory glob), Plan A must also update build.ts.

## Open Questions (RESOLVED)

1. **Should `tests/integration/dist-smoke.test.ts` gain a `--lang zh-TW` smoke assertion?**
   - What we know: Existing smoke covers `--output` writing default (EN) SKILL.md (line 49-56). It does not exercise `--install` or `--lang`. A new assertion `dbcli skill --output /tmp/skill-zh.md --lang zh-TW` followed by `expect(text).toMatch(/Audit Log 使用|繁體中文/)` would lock in ZH-source shipping in the tarball.
   - What's unclear: This is a value judgment — does Phase 26 want to extend dist-smoke (out of strict scope), or rely on PR review for ZH presence?
   - RESOLVED: Plan A Task A-4 adds the dist-smoke `--lang zh-TW` assertion. ~5-line cost; locks in ZH-source shipping in the tarball as a regression guard.

2. **Should the `--lang` flag also flow into `--output` mode (not just `--install`)?**
   - What we know: skill.ts:59-63 handles `--output`; current logic writes `skillMarkdown` (whichever was read). With Phase 26's source-file branch, `--output` would automatically respect `--lang` if `skillMarkdown` is computed from the chosen source.
   - What's unclear: D-73 mentions `--install` explicitly; `--output` is a separate code path. Should `dbcli skill --output ./my.md --lang zh-TW` write the ZH SKILL? (Logical YES.)
   - RESOLVED: Yes — Plan A `resolveSkillSource(lang)` runs upstream of both `--install` and `--output`, so `--lang` is a SOURCE selector independent of destination.

3. **Should v1.20.0 release date be put in CHANGELOG today or left as `<date>` placeholder?**
   - What we know: CONTRIBUTING.md:283 pre-release checklist treats version bump as the final pre-tag step. CHANGELOG conventions usually pin a date when the tag is cut.
   - What's unclear: Phase 26 release timing depends on when the user (Carl) cuts the tag.
   - RESOLVED: Plan C pins `## [1.20.0] - 2026-05-17` (today). User can manually edit the date when tagging if release slips to a different day.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | Test / build / lint / typecheck | ✓ | 1.3.10 | — |
| Node.js | `node -p` in release-check.sh (D-78) | ✓ | 22.17.1 | — |
| `grep` (POSIX) | `release-check.sh` doc-presence step | ✓ | macOS default (BSD grep) | GNU grep via Homebrew (already available) |
| `git` | Optional (commits) | ✓ | — | — |
| `bunx prettier` | Step 2/8 `release:check` | ✓ | 3.8.3 (devDep) | — |
| Network for `bun audit` | Step 1/8 | ✓ | — | If offline, `bun audit` may fail — skip with `--continue-on-error` only if explicitly required (NOT recommended) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None — all tooling is available.

## Validation Architecture

> Validation Architecture is included because Phase 26 has documentation-style requirements that map to existing test infrastructure + a new shell-grep gate. The phase is largely **non-runtime**, so most validation is "presence checks" rather than "behavior assertions."

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun-native, no separate framework). [VERIFIED: package.json:49 `"test": "bun test"`] |
| Config file | None — Bun test auto-discovers. Convention: `tests/**/*.test.ts`. |
| Quick run command | `bun test tests/unit/commands/skill.test.ts tests/integration/dist-smoke.test.ts tests/integration/i18n.test.ts` (the three SKILL-touching tests) |
| Full suite command | `bun run release:check` (8 steps after Phase 26 lands) — typecheck + lint + test + build + dist smoke + doc-presence |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOCS-01 | `dbcli skill` default still prints EN SKILL.md to stdout | unit | `bun test tests/unit/commands/skill.test.ts -t "prints SKILL.md to stdout by default"` | ✅ Existing |
| DOCS-01 | `dbcli skill --output <f>` writes EN SKILL.md | unit | `bun test tests/unit/commands/skill.test.ts -t "writes to custom output file"` | ✅ Existing |
| DOCS-01 | Invalid `--install` platform errors clearly | unit | `bun test tests/unit/commands/skill.test.ts -t "fails for unknown platform"` | ✅ Existing |
| DOCS-01 | `dbcli skill --output <f> --lang zh-TW` writes ZH SKILL | unit | `bun test tests/unit/commands/skill.test.ts -t "lang zh-TW"` (NEW) | ❌ Wave 0 — see below |
| DOCS-01 | Invalid `--lang` value rejected | unit | `bun test tests/unit/commands/skill.test.ts -t "lang invalid"` (NEW) | ❌ Wave 0 — see below |
| DOCS-01 | Packaged dist still has both SKILL.md and (optionally) SKILL.zh-TW.md accessible | integration | `bun test tests/integration/dist-smoke.test.ts` (extend with ZH assertion per Open Q1) | ✅ Existing (extension optional) |
| DOCS-03 | `docs/feature-matrix.md` has `audit` row | gate (shell grep) | `grep -qE '^\| \`audit\` ' docs/feature-matrix.md` (inside release-check.sh step 8/8) | ❌ Wave 0 — `release-check.sh` |
| DOCS-03 | `CHANGELOG.md` has `## [<package.json version>]` heading | gate (shell grep) | `grep -qF "## [$(node -p 'require(\"./package.json\").version')]" CHANGELOG.md` | ❌ Wave 0 — `release-check.sh` |
| DOCS-03 | Side-effect tiers table examples include audit subcommands | manual (PR review) | (no automated check — D-78 lock) | N/A |
| DOCS-04 | `README.md` + `README.zh-TW.md` have `## Audit Log` section | manual (PR review) | (no automated check) | N/A |
| DOCS-04 | `docs/user/{en,zh-TW}/index.{md,html}` parity preserved | automated (existing) | `bun run docs:check` | ✅ Existing |
| DOCS-04 | `CHANGELOG.md` has D1 upgrade-impact callout in v1.20.0 Changed | manual (PR review) | (covered indirectly by D-78 version heading grep) | N/A |
| DOCS-04 | Phase 23-04 known limitation present in CHANGELOG | manual (PR review) | (no automated check) | N/A |
| (overall) | Full release gate green | gate | `bun run release:check` | ✅ Existing (will become 8 steps) |

### Sampling Rate
- **Per task commit:** `bun test tests/unit/commands/skill.test.ts` (sub-second; covers DOCS-01 unit surface)
- **Per wave merge:** `bun run docs:check && bun test tests/integration/{dist-smoke,i18n}.test.ts` (~10s; covers parity + smoke)
- **Phase gate:** `bun run release:check` full 8-step green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/commands/skill.test.ts` — extend with `--lang zh-TW` write assertion + invalid-lang rejection (REQ DOCS-01). If planner chooses `.addOption(new Option().choices())`, the invalid-lang case is asserted via commander's stderr.
- [ ] `scripts/release-check.sh` — new step 8/8 grep gate (REQ DOCS-03). Pure shell; no framework setup.
- [ ] `package.json` version bump 1.19.1 → 1.20.0 — gating prerequisite for the D-78 grep (REQ DOCS-03 indirect).
- [ ] (optional) `tests/integration/dist-smoke.test.ts` — add ZH assertion if Open Q1 resolves YES.
- [ ] No `tests/conftest.py` or fixture files needed — this is a Bun/TypeScript project.
- [ ] No framework install needed — `bun:test` is built-in.

## Security Domain

> Phase 26 modifies docs + adds one CLI option + one shell grep gate. No new data flows, no auth surface, no crypto. Security-relevant items below address Phase 26's narrow surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth changes |
| V3 Session Management | no | No session changes |
| V4 Access Control | no | No permission/blacklist changes |
| V5 Input Validation | yes | `--lang` value validated via commander `.choices(['en','zh-TW'])` (don't hand-roll string switch) |
| V6 Cryptography | no | No new crypto |
| V7 Error Handling | yes | `Skill source not found` errors (skill.ts:49-50) already use English-only strings — Phase 26 adds a ZH path but should keep error messages routed through existing `t_vars('errors.message', ...)` (skill.ts:83) for i18n alignment |
| V8 Data Protection | no | SKILL.md content is public documentation; no PII/secrets at rest |
| V11 Business Logic | yes | D1 default-on changes audit log behavior — Phase 26's role is to **document the change**, not gate it; ensure the README/CHANGELOG callout is unmistakable |
| V14 Configuration | yes | `package.json` version bump must be consistent with CHANGELOG; D-78 grep enforces this contract |

### Known Threat Patterns for documentation + shell-grep gate

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal in `--lang` (e.g., `--lang ../../../etc/passwd`) | Tampering | Commander `.choices(['en','zh-TW'])` rejects anything outside the whitelist before `resolveSkillSource()` is called |
| CHANGELOG drift (release tags with no matching CHANGELOG section) | Repudiation / supply-chain | D-78 grep step 2 is the mitigation — release-check fails before tag is cut |
| Stale doc on agent → wrong workflow execution | Information disclosure (indirect) | AGENTS.md parity rule + PR review; `bun run docs:check` enforces md/html parity |
| Filesystem injection via SKILL.md content (e.g., embedded shell snippets) | Tampering | SKILL.md is markdown — `dbcli skill --install` writes file contents verbatim. No execution. Risk is purely **what the agent reads and chooses to run**, which is governed by dbcli's existing permission tiers / blacklist (not Phase 26 surface) |

## Project Constraints (from CLAUDE.md / AGENTS.md)

From `./AGENTS.md` (project root — applies to all PRs):
- **Bun-first stack:** Use `bun run src/cli.ts` not `node`; `bun test` not `jest`; `bunx` not `npx`. [VERIFIED: AGENTS.md lines 4-8]
- **`bun:sqlite` / `Bun.serve()` / `Bun.file` preference:** Not directly relevant to Phase 26 but applies if any test helpers are touched.
- **Documentation Mandate:** After feature changes, MUST update `docs/user/`. Multi-language parity (`docs/user/en/` + `docs/user/zh-TW/`) AND format parity (`index.md` + `index.html`). [VERIFIED: AGENTS.md "Development Lifecycle" section — directly governs Planner-discretion G]
- **dbcli usage discipline:** Before DB ops, run blacklist list → schema → operation. **N/A for Phase 26** — no DB operations occur in this phase.

From global `~/.claude/CLAUDE.md`:
- **Language policy:** Default Traditional Chinese (Taiwan); switch to English on explicit request. Phase 26 deliverables include English-major docs (SKILL.md, reference.md, CHANGELOG.md, README.md, feature-matrix.md) and ZH twins (SKILL.zh-TW.md, README.zh-TW.md, docs/user/zh-TW/*). **Conversational responses to user follow ZH-TW by default; document content follows the file's own language convention.**
- **Git commit format:** `<type>: [ <scope> ] <subject>` (e.g., `docs: [26] add bilingual SKILL audit log section`). [VERIFIED: ~/.claude/CLAUDE.md Git commit format]
- **No emojis in code/comments unless explicitly requested.**
- **No `pip` / no native installs for services / no commits unless user asks** — all standard.

## Sources

### Primary (HIGH confidence)
- `src/commands/skill.ts` (lines 1-228) — current skill command implementation [Code, read in this session]
- `src/utils/package-root.ts` — `packageAssetPath()` resolution [Code, read in this session]
- `src/adapters/capabilities.ts:111-122` — audit tier mapping (D-76 source-of-truth) [Code, read in this session]
- `scripts/release-check.sh` — 7-step shell pipeline [Code, read in this session]
- `scripts/check-user-docs.ts` — 14 required doc-keys + parity logic [Code, read in this session]
- `package.json` — current version, `files:` array, scripts [Code, read in this session]
- `tests/integration/dist-smoke.test.ts` — packaged-asset smoke expectations [Code, read in this session]
- `tests/unit/commands/skill.test.ts` — skillCommand unit assertions [Code, read in this session]
- `assets/SKILL.md` (393 lines) — current EN SKILL [Code, read in this session]
- `docs/feature-matrix.md` — feature matrix + side-effect tiers table [Code, read in this session]
- `CHANGELOG.md` — v1.10.0 / v1.17.0 / v1.19.0 / v1.19.1 entry precedents [Code, read in this session]
- `README.md` (lines 1145-1252 AI Integration; sections via `grep ^## `) — placement target for §Audit Log [Code, read in this session]
- `docs/user/en/index.md` (lines 140-202) — `diagnostics-recovery` + `ai-agent-integration` sections [Code, read in this session]
- `resources/lang/en/messages.json:96-126` — existing `audit.*` i18n namespace [Code, read in this session]
- `CONTRIBUTING.md:279-342` — Release Process + Pre-Release Checklist [Code, read in this session]
- `.planning/phases/24-audit-cli/24-CONTEXT.md` — audit CLI surface contracts [Read]
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md` — recovery linkage decisions [Read]
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` — Phase 23-04 6-unwired-command list [Read]
- `.planning/REQUIREMENTS.md` — DOCS-01/03/04 verbatim [Read]
- `.planning/ROADMAP.md` §Phase 26 — success criteria + dependencies [Read]
- `.planning/STATE.md` — D1-D6 lock state + Phase 25 J1 carry-forward [Read]
- `.planning/phases/26-docs-skill-release-gate/26-CONTEXT.md` — D-71..D-78 + Planner-discretion E/F/G [Read]

### Secondary (MEDIUM confidence)
- AGENTS.md — Bun stack + Documentation Mandate doctrine [Read, project root]
- ~/.claude/CLAUDE.md + rules — language policy, git format, agent rules [Read, user global]

### Tertiary (LOW confidence)
- None — this phase did not require external library docs (Context7) or web search. All authority comes from existing codebase + CONTEXT.md locks.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries (commander, Bun, node) verified by direct code inspection + version check on this machine
- Architecture: HIGH — patterns extracted from existing files (skill.ts, release-check.sh, README pattern, CHANGELOG precedents)
- Pitfalls: HIGH — each pitfall traced to a specific test file or behavior; no speculative warnings
- Test mapping: HIGH — every assertion mapped to a real test file at a real line range
- Open questions: HIGH-quality — three are genuine planner-decision points, not speculative gaps

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days — stable codebase, no fast-moving deps; bump if Bun / commander has a major release before then)
