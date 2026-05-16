---
phase: 26
slug: docs-skill-release-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (existing) + shell-level `bun run release:check` |
| **Config file** | none — phase reuses existing infrastructure |
| **Quick run command** | `bun test tests/integration/dist-smoke.test.ts` |
| **Full suite command** | `bun run release:check` |
| **Estimated runtime** | ~120 seconds full suite; ~5 seconds quick |

---

## Sampling Rate

- **After every task commit:** Run quick smoke (`bun test tests/integration/dist-smoke.test.ts`) when SKILL/asset paths change; otherwise no quick test required (docs-only edits)
- **After every plan wave:** Run `bun test` (full unit + integration) when commander surface changed; skip for pure markdown edits
- **Before `$gsd-verify-work`:** Full `bun run release:check` MUST be green (typecheck / prettier --check / lint --max-warnings=0 / bun test / build / dist smoke / **NEW step 8/8 doc-presence**)
- **Max feedback latency:** 5 seconds for quick smoke; 120 seconds for full release:check

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Threat Ref | Secure Behavior                                                                | Test Type        | Automated Command                                                                                                | File Exists | Status     |
| -------- | ---- | ---- | ----------- | ---------- | ------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| 26-A-01  | A    | 1    | DOCS-01     | —          | SKILL.zh-TW.md mirrors SKILL.md heading structure                              | manual           | `diff <(grep '^##' assets/SKILL.md) <(grep '^##' assets/SKILL.zh-TW.md)`                                          | ✅          | ⬜ pending |
| 26-A-02  | A    | 1    | DOCS-01     | T-26-01    | `--lang zh-TW` flag installs SKILL.zh-TW.md content as target SKILL.md         | integration      | `bun test tests/integration/dist-smoke.test.ts` (extended)                                                       | ❌ W0       | ⬜ pending |
| 26-A-03  | A    | 1    | DOCS-01     | —          | `dbcli skill --install <platform> --lang <invalid>` rejects                    | unit             | `bun test tests/unit/commands/skill.test.ts` (extended)                                                          | ❌ W0       | ⬜ pending |
| 26-B-01  | B    | 1    | DOCS-03     | —          | feature-matrix.md contains single `audit` row                                  | unit/grep        | `grep -cE '^\| \`audit\`' docs/feature-matrix.md` returns ≥ 1                                                    | ✅          | ⬜ pending |
| 26-B-02  | B    | 1    | DOCS-03     | —          | Side-effect tiers table includes `audit tail` (readonly) + `audit clear` (local-write) | unit/grep | `grep 'audit tail' docs/feature-matrix.md && grep 'audit clear' docs/feature-matrix.md`                          | ✅          | ⬜ pending |
| 26-C-01  | C    | 2    | DOCS-03     | T-26-02    | `release-check.sh` includes step 8/8 doc-presence                              | integration      | `bash scripts/release-check.sh` exits 0 after Plan C ships                                                       | ✅          | ⬜ pending |
| 26-C-02  | C    | 2    | DOCS-04     | —          | CHANGELOG.md has `## [1.20.0]` heading                                         | unit/grep        | `grep -q '^## \[1.20.0\]' CHANGELOG.md`                                                                          | ✅          | ⬜ pending |
| 26-C-03  | C    | 2    | DOCS-04     | —          | package.json bumped to 1.20.0                                                  | unit/grep        | `node -p "require('./package.json').version"` returns `1.20.0`                                                   | ✅          | ⬜ pending |
| 26-C-04  | C    | 2    | DOCS-04     | —          | CHANGELOG v1.20.0 entry references 25-J1-COVERAGE-MATRIX.md                    | manual           | `grep '25-J1-COVERAGE-MATRIX' CHANGELOG.md`                                                                      | ✅          | ⬜ pending |
| 26-D-01  | D    | 3    | DOCS-04     | —          | README.md has top-level `## Audit Log` section                                 | unit/grep        | `grep -q '^## Audit Log' README.md`                                                                              | ✅          | ⬜ pending |
| 26-D-02  | D    | 3    | DOCS-04     | —          | README.zh-TW.md has matching `## Audit Log` section + D1 opt-out instruction   | unit/grep        | `grep -q '^## Audit Log' README.zh-TW.md && grep -q 'audit.enabled.*false' README.zh-TW.md`                      | ✅          | ⬜ pending |
| 26-D-03  | D    | 3    | DOCS-04     | —          | docs/user/en/index.md adds `audit` row in Health, Diagnostics & Recovery table | unit/grep        | `awk '/Health, Diagnostics/{f=1} f' docs/user/en/index.md \| grep -q '\`audit\`'`                                | ✅          | ⬜ pending |
| 26-D-04  | D    | 3    | DOCS-04     | —          | All 4 docs/user/* files mention `audit` (md+html × en+zh-TW)                   | unit/grep        | `grep -l '\`audit\`' docs/user/{en,zh-TW}/index.{md,html} \| wc -l` returns `4`                                  | ✅          | ⬜ pending |
| 26-D-05  | D    | 3    | —           | —          | `scripts/check-user-docs.ts` parity check still green                          | integration      | `bun run docs:check` exits 0                                                                                     | ✅          | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Threat refs (T-26-01, T-26-02) are placeholders — populated by planner per phase-26 threat model.*

---

## Wave 0 Requirements

- [ ] `tests/integration/dist-smoke.test.ts` — extend existing test to cover `dbcli skill --install <platform> --lang zh-TW` path; assert target `SKILL.md` content matches `assets/SKILL.zh-TW.md` source
- [ ] `tests/unit/commands/skill.test.ts` — extend to cover `--lang` flag validation (invalid lang → exit code 1; `--lang en` and `--lang zh-TW` succeed)

*Both are extensions of existing tests — no new framework or config file required.*

---

## Manual-Only Verifications

| Behavior                                                                                              | Requirement                  | Why Manual                                  | Test Instructions                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SKILL.zh-TW.md narrative content is correct Traditional Chinese                                       | DOCS-01                      | Translation quality cannot be automated     | PR review by Chinese-reading maintainer; spot-check against SKILL.md sections                       |
| README D1 upgrade-impact blockquote tone is "calm fact, not alarm"                                    | DOCS-04 (specifics)          | Subjective tone judgment                    | PR review against CONTEXT.md §«Specific Ideas» tone guidance                                       |
| Phase 23-04 known-limitation entry in CHANGELOG is honest and complete                                | DOCS-04 + Planner Discretion E | Honesty review — must list all 6 unwired commands | PR review against `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` |
| docs/feature-matrix.md `audit` row Notes column accurately reflects 4 subcommands + tiers             | DOCS-03                      | Content accuracy beyond grep                | PR review against `src/adapters/capabilities.ts` audit entries                                     |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (2 test extensions)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (release:check full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
