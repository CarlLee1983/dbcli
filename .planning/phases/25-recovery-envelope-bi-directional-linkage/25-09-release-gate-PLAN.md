---
phase: 25
plan: 09
type: execute
wave: 4
depends_on: [01, 02, 03, 04, 05, 06, 07, 08]
files_modified:
  - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md
  - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md
  - .planning/STATE.md
autonomous: false
requirements: [INTEGRATE-02, INTEGRATE-03, DOCS-02]
must_haves:
  truths:
    - "`bun run release:check` exits 0 (full release gate green: typecheck + lint --max-warnings=0 + bun test + build + dist smoke)"
    - "25-VALIDATION.md frontmatter flipped to status: approved + nyquist_compliant: true"
    - "25-J1-COVERAGE-MATRIX.md exists with the full coverage table from PATTERNS.md (J1 wired surface vs unwired surface)"
    - "Phase 23-04 follow-up is recorded in STATE.md so the gap isn't forgotten by Phase 26"
    - "All Phase 22 / 24 fence files are unmodified (git diff shows no changes)"
  artifacts:
    - path: ".planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md"
      provides: "Standalone J1 coverage matrix doc, the deliverable required by CONTEXT.md Scope Addendum item 1"
      contains: "J1 Coverage Matrix"
    - path: ".planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md"
      provides: "Updated frontmatter (status: approved, nyquist_compliant: true) and updated per-task verification map"
      contains: "status: approved"
    - path: ".planning/STATE.md"
      provides: "Phase 23-04 follow-up entry under the active deferred backlog OR cross-referenced from Phase 25 status note"
      contains: "Phase 23-04"
  key_links:
    - from: ".planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md"
      to: ".planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (Scope Addendum item 1)"
      via: "CONTEXT.md addendum explicitly asks for this deliverable as a Phase 25 SUMMARY chapter"
      pattern: "J1 coverage matrix"
---

<objective>
Close Phase 25 by:
1. Producing the J1 coverage matrix as a standalone planning doc (deliverable per CONTEXT.md Scope Addendum item 1).
2. Recording the Phase 23-04 follow-up (unwired commands' audit-write gap) so it does not vanish.
3. Flipping `25-VALIDATION.md` frontmatter to approved + nyquist_compliant.
4. Running the full release gate (`bun run release:check`) and confirming it is green.

Purpose: Final wave that takes Phase 25 from "feature complete" to "release-gated". Plan 26 (docs / SKILL.md / CHANGELOG) starts after this gate is green.

Output: Two new / updated planning docs + green release:check + STATE.md follow-up note. This plan is the only one in Phase 25 with `autonomous: false` (it contains a human-verify checkpoint at the end - the user confirms the gate passed and triggers commit + tag).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md
@.planning/phases/23-engine-integration-rejection-paths/23-VERIFICATION.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create the J1 coverage matrix as a standalone planning doc</name>
  <read_first>
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section "J1 Coverage Matrix" near the bottom of the file, this is the canonical table)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (Scope Addendum item 1, deliverable spec)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (section 4 call-site table, source data for the matrix)
  </read_first>
  <files>.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md</files>
  <behavior>
    - The file documents the J1 scope lock as a table: for each command in dbcli, list (a) whether it calls writeAuditEntry today, (b) whether it calls emitRecoveryEnvelope today, (c) whether Phase 25 wired the bi-directional ref, (d) whether Phase 25 added DOCS-02 audit_recent.
    - The header explains the J1 decision (selected over J2 / J3 per CONTEXT.md addendum) and links to Phase 23-04 as the future closure.
    - The file follows the existing `.planning/phases/25-*/` doc style (markdown, header with date + status, section per concern).
  </behavior>
  <action>
