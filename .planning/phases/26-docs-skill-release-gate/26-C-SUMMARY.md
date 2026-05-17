---
phase: 26-docs-skill-release-gate
plan: C
subsystem: release-gate
tags: [release-gate, changelog, version, shell, audit-log, doc-presence]

# Dependency graph
requires:
  - phase: 26-docs-skill-release-gate
    plan: A
    provides: "Bilingual SKILL.md + --lang en|zh-TW flag (CHANGELOG mentions both)"
  - phase: 26-docs-skill-release-gate
    plan: B
    provides: "docs/feature-matrix.md audit row (grep target for step 8/8)"
provides:
  - "package.json version 1.20.0"
  - "CHANGELOG.md ## [1.20.0] - 2026-05-17 section (Added / Changed / Internal)"
  - "scripts/release-check.sh step 8/8 doc-presence (release-blocking shell-grep gate)"
  - "CONTRIBUTING.md §Release Process synced (8 steps, doc-presence bullet)"
  - "docs/feature-matrix.md §Required CI validation rewritten (8 shell steps)"
affects: [26-D-readme-user-docs-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-shell doc-presence gate: grep -qE '^| `audit` ' (regex w/ literal backticks in single-quotes) + grep -qF '## [${PKG_VERSION}]' (fixed-string for literal brackets)"
    - "Version interpolation via node -p require('./package.json').version (no shell-injection vector under grep -qF)"
    - "Release-check step renumbering done via Edit tool (one per line) instead of sed -i (Pitfall 9 mitigation)"

key-files:
  created: []
  modified:
    - "package.json — version 1.19.1 -> 1.20.0 (single-line edit)"
    - "CHANGELOG.md — new ## [1.20.0] - 2026-05-17 section inserted above ## [1.19.1] (29 lines added)"
    - "scripts/release-check.sh — renumber 1/7..7/7 -> 1/8..7/8 + append step 8/8 doc-presence (20 insertions, 7 deletions)"
    - "CONTRIBUTING.md — §Release Process 'four commands' -> 'All 8 steps'; Pre-Release Checklist gains 1 ZH bullet for step 8/8 (2 insertions, 1 deletion)"
    - "docs/feature-matrix.md — §Required CI validation block rewrite (4 commands -> 8 steps with #1/8..#8/8 annotations; 3 explanatory bullets updated)"

key-decisions:
  - "v1.20.0 release date pinned at 2026-05-17 (today's date when Plan C executed)"
  - "Step 8/8 placement: AFTER 7/8 dist smoke (Option A from RESEARCH §Pattern 4 — ship-readiness check, not code-quality check)"
  - "grep -qF for CHANGELOG version pattern (literal [ ] brackets per Pitfall 8); grep -qE for feature-matrix audit row (regex anchoring with literal backticks via single-quotes per Pitfall 7)"
  - "D-77 honored: step 8/8 is pure shell (~50ms), NOT a bun test invocation"
  - "D-78 honored: exactly 2 grep targets (feature-matrix audit row + CHANGELOG ## [<version>] heading); SKILL/sentinels deliberately excluded"
  - "Discretion E honored: Phase 23-04 known-limitation cites 25-J1-COVERAGE-MATRIX.md verbatim and enumerates all 6 unwired commands (insert / update / delete / export / q / schema)"
  - "Discretion F item 2 honored: ### Changed block uses verbatim '**Default-on, upgrade impact:**' prefix"

requirements-completed: [DOCS-03, DOCS-04]

# Metrics
duration: 7min
completed: 2026-05-17
---

# Phase 26 Plan C: Release Gate Activation Summary

**Activated the v1.20.0 release gate: bumped `package.json` from 1.19.1 to 1.20.0, wrote the v1.20.0 CHANGELOG section (with the D1 default-on upgrade-impact callout and the Phase 23-04 known-limitation citing `25-J1-COVERAGE-MATRIX.md`), added a release-blocking `8/8 doc-presence` shell-grep step to `scripts/release-check.sh`, and synced CONTRIBUTING.md + docs/feature-matrix.md to reflect the new 8-step layout. End-to-end `bun run release:check` runs green (2441 pass / 3 skip / 0 fail; final doc-presence step prints both `feature-matrix has audit row` and `CHANGELOG.md has ## [1.20.0] heading`).**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-17T13:59:00Z
- **Completed:** 2026-05-17T14:06:27Z
- **Tasks:** 5 / 5
- **Files modified:** 5
- **Commits:** 4 task commits (C-5 is verification-only, no file changes)

## Accomplishments

- **Version bump (C-1):** Single-line edit of `package.json` version field from `1.19.1` to `1.20.0`. No other field touched. `git diff package.json` shows exactly one insertion / one deletion. `bun.lock` does not track project version (only the `name` field) — no lockfile regen needed.
- **CHANGELOG section (C-2):** New `## [1.20.0] - 2026-05-17` section inserted immediately above `## [1.19.1] - 2026-05-14`, preserving Keep a Changelog newest-at-top convention. Section contains:
  - **### Added** — 10 bullets covering audit writer + 4 audit subcommands + recovery linkage + `audit_recent` embed in `inspect / guide / recover` + `--lang en|zh-TW` flag + ZH SKILL + reference.md `### audit` block + feature-matrix audit row + step 8/8 doc-presence step itself
  - **### Changed** — 3 bullets: the D1 `**Default-on, upgrade impact:**` callout, the additive `audit_recent` field disclosure, and the Phase 23-04 known-limitation citing `25-J1-COVERAGE-MATRIX.md` and enumerating all 6 unwired commands
  - **### Internal** — 4 bullets covering new `src/core/audit/` modules, new contract tests, the 7→8 step renumbering, and the `resolveSkillSource()` selector
- **release-check step 8/8 (C-3):** Renumbered all 7 existing step labels from `N/7` to `N/8` using 7 individual Edit tool invocations (Pitfall 9 mitigation: sed would silently miss one). Appended new `8/8 doc-presence` block: reads `PKG_VERSION` via `node -p require('./package.json').version`, then runs two greps:
  - `grep -qE '^\| \`audit\` ' docs/feature-matrix.md` (regex with literal backticks via single-quoted pattern — Pitfall 7)
  - `grep -qF "## [${PKG_VERSION}]" CHANGELOG.md` (fixed-string match because `[` `]` are regex metacharacters — Pitfall 8)
  - On miss, both branches print descriptive `✗` message to stderr and `exit 1`
  - On hit, both print `✓` confirmation to stdout
- **CONTRIBUTING + feature-matrix sync (C-4):** CONTRIBUTING.md line 281 updated from "The same four commands run in CI" to "All 8 steps (encoded in `scripts/release-check.sh`) run in CI"; Pre-Release Checklist gains one ZH-styled bullet documenting step 8/8 doc-presence. docs/feature-matrix.md §Required CI validation block rewritten from a 4-command bash fence to an 8-command bash fence with `# 1/8` .. `# 8/8` inline annotations, plus explanatory bullets for step 4/8 (lint), 7/8 (dist smoke + SKILL.zh-TW.md packaging), and 8/8 (doc-presence gate).
- **End-to-end release gate green (C-5):** `bun run release:check` ran all 8 steps with zero failures. Final step 8/8 output: `✓ feature-matrix has audit row` + `✓ CHANGELOG.md has ## [1.20.0] heading` + `✓ release:check passed`. T-26-02 mitigation is now live: any future drift between `package.json` version, the `## [<version>]` CHANGELOG heading, or the feature-matrix `audit` row will fail the release gate before tagging.

## Task Commits

Each task was committed atomically with conventional-commit format:

| Task | Name | Type | Commit | Files |
|------|------|------|--------|-------|
| C-1 | Bump package.json 1.19.1 → 1.20.0 | chore | `7b8d616` | `package.json` |
| C-2 | Add `## [1.20.0]` CHANGELOG section | docs | `16e1ec0` | `CHANGELOG.md` |
| C-3 | Add release-check step 8/8 doc-presence | feat | `9d71469` | `scripts/release-check.sh` |
| C-4 | Sync CONTRIBUTING + feature-matrix CI validation | docs | `aae1c61` | `CONTRIBUTING.md`, `docs/feature-matrix.md` |
| C-5 | Run `bun run release:check` end-to-end | (verify-only) | — | none — verification gate, no commit |

## Files Created/Modified

- `package.json` — version field bumped from `1.19.1` to `1.20.0`. No other field modified.
- `CHANGELOG.md` — new `## [1.20.0] - 2026-05-17` section above `## [1.19.1]`. Historical entries untouched (Keep a Changelog convention honored).
- `scripts/release-check.sh` — 7 step labels renumbered `N/7` → `N/8`; new step `8/8 doc-presence` appended between `7/8 dist smoke` and the final `✓ release:check passed` printf. Shebang, `set -euo pipefail`, `cd "$(dirname "$0")/.."`, and `step()` helper preserved exactly.
- `CONTRIBUTING.md` — §Release Process intro wording updated to "All 8 steps (encoded in `scripts/release-check.sh`)"; Pre-Release Checklist gains 1 new bullet (ZH-mixed style consistent with existing bullets) documenting step 8/8 doc-presence. No other content modified.
- `docs/feature-matrix.md` — §Required CI validation block rewrite (4-command → 8-step layout with `# 1/8` .. `# 8/8` annotations). Engine capability table (lines 14-41 incl. Plan B's `audit` row at line 41) and Side-effect tiers table (lines 47-54) untouched. Anchor `#required-ci-validation` preserved so cross-references from CONTRIBUTING.md and STATE.md continue to resolve.

## Decisions Made

1. **v1.20.0 release date pinned at 2026-05-17:** Today's date when Plan C executed (per `<env>` block + locked decision in PLAN.md). The release-check.sh step 8/8 greps for `## [${PKG_VERSION}]` (heading-only, not the date), so editing the date on the actual tag day remains safe — no gate breakage.
2. **Step 8/8 placement after step 7/8 dist smoke:** Option A from RESEARCH §Pattern 4 — doc-presence is a ship-readiness check (do we have docs for what we're shipping?), not a code-quality check (is the code well-formed?). It belongs at the end of the chain so faster failing steps (audit, prettier, typecheck, lint) surface first. ~50ms cost makes placement decision moot for timing; ordering is purely semantic.
3. **`grep -qF` for CHANGELOG vs `grep -qE` for feature-matrix:** Pitfall 8 (literal `[` `]` brackets in `## [1.20.0]`) requires fixed-string matching. Pitfall 7 (literal backticks around `audit` in `| \`audit\` ` row) requires single-quoted regex pattern to bypass shell command substitution. These two gotchas drove the asymmetric grep flag choice — both work correctly.
4. **D-77 honored — pure shell, NOT `bun test`:** Step 8/8 is a 6-line shell snippet, not a TypeScript test file. Rationale (per D-77): (a) consistent with `--max-warnings=0` release-blocking precedent at the shell layer, (b) ~50ms vs `bun test`'s ~3s startup overhead, (c) doc-drift is a "forgot to update" class defect that shell grep catches reliably.
5. **D-78 honored — exactly 2 grep targets:** feature-matrix audit row + CHANGELOG `## [<version>]` heading. Deliberately did NOT grep SKILL.md or SKILL.zh-TW.md headings (those are guarded by AGENTS.md Multi-language Parity rule + PR review per Plan A handoff). Sentinel markers were also rejected as cargo-cult.
6. **Discretion E (Phase 23-04 partial-coverage disclosure):** Included verbatim per locked decision. Cites `25-J1-COVERAGE-MATRIX.md` and lists all 6 unwired commands explicitly (`insert / update / delete / export / q / schema`). This is honesty over silence — STATE.md + 25-J1-COVERAGE-MATRIX.md already track this as known backlog, and CHANGELOG disclosure prevents upgraders from filing this as a silent bug.
7. **Discretion F item 2 (D1 callout):** CHANGELOG `### Changed` block leads with the verbatim `**Default-on, upgrade impact:**` prefix. This is the exact string future maintainers + humans use to grep CHANGELOG for default-on impact notices.

## Deviations from Plan

**None — Plan C executed exactly as written.** Every task's `<action>` block was copy-paste ready; every `<verify>` automated check passed on first run; every `<done>` criterion was met. No Rule 1/2/3 auto-fixes were needed; no Rule 4 architectural decisions surfaced; no auth gates encountered.

The 5 tasks landed in their planned order (C-1 → C-2 → C-3 → C-4 → C-5), with C-1 (version bump) deliberately ahead of C-3 (step 8/8 reads version via `node -p`) and C-2 (CHANGELOG heading) ahead of C-5 (full release-check runs the heading grep).

## Auto-fixes / Authentication Gates / Architectural Decisions

- **Rule 1 (bugs):** None encountered.
- **Rule 2 (missing critical):** None encountered. Plan B already added the feature-matrix audit row that step 8/8 greps; Plan A already added the bilingual SKILL surface that CHANGELOG references; no critical gaps surfaced.
- **Rule 3 (blocking):** None encountered. All 5 files modified existed; no dependency or build setup needed.
- **Rule 4 (architectural):** None — Plan C is pure documentation + shell-script delta on top of already-shipped v1.20.0 audit code from Phases 21-25.
- **Auth gates:** None — no external service interaction in this plan.

## Issues Encountered

- **Hook reminder noise on every Edit:** A `PreToolUse:Edit` hook fires a "READ-BEFORE-EDIT REMINDER" system message before every Edit invocation, even when the file was Read earlier in the same session. All edits succeeded on retry / first call (the hook is informational, not blocking); only a "Fact-Forcing Gate" hook actually rejects the first edit per file, requiring a brief fact-presentation message before retrying. Net cost: ~5 fact-presentation rounds during this plan. No data lost; no commits affected.

## User Setup Required

None — documentation, version, and shell-script changes only. No external service configuration, no environment variables, no migrations.

## Verification

Final acceptance check (all PASS):

```text
- package.json version: 1.20.0 (exact string match)
- CHANGELOG.md has '## [1.20.0]' heading: ✓
- CHANGELOG.md has '**Default-on, upgrade impact:**' callout: ✓
- CHANGELOG.md cites '25-J1-COVERAGE-MATRIX' verbatim: ✓
- CHANGELOG.md lists 'insert / update / delete / export / q / schema' verbatim: ✓
- CHANGELOG.md mentions 'audit_recent': ✓
- CHANGELOG.md mentions '`--lang en|zh-TW`': ✓
- release-check.sh has "step '8/8 doc-presence'": ✓
- release-check.sh uses grep -qF (for CHANGELOG): ✓
- release-check.sh has zero N/7 step labels remaining: ✓
- CONTRIBUTING.md '第 8/8 步 doc-presence' bullet: ✓
- CONTRIBUTING.md 'All 8 steps' wording: ✓
- docs/feature-matrix.md 'release gate is 8 shell steps': ✓
- docs/feature-matrix.md '8/8 doc-presence' annotation: ✓
- docs/feature-matrix.md 'four commands' removed: ✓
- CONTRIBUTING.md 'four commands' removed: ✓

End-to-end `bun run release:check` exit code: 0
  - 1/8 bun audit: pass
  - 2/8 prettier --check: pass
  - 3/8 typecheck: pass
  - 4/8 lint: pass
  - 5/8 test: 2441 pass / 3 skip / 0 fail
  - 6/8 build: bundled 328 modules + UI template
  - 7/8 dist smoke: 5/5 pass
  - 8/8 doc-presence: feature-matrix ✓, CHANGELOG ✓
```

T-26-02 mitigation is verified live: the gate runs locally and would catch any future drift between `package.json` version and CHANGELOG heading, or any future removal of the feature-matrix `audit` row.

## Self-Check: PASSED

Files verified:

- `package.json` — FOUND (version = `1.20.0`)
- `CHANGELOG.md` — FOUND (modified, `## [1.20.0]` heading at top)
- `scripts/release-check.sh` — FOUND (modified, 8 step labels + step 8/8 block present)
- `CONTRIBUTING.md` — FOUND (modified, 8-step wording + ZH bullet)
- `docs/feature-matrix.md` — FOUND (modified, 8-step CI validation block)
- `.planning/phases/26-docs-skill-release-gate/26-C-SUMMARY.md` — FOUND (this file)

Commits verified:

- `7b8d616` — FOUND (`chore(26-C): bump version 1.19.1 -> 1.20.0`)
- `16e1ec0` — FOUND (`docs(26-C): add v1.20.0 CHANGELOG section ...`)
- `9d71469` — FOUND (`feat(26-C): add release-check step 8/8 doc-presence ...`)
- `aae1c61` — FOUND (`docs(26-C): sync CONTRIBUTING + feature-matrix CI validation block ...`)

End-to-end gate verified:

- `bun run release:check` — exits 0 with `✓ release:check passed` printed

## Next Phase Readiness

- **Plan 26-D (README + user docs sync):** Ready. CHANGELOG `## [1.20.0]` section is the canonical content source that Plan D's README + `docs/user/{en,zh-TW}/index.{md,html}` updates will mirror per AGENTS.md parity rules. The release gate is now live, so any future README edit that omits an audit-log mention will not affect the gate (D-78 deliberately scopes the gate to feature-matrix + CHANGELOG, not README).
- **Tag-day workflow:** `bun run release:check` is now release-blocking. The maintainer runs it before `npm version <bump>` and `git tag v1.20.0`. The CHANGELOG date (`2026-05-17`) can be edited on the actual tag day without breaking the gate (only the version heading is greppable, not the date).
- **Phase 23-04 follow-up:** Tracked publicly via the CHANGELOG `### Changed` known-limitation entry; no action required from Phase 26. When the patch milestone wires `writeAuditEntry` into the 6 remaining commands, that future CHANGELOG entry should remove or update the known-limitation paragraph.

---
*Phase: 26-docs-skill-release-gate*
*Plan: C*
*Completed: 2026-05-17*
