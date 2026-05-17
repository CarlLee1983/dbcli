---
phase: 26-docs-skill-release-gate
plan: B
subsystem: docs
tags: [docs, feature-matrix, reference, audit-log, capabilities, release-gate]

# Dependency graph
requires:
  - phase: 21-audit-writer-foundation
    provides: ".dbcli/audit/<conn>.jsonl writer + audit.enabled config (D1)"
  - phase: 22-entry-schema-redaction-contract
    provides: "Entry schema + redaction contract (D3)"
  - phase: 24-audit-cli
    provides: "audit tail/show/clear/health CLI surface (D-31..D-46) — flag contract documented here"
  - phase: 25-recovery-envelope-bi-directional-linkage
    provides: "recovery_ref / audit_ref linkage; audit_recent embed in inspect/guide/recover"
provides:
  - "docs/feature-matrix.md audit row (engine-independent N/A across 6 engines)"
  - "Side-effect tiers Examples updated: audit tail/show/health in readonly; audit clear in local-write"
  - "assets/reference.md ### audit subcommand block (EN-only) — 4 subcommands fully documented"
  - "Grep target ready for D-78 release-check.sh step 8/8 (^| `audit` ')"
affects: [26-C-release-gate-changelog-version, 26-D-readme-user-docs-sync]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doc-presence grep target: `^\\| `audit` ` matches feature-matrix row (D-78)"
    - "Tier-string SoT alignment: feature-matrix Notes + reference.md tier columns mirror src/adapters/capabilities.ts:111-122 verbatim (D-76)"
    - "Audit row precedent: cross-engine local capabilities use N/A-across-engines layout (recover/skill/audit cluster)"

key-files:
  created: []
  modified:
    - "docs/feature-matrix.md — new audit row + tier examples appended"
    - "assets/reference.md — new ### audit section (87 lines) at line 790, between ### recover and ### doctor"

key-decisions:
  - "Audit row placed immediately after skill row (engine-independent N/A cluster) per D-75"
  - "reference.md `### audit` placed AFTER `### recover` (not before) — reference.md is organized topically, not alphabetically; recovery → recover → audit → doctor is the natural diagnostic/observability cluster"
  - "Tier `audit clear` = `local-write` (NOT `interactive`) — interactive confirm is a commander-layer prompt, not a side-effect tier (D-76)"
  - "No reference.zh-TW.md created — D-72 lock honored (reference.md is EN-only in v1.20.0)"

patterns-established:
  - "Pattern: Documenting engine-independent CLI capabilities uses N/A across all 6 engines + Notes-column subcommand+tier breakdown"
  - "Pattern: Reference.md subcommand container blocks use #### Subcommands summary table, then per-subcommand flag tables, then #### Boundaries / #### Exit codes / **Permission:** footer (mirrors ### recover layout)"

requirements-completed: [DOCS-03]

# Metrics
duration: 6min
completed: 2026-05-16
---

# Phase 26 Plan B: Feature-Matrix Audit Row + Reference `### audit` Section Summary

**Documentation surface for the audit CLI: feature-matrix gets engine-independent audit row + tier examples; reference.md gets a 4-subcommand `### audit` block (EN-only) mirroring the Phase 24 D-31..D-46 contract.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-16T17:54:49Z
- **Completed:** 2026-05-16T18:00:03Z
- **Tasks:** 2 / 2
- **Files modified:** 2

## Accomplishments

- Added single `audit` row to `docs/feature-matrix.md` engine matrix (N/A across 6 engines, following `recover` / `skill` precedent) — D-75 satisfied.
- Updated Side-effect tiers Examples column: appended `audit tail` / `audit show` / `audit health` to `readonly` row and `audit clear` to `local-write` row — D-76 satisfied; `audit clear` deliberately NOT in `interactive` tier (commander-layer prompt is not a side-effect class).
- Inserted comprehensive `### audit` block (87 lines) in `assets/reference.md` documenting all 4 subcommands (`tail` / `show` / `clear` / `health`), each with its own flag table, plus Subcommands summary, Boundaries (including Phase 23-04 follow-up disclosure), and Exit codes — D-72 honored (no ZH twin created).
- Grep target `^\| \`audit\` ` is live for D-78 release-check.sh step 8/8 doc-presence check (verified end-to-end with the exact regex Plan C will install).