Create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` with the following content (copy verbatim, adjusting only the date and any planner-discretion footnotes):

````markdown
# Phase 25: J1 Coverage Matrix

**Captured:** 2026-05-15 (end of Phase 25 execution)
**Decision reference:** CONTEXT.md Scope Addendum (option J1 selected over J2 / J3)
**Source data:** RESEARCH.md section 4 (call-site map) + PATTERNS.md J1 Coverage Matrix section

---

## Background

Phase 25 set out to wire bi-directional refs between audit entries and recovery envelopes. Mid-research it surfaced (RESEARCH section 13, landmine L1) that **6 commands emit recovery envelopes today but do NOT write audit entries**, a Phase 23 PARTIAL gap (Phase 23-VERIFICATION.md). The planner faced three options:

- **J1**: wire bi-directional refs only on commands that already write audit entries (selected).
- **J2**: absorb Phase 23-04 work and wire writeAuditEntry into the 6 unwired commands.
- **J3**: only wire `query` + `inspect` (even narrower).

The user picked **J1** in CONTEXT.md's Scope Addendum. The asymmetry is documented here so Phase 26 docs (SKILL.md / CHANGELOG) and any future Phase 23-04 work has a clear map.

---

## Coverage Matrix

| Command | Has `writeAuditEntry` today? | Has `emitRecoveryEnvelope` today? | Phase 25 bi-directional ref wired? | Phase 25 DOCS-02 `audit_recent` injected? |
|---------|------------------------------|-----------------------------------|------------------------------------|-------------------------------------------|
| `query` | YES (commands/query.ts:167) | YES (commands/query.ts:175) | **YES (J1 wired surface)** | N/A (no agent JSON output type) |
| `inspect` | YES (commands/inspect.ts:63, 70) | YES (commands/inspect.ts:78) | **YES (J1 wired surface)** | **YES** (Plan 06) |
| `guide` | YES (commands/guide.ts:87, 94) | NO | N/A (no envelope to link) | **YES** (Plan 06) |
| `recover` | NO (F1 decision: recover does not self-audit) | N/A (recover renders, does not emit) | N/A | **YES** (Plan 07) two branches |
| `recover --next` | NO | N/A | N/A | NO (L2: out of DOCS-02 scope) |
| `report` | YES (commands/report.ts:87, 97) | NO | N/A | NO (not in DOCS-02 4-surface list) |
| `doctor` | YES (commands/doctor.ts:733) | NO | N/A | NO |
| `plan` | YES (commands/plan.ts:51, 68) | NO | N/A | NO |
| `insert` | **NO (Phase 23 PARTIAL)** | YES (commands/insert.ts:275 + cli.ts:214) | **NO (deferred to Phase 23-04)** | N/A |
| `update` | **NO (Phase 23 PARTIAL)** | YES (commands/update.ts:307 + cli.ts:242) | **NO (deferred to Phase 23-04)** | N/A |
| `delete` | **NO (Phase 23 PARTIAL)** | YES (commands/delete.ts:276 + cli.ts:269) | **NO (deferred to Phase 23-04)** | N/A |
| `export` | **NO (Phase 23 PARTIAL)** | YES (commands/export.ts:146 + cli.ts:302) | **NO (deferred to Phase 23-04)** | N/A |
| `q` | **NO (Phase 23 PARTIAL)** | YES (commands/q.ts:219) | **NO (deferred to Phase 23-04)** | N/A |
| `schema` | **NO (Phase 23 PARTIAL)** | YES (commands/schema.ts:223) | **NO (deferred to Phase 23-04)** | N/A |

Source verification: `grep writeAuditEntry src/commands/` + `grep emitRecoveryEnvelope src/` (run 2026-05-15 during Phase 25 research).

---

## Asymmetry Guard

The contract test `tests/integration/recovery-audit-link.test.ts` (Plan 08) includes a parameterized describe block over the 6 unwired commands. For each, it asserts:

1. When `<unwired-cmd> --recovery` fails and emits an envelope, `'audit_ref' in envelope === false` (the key MUST be absent, not just `null` or empty string).
2. No audit entry is written for the failure (entries array is empty).

If any future PR wires writeAuditEntry into one of these 6 commands WITHOUT also wiring the bi-directional ref, the J1 guard fails immediately, forcing a planner discussion before scope changes.

---

## Phase 23-04 Follow-Up

The 6 unwired commands carry an INTEGRATE-01 / INTEGRATE-04 gap (Phase 23 PARTIAL). When Phase 23-04 ships:

1. Add `writeAuditEntry` calls to each of `insert / update / delete / export / q / schema` happy / failure / rejection paths.
2. Apply the D-J catch-block template from PATTERNS.md (the same template Plan 05 applied to `query.ts` / `inspect.ts`) so the bi-directional ref ships at the same time.
3. Update this matrix - flip all 6 rows from `NO (deferred to Phase 23-04)` to `YES (Phase 23-04 wired)`.
4. Update the J1 asymmetry guard test in `recovery-audit-link.test.ts`: the negative assertions must flip to positive round-trip assertions (audit_ref MUST now match audit entry id).

This is a separate phase / plan family - not folded into Phase 25.

---

## References

- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md` (Scope Addendum)
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md` section 4 (Call-Site Map) + section 13 (L1)
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md` (J1 Coverage Matrix table)
- `.planning/phases/23-engine-integration-rejection-paths/23-VERIFICATION.md` (Phase 23 PARTIAL provenance)

