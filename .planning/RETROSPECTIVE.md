# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.20.0 — Agent-Facing Audit Log

**Shipped:** 2026-05-17
**Phases:** 6 (Phase 21–26) | **Plans:** 29 | **Timeline:** 2026-05-15 → 2026-05-17 (3 days)

### What Was Built
- `.dbcli/audit/<connection>.jsonl` append-only writer with file lock + size/entry rotation (Phase 21)
- `SessionIdService` with env-first resolution (`DBCLI_SESSION_ID`) + PID-stamped persistence (Phase 21)
- Agent-facing `AuditEntry` JSON contract + release-blocking contract test reusing `tests/helpers/sensitive-output.ts` (Phase 22)
- Engine integration into `query`/`plan`/`doctor`/`inspect`/`report`/`guide` across SQL/Mongo/Redis/ES (Phase 23, partial — DML/DDL deferred to Phase 23-04)
- `dbcli audit tail|show|clear|health` CLI with `--all` cross-connection envelope + `--format table|json` (Phase 24)
- Bi-directional `recovery_ref` ⇄ `audit_ref` linkage; `audit_recent` injected at inspect/guide/recover/recover --apply (Phase 25)
- Bilingual SKILL.md + `dbcli skill --install --lang en|zh-TW` flag + audit section in README/CHANGELOG/feature-matrix (Phase 26)
- Release-check.sh step 8/8 doc-presence gate (Phase 26)

### What Worked
- **Schema-lock-before-fanout discipline.** Phase 22 release-blocking contract test landed before Phase 23 hooked all engines — zero schema-drift rework when each engine integrated.
- **Single redaction source.** Forcing all redaction back to `tests/helpers/sensitive-output.ts` (no second helper) kept the audit safety contract auditable from one file.
- **J1 scope lock for Phase 25.** Limiting bi-directional ref wiring to `query` + `inspect` catch blocks shipped the contract guard quickly; deferring the other 6 commands to Phase 23-04 was the right call rather than expanding scope mid-phase.
- **Capability registry reuse for `side_effect_tier`.** Reading `src/adapters/capabilities.ts` directly meant new commands need only one update point — no parallel enum to drift.
- **Decision lock (D1–D6) at roadmap time.** Locking "default-on" / "session_id env-first" / "metadata-only" / "fail-soft" before Phase 21 prevented late re-litigation.

### What Was Inefficient
- **Requirements traceability drift.** REQUIREMENTS.md `[ ]` boxes never got flipped to `[x]` as phases shipped — 25/28 still showed Pending at milestone close, forcing a sweep before archive. Should be a per-phase checkpoint, not an end-of-milestone task.
- **Phase 23 scope discovery mid-flight.** The split between "diagnostic surface" (shipped) vs "DML/DDL" (deferred to 23-04) emerged during execution rather than during Phase 23 planning. A pre-execution audit of which catch blocks already had `writeAuditEntry` would have surfaced this earlier.
- **Plan numbering inconsistency.** Phase 23 used `23-01 / 23-02-core-integration / 23-03-diagnostic-integration` while Phase 26 used `26-A / 26-B / 26-C / 26-D`. Mixed conventions across the same milestone make plan globbing harder.

### Patterns Established
- **Locked-decisions block in roadmap.** D1–D6 table at top of ROADMAP.md / REQUIREMENTS.md surfaces irreversible choices before they get re-litigated.
- **Release-blocking contract test as a gate.** Every agent-facing JSON output now ships with a contract test that's wired into `bun run release:check`. Pattern continues from v1.19.1 inspect/report/guide/recovery.
- **Backlog-carry annotation in milestone archive.** Explicitly marking INTEGRATE-01 / INTEGRATE-04 as Partial with the Phase 23-04 reference (rather than hiding the gap) is the right hand-off for the next milestone.
- **Coverage matrix doc per partial closure.** `25-J1-COVERAGE-MATRIX.md` documents which 2 commands are wired and which 6 are not — useful template for future partial integrations.