## Task Commits

Each task was committed atomically:

1. **Task B-1: Add `audit` row + Side-effect tiers examples to `docs/feature-matrix.md`** — `3798842` (docs)
2. **Task B-2: Add `### audit` subcommand block to `assets/reference.md`** — `8c9bcfc` (docs)

_No final metadata commit yet — orchestrator owns STATE.md/ROADMAP.md writes after all worktree agents in the wave complete (per parallel_execution context)._

## Files Created/Modified

- `docs/feature-matrix.md` — Added 1 new row (line 41, immediately after `skill`); appended audit examples to 2 existing tier rows (readonly, local-write); no other content touched. Required CI validation block (lines 55-71) intentionally left for Plan C.
- `assets/reference.md` — Added new `### audit` block (lines 790-876) between `### recover` (631) and `### doctor` (877). EN-only. No new file created.

## Decisions Made

1. **Audit row placement (feature-matrix.md):** Immediately after `| \`skill\` |` row (line 40 → new row at line 41). Rationale: engine-independent N/A cluster is `completion` / `upgrade` / `recover` / `skill` / `audit` — the new row joins the bottom of that group and matches reader expectations (recover/skill precedent).
2. **`### audit` placement in reference.md (TOPICAL choice):** Inserted AFTER `### recover` (line 631-788) and BEFORE `### doctor` (now line 877). The plan task suggested "before `### recover`" with alphabetical reasoning, but a heading-listing scan (`grep -n '^### ' assets/reference.md`) confirms reference.md is organized topically (`init / use / list / schema / query / plan / q / queries / insert / update / delete / export / blacklist / check / diff / status / inspect / report / guide / recovery / recover / doctor / completion / upgrade / shell / migrate / skill / ...`) — NOT alphabetical. The diagnostic/observability cluster `recovery → recover → audit → doctor` is the natural placement: the bi-directional `recovery_ref` / `audit_ref` linkage from Phase 25 J1 makes recover↔audit structurally adjacent. Documented per the plan's discretionary guidance: "If reference.md is grouped topically rather than alphabetically, place `### audit` next to other read/diagnostic subcommands."
3. **`audit clear` tier = `local-write` (not `interactive`):** D-76 lock. Interactive confirmation in `audit clear` is a commander-layer prompt; the tier represents the side-effect class on local filesystem vs DB. `audit clear` removes `.dbcli/audit/<conn>.jsonl` + `.jsonl.1` — that is `local-write` by definition.
4. **No `reference.zh-TW.md` created:** D-72 lock honored. Verified absence with `[ ! -f assets/reference.zh-TW.md ]` (passes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reference.md `### audit` block: `audit tail --n` default flag value corrected from `20` to `10`**

- **Found during:** Task B-2 (cross-checking Phase 24 D-31..D-46 contract before insertion)
- **Issue:** The PLAN.md template at line 209 documents `Default: 20` for `--n`, but Phase 24 D-41 + K (planner-discretion locked) say `--n` default is `10` ("對齊 ROADMAP success criterion 1 範例 `--n 10`"). PLAN.md's own hard constraint at line 274 instructs: "If Phase 24 contract differs from what's documented here for a flag default or behavior, REPORT in SUMMARY (planner-error route) — do NOT silently adjust." I followed the hard constraint by aligning to the Phase 24 SoT and reporting here.
- **Fix:** Wrote `Default: \`10\`` in the `--n` row of the `#### audit tail` flag table (assets/reference.md).
- **Files modified:** `assets/reference.md`
- **Verification:** Phase 24 24-CONTEXT.md D-41 + K cross-referenced; SKILL/RESEARCH ROADMAP success criterion #1 confirms `--n 10`.
- **Committed in:** `8c9bcfc` (Task B-2 commit)

**2. [Rule 1 - Bug] Reference.md `### audit` Exit codes: corrected non-TTY `audit clear` exit from `2` to `1`, and reader-corruption exit from `3` to `1`**

- **Found during:** Task B-2 (verifying Exit codes section against Phase 24 contract)
- **Issue:** PLAN.md template's Exit codes table (line 264) listed `2 | audit clear — non-TTY without --yes.` and `3 | Reader error (corrupt JSONL line)`. Phase 24 24-CONTEXT.md D-46 explicitly states "exit code 1" for non-TTY without `--yes`; D-35 and D-38 also use exit 1 for `audit show` ambiguity/not-found/mutual-exclusion errors; reader corruption per Phase 24 line 222 ("中間出現非 JSON 行視為檔案受損 → exit 1") is also exit 1.
- **Fix:** Rewrote the Exit codes table to match Phase 24 SoT: `0` = success/disabled-opt-out path; `1` = all error cases (show ambiguity/not-found, clear non-TTY, reader corruption). Same hard constraint as deviation #1.
- **Files modified:** `assets/reference.md`
- **Verification:** Phase 24 D-35, D-37, D-38, D-46, E note, line 222 (reader truncation) all consistent with exit 1.
- **Committed in:** `8c9bcfc` (Task B-2 commit)

**3. [Rule 2 - Missing Critical] Added `audit.enabled = false` opt-out behavior to `audit health` description + Exit codes table**

- **Found during:** Task B-2 (verifying complete contract coverage)
- **Issue:** PLAN.md template's `#### audit health` description mentioned the disabled state was flagged in health output, but didn't document the cross-cutting behavior described in Phase 24 E note: when `audit.enabled = false`, ALL read commands (`tail` / `show` / `health`) exit 0 with the message `Audit is disabled (audit.enabled = false in .dbcli). Use 'dbcli audit health' for details.`. Agents lacking this would misinterpret a "silent" tail as a bug.
- **Fix:** Expanded `#### audit health` paragraph + added explicit row to Exit codes table for the opt-out path (exit 0).
- **Files modified:** `assets/reference.md`
- **Verification:** Phase 24 line 77 (E note) consistent.
- **Committed in:** `8c9bcfc` (Task B-2 commit)

**4. [Rule 2 - Missing Critical] Added Reader truncation tolerance bullet to Boundaries**

- **Found during:** Task B-2 (verifying complete contract coverage)
- **Issue:** PLAN.md template's Boundaries didn't mention the crash-tolerant truncation behavior documented in Phase 24 line 222: a truncated last line is silently skipped with a stderr warn; a mid-file non-JSON line is treated as corruption. Without this, agents seeing the warn message would assume bug, not feature.
- **Fix:** Appended a 4th bullet to Boundaries documenting the truncation contract.
- **Files modified:** `assets/reference.md`
- **Verification:** Phase 24 line 222 consistent.
- **Committed in:** `8c9bcfc` (Task B-2 commit)

**5. [Rule 2 - Missing Critical] Added Phase 24 D-39 / D-36 / D-38 / D-47 / D-48 callouts to per-subcommand sections**

- **Found during:** Task B-2 (cross-checking contract completeness)
- **Issue:** PLAN.md template documented the flags but glossed over key contract nuances: (a) `tail --all` JSON output is an envelope array `[{connection, entry}, ...]` while single-connection is flat (D-39/D-40); (b) `show --all` always returns envelope shape even for single hits (D-36); (c) `<id>` + `--recovery-ref` are mutually exclusive (D-38); (d) `clear` does NOT touch other connections (`--all` not supported per D-47); (e) `clear` does NOT reset `last-session-id` (D-48). Without these callouts, agents would write incorrect parsers/scripts.
- **Fix:** Inlined the contract IDs (D-33 / D-36 / D-38 / D-39 / D-41 / D-45 / D-46 / D-47 / D-48) where relevant in the per-subcommand prose.
- **Files modified:** `assets/reference.md`
- **Verification:** Each callout cross-checked against Phase 24 24-CONTEXT.md line numbers.
- **Committed in:** `8c9bcfc` (Task B-2 commit)

---

**Total deviations:** 5 auto-fixed (2 bugs — contract drift in plan template vs Phase 24 SoT; 3 missing critical — opt-out path, truncation tolerance, contract nuance callouts)
**Impact on plan:** All deviations are non-architectural and aligned the documentation to Phase 24 24-CONTEXT.md (the source of truth named in PLAN.md context). The PLAN.md hard constraint at line 274 explicitly authorized this route. No scope creep. The grep target consumed by Plan C step 8/8 (D-78) is unaffected. Plan C and Plan D continue unblocked.

## Issues Encountered

- **Git pre-commit hook stripped `--no-verify` invocations:** The parallel_execution context instructed using `--no-verify` to avoid contention, but a project-level hook blocks `--no-verify` with `BLOCKED: --no-verify flag is not allowed with git commit. Git hooks must not be bypassed.` Commits succeeded normally without the flag (no contention observed inside this worktree). No data lost; both task commits landed cleanly (`3798842`, `8c9bcfc`).
- **Initial commit attempt failed on shell command-substitution of backticks in the `-m` argument:** Inline backticks like `\`audit\`` in the heredoc commit message body were interpreted by the shell as command substitution. Resolved by removing the inline backticks from the body text (the actual file content unchanged); commit `3798842` then landed.

## User Setup Required

None - documentation-only changes; no external service configuration required.

## Self-Check: PASSED

Files verified:

- `docs/feature-matrix.md` — FOUND (modified, new `| \`audit\` |` row at line 41)
- `assets/reference.md` — FOUND (modified, new `### audit` heading at line 790)
- `.planning/phases/26-docs-skill-release-gate/26-B-SUMMARY.md` — FOUND (this file)

Commits verified:

- `3798842` — FOUND (`docs(26-B): add audit row + tier examples to feature-matrix`)
- `8c9bcfc` — FOUND (`docs(26-B): add ### audit subcommand block to reference.md`)

Plan-level grep verification (all PASS):

- `grep -qE '^\| \`audit\` ' docs/feature-matrix.md` → PASS (D-78 release-gate target ready)
- `grep -qE '^### audit$' assets/reference.md` → PASS
- All 4 audit subcommands present in reference.md → PASS
- `recovery_ref` mentioned → PASS
- `Phase 23-04 follow-up` disclosed → PASS
- No `reference.zh-TW.md` created → PASS (D-72 honored)
- `audit clear` NOT in `interactive` tier row → PASS (D-76 honored)

## Next Phase Readiness

- **Plan C (release gate / CHANGELOG / version):** Ready. Plan B has installed the grep target `^\| \`audit\` ` in `docs/feature-matrix.md` that Plan C step 8/8 will consume. The `Required CI validation` block in feature-matrix.md (lines 55-71) was intentionally left untouched by Plan B for Plan C to update with the 7-step → 8-step rewrite.
- **Plan D (README + user docs sync):** Ready. `assets/reference.md` §audit is the canonical deep-reference link that Plan D's README + user-docs index updates will point to.
- **No blockers introduced.**

## Planner-Error Routing (PLAN.md line 274)

Per the PLAN.md hard constraint: "If Phase 24 contract differs from what's documented here for a flag default or behavior, REPORT in SUMMARY (planner-error route) — do NOT silently adjust." The following template values in `.planning/phases/26-docs-skill-release-gate/26-B-feature-matrix-audit-row-PLAN.md` diverge from Phase 24 SoT and were corrected to match Phase 24 in the written reference.md (documented as deviations above):

| Plan template line | Plan template value | Phase 24 SoT (`24-CONTEXT.md`) | Source of truth |
|---|---|---|---|
| Line 209 (`--n` default) | `20` | `10` | D-41 + K (line 97) |
| Line 264 (exit code: clear non-TTY) | `2` | `1` | D-46 (line 68) |
| Line 265 (exit code: reader corruption) | `3` | `1` | Line 222 |

Recommendation: when Phase 26 retro/post-mortem is captured, propagate these corrections back to the source plan if it's intended for reuse (otherwise this SUMMARY's record is sufficient as the corrective audit trail).

---
*Phase: 26-docs-skill-release-gate*
*Plan: B*
*Completed: 2026-05-16*