---

*Coverage captured at end of Phase 25. Refresh during Phase 23-04 closure work.*
````

After writing the file, confirm with `cat .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md | head -30`.
  </action>
  <verify>
    <automated>test -f .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md && grep -cE "^\\| " .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md</automated>
  </verify>
  <acceptance_criteria>
    - `test -f .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` returns true.
    - `grep -cE "^\\| (query|inspect|guide|recover|insert|update|delete|export|q|schema)" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` returns at least 10 (one row per command).
    - `grep -nE "Phase 23-04" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` returns at least 2 lines (header + table footnotes).
    - `grep -nE "audit_ref" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` returns at least one line (asymmetry guard section).
    - `wc -l .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md | awk '{print $1}'` returns at least 50.
  </acceptance_criteria>
  <done>
    The J1 coverage matrix is captured as a standalone planning doc; the matrix lists all 14 relevant commands and Phase 23-04 follow-up is explicitly documented.
  </done>
</task>

<task type="auto">
  <name>Task 2: Flip 25-VALIDATION.md frontmatter to approved + nyquist_compliant + log Phase 23-04 follow-up in STATE.md</name>
  <read_first>
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md (full file)
    - .planning/STATE.md (full file - look for the "deferred" / "follow-up" section structure)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-08-contract-test-j1-guard-PLAN.md (confirm the contract test exists and the wave-0 gaps are closed)
  </read_first>
  <files>
    .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md,
    .planning/STATE.md
  </files>
  <behavior>
    A. VALIDATION.md update:
    - Frontmatter `status: draft` flips to `status: approved`.
    - Frontmatter `nyquist_compliant: false` flips to `nyquist_compliant: true`.
    - Frontmatter `wave_0_complete: false` flips to `wave_0_complete: true`.
    - Add `approved: 2026-05-15` field.
    - The Per-Task Verification Map: every row's Status column flips from `⬜ pending` to `✅ green` (assuming all preceding plans landed green; mark any known failures with `⚠️ flaky` and footnote).
    - Sign-Off section: flip each `[ ]` to `[x]`; update the approval timestamp.

    B. STATE.md update:
    - Add an explicit follow-up entry referencing Phase 23-04. Use the existing STATE.md vocabulary (look for sections like "Accumulated Context", "Key Decisions", or a "Follow-ups" / "Deferred" subsection - place the new entry where it fits the document's structure).
    - The entry must mention: (1) the 6 unwired commands, (2) the Phase 23-04 phase name, (3) the contract-test guard that will fail if scope changes silently.
  </behavior>
  <action>
**Step A - update VALIDATION.md frontmatter:**

Open `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md`. Replace the frontmatter (lines 1-9) with:

```yaml
---
phase: 25
slug: recovery-envelope-bi-directional-linkage
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
approved: 2026-05-15
---
```

**Step B - update the Per-Task Verification Map table:**

For each row in the matrix (currently 8 rows in the Per-Task Verification Map), update the `Status` column. After Plans 01..08 have all landed and passed, the column reads `✅ green` for every row.

If any plan's tasks have known failures / skips at this point, mark those as `⚠️ flaky` or `❌ red` and document why in a footnote below the table.

Concretely - in the table, replace `⬜ pending` everywhere with `✅ green` (post-execution; the executor running this plan has full hindsight on what landed).

**Step C - flip Sign-Off checkboxes:**

In the "Validation Sign-Off" section near the bottom, flip each `- [ ]` to `- [x]`:

```markdown
- [x] All planned tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (5 test files above)
- [x] No watch-mode flags (CI-safe single-shot runs only)
- [x] Feedback latency < 15s for targeted runs, < 80s for full release-check
- [x] `nyquist_compliant: true` set in frontmatter (planner updates after wave 0 lands)

**Approval:** approved 2026-05-15 - all release-blocking tests green; Phase 23-04 follow-up logged in STATE.md.
```

Do NOT remove or rewrite the surrounding prose - just flip the status / checkboxes.

**Step D - add follow-up entry to STATE.md:**

Open `.planning/STATE.md`. The file already has structured sections: "Project Reference", "Current Position", "Milestone Status", "Accumulated Context", "Key Decisions Made", etc.

Add a new follow-up note. The cleanest placement is to extend the "Current Position" section's "Next phase" line and to add a new bullet in "Accumulated Context (carried from previous milestones)":

In the "Current Position" section, change the "Status" line to reference Phase 25 as feature-complete pending docs:

```markdown
- **Status:** Phases 21 / 22 / 24 / 25 complete; Phase 23 PARTIAL (audit-only deltas for `insert / update / delete / check / diff / migrate / schema / list / export / shell` deferred to Phase 23-04 per 23-VERIFICATION conclusion). Phase 25 shipped 2026-05-15 with J1 scope lock (`query` / `inspect` bi-directional ref; 6 unwired commands' envelopes carry no `audit_ref`; contract test enforces the asymmetry).
- **Next phase:** 26 (Docs / Skill / Release Gate). Phase 26 must call out Phase 25's J1 asymmetry in CHANGELOG / README; SKILL.md describes the bi-directional ref behavior.
```

In the "Accumulated Context" section, append:

```markdown
- **Phase 25 J1 asymmetry (carried forward to Phase 26 / Phase 23-04)** - Bi-directional `recovery_ref` / `audit_ref` shipped only on `query` + `inspect`. 6 commands (`insert / update / delete / export / q / schema`) emit envelopes without `audit_ref` until Phase 23-04 wires `writeAuditEntry` into them. Contract test at `tests/integration/recovery-audit-link.test.ts` enforces this asymmetry; flipping the J1 lock requires a planner discussion. See `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`.
```

Save STATE.md. Do NOT bump `gsd_state_version`, `milestone`, or the top-level `progress` block — those are managed elsewhere (the orchestrator / verify-work flow updates the progress numbers).
  </action>
  <verify>
    <automated>grep -nE "^status: approved" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md; grep -nE "^nyquist_compliant: true" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md; grep -cE "^- \\[x\\]" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md; grep -nE "Phase 23-04" .planning/STATE.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "^status: approved" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md` returns one line.
    - `grep -nE "^nyquist_compliant: true" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md` returns one line.
    - `grep -nE "^wave_0_complete: true" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md` returns one line.
    - `grep -cE "⬜ pending" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md` returns 0 (all rows flipped) - OR if any rows kept as flaky/red, footnotes are present.
    - `grep -cE "^- \\[x\\]" .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md` returns at least 5 (the sign-off checkboxes).
    - `grep -nE "Phase 23-04" .planning/STATE.md` returns at least 2 lines (the entry was added; also the existing 23-04 reference from before this plan is still present).
    - `grep -nE "Phase 25 J1 asymmetry" .planning/STATE.md` returns at least one line (the new follow-up bullet).
    - `grep -nE "shipped 2026-05-15" .planning/STATE.md` returns at least one line (Phase 25 marked as shipped).
  </acceptance_criteria>
  <done>
    VALIDATION.md is approved + nyquist_compliant; the per-task matrix is all green; STATE.md records the Phase 23-04 follow-up under both Current Position and Accumulated Context sections.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Run release:check and confirm green (human-verify gate)</name>
  <what-built>
    Phase 25 is feature-complete and contract-tested. Plan 08 landed the release-blocking contract test. This checkpoint runs the full release gate and asks the user to confirm the result before Phase 26 starts.
  </what-built>
  <how-to-verify>
    1. From the project root, run:
       ```bash
       bun run release:check
       ```
       The command runs the full gate documented in `docs/feature-matrix.md`:
       - prettier (formatter)
       - typecheck
       - lint (`--max-warnings=0` release-blocking)
       - `bun test` (full suite, currently 2151 pass / 3 skip / 0 fail before Phase 25; Phase 25 adds ~30 new tests across recovery-audit-link, recent, integration-helper, emit, envelope-schema)
       - build (`dist/cli.mjs` + UI template)
       - dist-smoke

    2. Confirm exit code 0. If any stage fails, report the failure to the planner / executor for triage (Phase 25 does NOT ship until release:check is green).

    3. Verify no Phase 22 / 24 fence files were modified:
       ```bash
       git diff --name-only HEAD -- tests/integration/audit-contract.test.ts tests/integration/audit-envelope.test.ts
       ```
       Expected: empty output (no files listed).

    4. Spot-check the J1 asymmetry guard test from Plan 08 by running it in isolation:
       ```bash
       bun test tests/integration/recovery-audit-link.test.ts
       ```
       Expected: all release-blocking tests green; any J1 sub-cases that were `test.skip(...)`-ed should have explanatory comments (Phase 23-04 TODO).

    5. Review `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`:
       ```bash
       cat .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md
       ```
       Expected: the matrix correctly reflects the implementation; the 6 unwired commands are explicitly listed as Phase 23-04 follow-up.

    6. If all four steps above are green, type `approved` to mark Phase 25 ready for `/gsd-verify-work 25`.

       If any check fails, describe which step failed and what the failure was so the executor or planner can triage.
  </how-to-verify>
  <resume-signal>Type "approved" to confirm Phase 25 is release-gated, or describe the failure to triage.</resume-signal>
</task>

</tasks>

<verification>
1. `bun run release:check` exits 0 (the gate).
2. `git diff tests/integration/audit-contract.test.ts tests/integration/audit-envelope.test.ts` shows no changes (Phase 22 / 24 fences respected).
3. `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` exists and contains 10+ command rows.
4. `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md` frontmatter is `status: approved`, `nyquist_compliant: true`, `wave_0_complete: true`.
5. `.planning/STATE.md` includes both a "Phase 25 J1 asymmetry" follow-up bullet and a "Phase 23-04" cross-reference in the Status block.
</verification>

<success_criteria>
- Release gate green; all 4 ROADMAP success criteria verifiable via the contract test in Plan 08.
- J1 coverage matrix captured as a standalone planning doc.
- Phase 23-04 follow-up recorded in STATE.md.
- VALIDATION.md approved; nyquist_compliant: true.
- Human-verify checkpoint reached; user confirms before Phase 26 begins.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-09-SUMMARY.md` documenting:
- `release:check` outcome (exit code, test counts, build artifacts produced)
- Phase 22 / 24 fence verification (git diff confirmed no changes)
- J1 coverage matrix delivered (link to `25-J1-COVERAGE-MATRIX.md`)
- STATE.md follow-up bullet added
- VALIDATION.md frontmatter flipped
- Forward pointer: `/gsd-verify-work 25` is the next user command; Phase 26 (DOCS-01 / -03 / -04) starts after verify-work signs off
</output>