### Key Lessons
1. **Flip `[ ]` → `[x]` in REQUIREMENTS.md per plan summary, not at milestone end.** Per-phase verification should sweep the traceability table as part of `phase complete` automation.
2. **Audit the "no second helper" rule explicitly.** When the security contract says "one redaction source," tests must fail if a second one is introduced. Make this part of the contract test, not a code-review hope.
3. **Mid-phase scope discoveries deserve a quick `--rescope` flag.** Phase 23's discovery that DML/DDL was much wider than expected should have triggered a 5-minute roadmap re-slice; instead we shipped Phase 23 partial and added Phase 23-04 as backlog — workable but messier than splitting Phase 23a / 23b at planning time would have been.
4. **Default-on observability needs CHANGELOG warning.** D1 (`audit.enabled = true` by default) silently creates `.dbcli/audit/` for every upgrading user. Calling this out prominently in CHANGELOG + README upgrade notes was the right move; do the same for any future default-on feature.

### Cost Observations
- Model mix: ~5% opus (roadmap / decision locks), ~85% sonnet (planning + execution), ~10% haiku (parallel SUMMARY extraction)
- Sessions: ~12 (mix of plan-phase, execute-phase, verify-work, complete-milestone)
- Notable: single-day per phase was achievable for Phases 21–26 because schema lock + capability registry reuse cut rework. Worth maintaining the "lock the contract before fanning out" pattern.

---

## Milestone: v0.2.0-beta — Data Access Control

**Shipped:** 2026-03-26
**Phases:** 1 | **Plans:** 3 (1 core + 2 gap closure)

### What Was Built
- Table and column-level blacklisting with O(1) Set/Map lookups
- CLI management commands (blacklist list/table/column add/remove)
- Security notifications in all output formats (table, CSV, JSON)
- End-to-end CLI wiring across all 4 execution commands
- Context-aware override via environment variable
- 103 new tests (83 core + 12 wiring + 8 formatter)

### What Worked
- Infrastructure-first approach: building BlacklistManager, BlacklistValidator, and executor integration as a foundation was solid
- Gap closure workflow: verification caught the CLI wiring gap, gap plans fixed it cleanly with minimal scope
- Parallel executor agents for independent gap closure plans saved time
- TDD approach produced comprehensive test coverage from the start

### What Was Inefficient
- Plan 01 built all infrastructure but stopped short of CLI wiring — verification caught this as a critical gap
- Required 2 extra gap closure plans (13-02, 13-03) for what could have been included in the original plan
- The original plan had 15 tasks but left the final integration step for "a future phase"

### Patterns Established
- Gap closure workflow (verify → plan gaps → execute gaps-only) is effective for catching integration gaps
- `--gaps-only` flag allows targeted re-execution without re-running completed plans
- Single-day milestone delivery is feasible for focused, well-scoped work

### Key Lessons
1. Plans should include end-to-end integration, not just infrastructure — "wire it up" should be part of the original plan, not deferred
2. Verification after execution is essential — the gap between "code exists" and "code is connected" is where security bugs hide
3. Blacklist-style access control (deny-list) is simpler to implement and reason about than fine-grained ACL (allow-list)

### Cost Observations
- Model mix: ~10% opus (orchestration), ~90% sonnet (execution)
- Sessions: 2 (gap closure + full execution)
- Notable: Gap closure plans executed in ~6 minutes total; verification confirmed zero regressions

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v0.2.0-beta | 1 | 3 | Gap closure workflow validated; --gaps-only execution mode |

### Cumulative Quality

| Milestone | Tests | Key Metric |
|-----------|-------|------------|
| v0.2.0-beta | 230+ | 10/10 verification, 0 regressions, < 1ms blacklist overhead |

### Top Lessons (Verified Across Milestones)

1. End-to-end wiring must be part of the plan, not deferred — infrastructure without integration is dead code
2. Verification-driven development catches gaps that unit tests miss
