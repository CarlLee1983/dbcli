# Phase 25: J1 Coverage Matrix

**Captured:** 2026-05-16 (end of Phase 25 execution)
**Decision reference:** CONTEXT.md Scope Addendum (option J1 selected over J2 / J3)
**Source data:** RESEARCH.md section 4 (call-site map) + PATTERNS.md J1 Coverage Matrix section

---

## Background

Phase 25 set out to wire bi-directional refs between audit entries and recovery envelopes. Mid-research it surfaced (RESEARCH section 13, landmine L1) that **6 commands emit recovery envelopes today but do NOT write audit entries**, a Phase 23 PARTIAL gap (Phase 23-VERIFICATION.md). The planner faced three options:

- **J1**: wire bi-directional refs only on commands that already write audit entries (selected).
- **J2**: absorb Phase 23-04 work and wire `writeAuditEntry` into the 6 unwired commands.
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
| `insert` | **NO (Phase 23 PARTIAL)** | YES (commands/insert.ts + cli.ts:214) | **NO (deferred to Phase 23-04)** | N/A |
| `update` | **NO (Phase 23 PARTIAL)** | YES (commands/update.ts + cli.ts:242) | **NO (deferred to Phase 23-04)** | N/A |
| `delete` | **NO (Phase 23 PARTIAL)** | YES (commands/delete.ts + cli.ts:269) | **NO (deferred to Phase 23-04)** | N/A |
| `export` | **NO (Phase 23 PARTIAL)** | YES (commands/export.ts + cli.ts:302) | **NO (deferred to Phase 23-04)** | N/A |
| `q` | **NO (Phase 23 PARTIAL)** | YES (commands/q.ts) | **NO (deferred to Phase 23-04)** | N/A |
| `schema` | **NO (Phase 23 PARTIAL)** | YES (commands/schema.ts) | **NO (deferred to Phase 23-04)** | N/A |

Source verification: `grep writeAuditEntry src/commands/` + `grep emitRecoveryEnvelope src/` (run during Phase 25 research, 2026-05-15).

---

## Asymmetry Guard

The contract test `tests/integration/recovery-audit-link.test.ts` (Plan 08) includes a parameterized describe block over the 6 unwired commands. For each, it asserts:

1. When `<unwired-cmd> --recovery` fails and emits an envelope, `'audit_ref' in envelope === false` (the key MUST be absent, not just `null` or empty string).
2. (Vacuous case) When a command fails before reaching the emit site (e.g., argv validation), no envelope is written and the guard is vacuously satisfied.

If any future PR wires `writeAuditEntry` into one of these 6 commands WITHOUT also wiring the bi-directional ref, the J1 guard fails immediately, forcing a planner discussion before scope changes.

---

## Phase 23-04 Follow-Up

The 6 unwired commands carry an INTEGRATE-01 / INTEGRATE-04 gap (Phase 23 PARTIAL). When Phase 23-04 ships:

1. Add `writeAuditEntry` calls to each of `insert / update / delete / export / q / schema` happy / failure / rejection paths.
2. Apply the D-J catch-block template from PATTERNS.md (the same template Plan 05 applied to `query.ts` / `inspect.ts`) so the bi-directional ref ships at the same time.
3. Update this matrix — flip all 6 rows from `NO (deferred to Phase 23-04)` to `YES (Phase 23-04 wired)`.
4. Update the J1 asymmetry guard test in `recovery-audit-link.test.ts`: the negative assertions must flip to positive round-trip assertions (`audit_ref` MUST now match audit entry id).

This is a separate phase / plan family — not folded into Phase 25.

---

## References

- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md` (Scope Addendum)
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md` section 4 (Call-Site Map) + section 13 (L1)
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md` (J1 Coverage Matrix table)
- `.planning/phases/23-engine-integration-rejection-paths/23-VERIFICATION.md` (Phase 23 PARTIAL provenance)
- `tests/integration/recovery-audit-link.test.ts` (the J1 asymmetry contract test)

---

*Coverage captured at end of Phase 25. Refresh during Phase 23-04 closure work.*
