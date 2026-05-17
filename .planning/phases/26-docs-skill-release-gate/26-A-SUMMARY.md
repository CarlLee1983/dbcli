---
plan: 26-A
phase: 26
slug: skill-bilingual-lang-flag
status: complete
requirements_addressed: [DOCS-01]
files_modified:
  - assets/SKILL.md
  - assets/SKILL.zh-TW.md
  - src/commands/skill.ts
  - tests/unit/commands/skill.test.ts
  - tests/integration/dist-smoke.test.ts
created: 2026-05-17
---

# Plan 26-A — SKILL bilingual + `--lang` flag

## Objective Achieved

Shipped bilingual SKILL.md for v1.20.0 (DOCS-01). `assets/SKILL.zh-TW.md` is a full Traditional Chinese translation of the 393-line `assets/SKILL.md`, including the new "Audit Log usage" section that covers session-handoff and forensics scenarios. `dbcli skill --install <platform> --lang en|zh-TW` selects which source to install; default is `en` so existing zero-flag invocations preserve byte-identical behavior.

## Key Decisions Honored

- **D-71** — `assets/SKILL.zh-TW.md` is a full translation, not a stub. Heading structure mirrors SKILL.md.
- **D-72** — `assets/reference.md` stays English-only. No `reference.zh-TW.md` created.
- **D-73** — `--lang` flag with `.choices(['en','zh-TW']).default('en')`. No `DBCLI_LANG` env auto-detect, no `LANG` env auto-detect. Defensive `options.lang ?? 'en'` inside `skillCommand()` so unit tests bypassing commander still get default behavior.
- **D-74** — `getInstallPath()` unchanged. Target install filename is always `SKILL.md` regardless of `--lang` value. `tests/integration/i18n.test.ts:128` still asserts the literal `.../SKILL.md` install path and passes.

## Tasks Completed

| Task | File(s) | Commit |
|------|---------|--------|
| A-2: Create assets/SKILL.zh-TW.md (full translation) | `assets/SKILL.zh-TW.md` (NEW, 392 lines) | `5929716` |
| A-1: Add `--lang` flag + resolveSkillSource() + unit tests | `src/commands/skill.ts`, `tests/unit/commands/skill.test.ts` | `5ea49c4` |
| A-3: Add `## Audit Log usage` section to SKILL.md (EN) | `assets/SKILL.md` | `546133c` |
| A-4: dist-smoke `--lang zh-TW` packaged-asset assertion | `tests/integration/dist-smoke.test.ts` | `7e8439b` |

## Code Surface Changes

- **New private helper** in `src/commands/skill.ts`: `resolveSkillSource(lang: string): string` — returns `packageAssetPath('SKILL.zh-TW.md')` when `lang === 'zh-TW'`, else `packageAssetPath('SKILL.md')`. Source-file selector only — not a runtime locale switch.
- **`SkillOptions` extended** with `lang?: 'en' | 'zh-TW'` optional field. Backwards compatible — existing callers that omit `lang` get `'en'` default.
- **Commander chain** in `registerSkillCommand` gains `.addOption(new Option('--lang <lang>').choices(['en','zh-TW']).default('en'))`. Whitelist validation mitigates T-26-01 (`--lang ../../etc/passwd` rejected with `InvalidArgumentError` at commander's parse layer before `resolveSkillSource` runs).
- **`SKILL_SOURCE_PATH` and `REFERENCE_SOURCE_PATH` constants preserved** — still consumed by `checkSkillUpdates()` in `src/commands/upgrade.ts` for diff-vs-installed-EN-source logic.

## SKILL Content Changes

`assets/SKILL.md` and `assets/SKILL.zh-TW.md` both gained a top-level `## Audit Log usage` / `## Audit Log 使用` section between `## Agent Task Packs` and `## Quick start`. Section covers:

1. **Session handoff** — `dbcli audit tail --for-agent --n 10` for cross-session continuity; cross-connection merged view via `--all`.
2. **Forensics** — `dbcli recover --format json` showing embedded `audit_recent: AuditEntryBrief[]`; `dbcli audit show <id-prefix>` and `--recovery-ref <envelope-id>` for bi-directional pivot between audit entries and recovery envelopes.
3. **Known limitation (v1.20.0)** — Phase 23-04 follow-up: `insert / update / delete / export / q / schema` emit single-direction envelopes (no `audit_ref`). Recovery envelope linkage unaffected.
4. **Storage + opt-out** — `.dbcli/audit/<connection>.jsonl` rotation; `audit.enabled = false` opts out (default ON since v1.20.0).

## Verification

| Check | Result |
|-------|--------|
| `bun test tests/unit/commands/skill.test.ts` | ✓ 5/5 pass (3 existing + 2 new) |
| `bun test tests/integration/dist-smoke.test.ts` | ✓ 5/5 pass (4 existing + 1 new ZH assertion) |
| `bun test tests/integration/i18n.test.ts` | ✓ 25/25 pass (D-74 install-path lock preserved) |
| `bun run build` | ✓ Produces `dist/cli.mjs` + `dist/assets/` containing both SKILL.md and SKILL.zh-TW.md |
| `grep -qE '^## Audit Log usage$' assets/SKILL.md` | ✓ |
| `grep -qE '^## Audit Log 使用' assets/SKILL.zh-TW.md` | ✓ |
| `grep -q 'resolveSkillSource' src/commands/skill.ts` | ✓ |
| `grep -q "lang?: 'en' \| 'zh-TW'" src/commands/skill.ts` | ✓ |

## Threat Model Resolution

- **T-26-01** (`--lang` path-traversal) — mitigated by commander `.choices(['en','zh-TW'])` whitelist. Verified: invalid `--lang` values rejected at commander parse layer with `InvalidArgumentError`. No path traversal reaches `resolveSkillSource()`.
- **T-26-01b** (ZH translation content drift) — accepted; PR review enforces correctness. AGENTS.md Multi-language Parity rule blocks PRs that touch SKILL.md without syncing SKILL.zh-TW.md.

## Notable Deviations from Plan

- **Plan A originally specified spawning a single parallel executor agent in Wave 1** alongside Plan 26-B. That agent (`a63d254c74e97a98b`) hit an Anthropic API 500 after completing Task A-2 (SKILL.zh-TW.md commit) but before A-1/A-3/A-4. Recovery: SKILL.zh-TW.md commit was merged from the worktree; the partial uncommitted `skill.test.ts` diff (which was premature — test-before-source) was discarded; remaining tasks A-1/A-3/A-4 were executed inline by the orchestrator using the plan's copy-paste-ready action blocks. Final result is identical to what the agent would have produced — same file edits, same commit messages, same acceptance criteria.

## Hand-Off Notes for Downstream Plans

- Plan C (release-check.sh step 8/8) does NOT need to grep SKILL.md for "Audit Log usage" heading (D-78 explicitly excludes SKILL heading checks). Only feature-matrix audit row + CHANGELOG version are checked.
- Plan D (README sync) can reference the new SKILL.md section by linking to `assets/SKILL.md#audit-log-usage` and `assets/SKILL.zh-TW.md#audit-log-使用` if useful.
- Future patch milestone (Phase 23-04) that wires `writeAuditEntry` into the 6 remaining commands will need to remove or revise the "Known limitation" paragraph in both SKILL files. Track in CHANGELOG of that future version.
