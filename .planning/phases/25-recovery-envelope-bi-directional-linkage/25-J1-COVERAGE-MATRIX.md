# Phase 25: J1 Coverage Matrix

**Captured:** 2026-05-16 (end of Phase 25 execution)
**Refreshed:** 2026-05-18 (Phase 23-04 closure — all 6 deferred commands now wired)
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
| `insert` | **YES (Phase 23-04 wired)** | YES (commands/insert.ts + cli.ts:214) | **YES (Phase 23-04 wired)** | N/A |
| `update` | **YES (Phase 23-04 wired)** | YES (commands/update.ts + cli.ts:242) | **YES (Phase 23-04 wired)** | N/A |
| `delete` | **YES (Phase 23-04 wired)** | YES (commands/delete.ts + cli.ts:269) | **YES (Phase 23-04 wired)** | N/A |
| `export` | **YES (Phase 23-04 wired)** | YES (commands/export.ts + cli.ts:302) | **YES (Phase 23-04 wired)** | N/A |
| `q` | **YES (Phase 23-04 wired)** | YES (commands/q.ts) | **YES (Phase 23-04 wired)** | N/A |
| `schema` | **YES (Phase 23-04 wired)** | YES (commands/schema.ts) | **YES (Phase 23-04 wired)** | N/A |

Source verification: `grep writeAuditEntry src/commands/` + `grep emitRecoveryEnvelope src/` (re-run 2026-05-18 after Phase 23-04 closure; original baseline 2026-05-15).

---

## Round-Trip Contract (Phase 23-04 closure)

The contract test `tests/integration/recovery-audit-link.test.ts` now runs a **consolidated 6-command bi-directional round-trip** describe block (commit `4629e51`, 2026-05-18). For each of `schema / q / export / insert / update / delete` it asserts:

1. After `<cmd> --recovery` fails, `envelope.audit_ref === audit.id` (the envelope's back-pointer matches the audit entry id).
2. `audit.recovery_ref === envelope.id` (the audit entry's forward-pointer matches the envelope id).
3. Both refs are well-formed UUIDs (`/^[0-9a-f-]{36}$/`).

The legacy "J1 asymmetry guard" (the negative `'audit_ref' in envelope === false` block) was deleted in the same commit — the asymmetry it guarded no longer exists.

---

## Phase 23-04 Closure (shipped 2026-05-18)

The 6 commands carry no Phase 23 PARTIAL gap anymore. Shipped in merge commit `60eab9b` (`feat/audit-wire-6-commands`):

1. ✅ `writeAuditEntry` wired into `insert / update / delete / export / q / schema` happy + failure + rejection paths.
2. ✅ D-J catch-block template applied (same shape as Plan 05's `query.ts` / `inspect.ts`); bi-directional `audit_ref` ⇄ `recovery_ref` ships in the same try/catch.
3. ✅ This matrix updated — all 6 rows flipped to `YES (Phase 23-04 wired)`.
4. ✅ `recovery-audit-link.test.ts` flipped from negative J1 guard to positive 6-command round-trip (commit `4629e51`).
5. ✅ Bilingual user docs (`docs/user/en` + `docs/user/zh-TW`, both `.md` and `.html`) and agent-facing `assets/SKILL.md` + `assets/reference.md` updated to advertise full coverage (commits `3b6a6d5`, `50a58ed`).

INTEGRATE-01 / INTEGRATE-04 are now fully closed in v1.20.1 (patch release shipped 2026-05-18).

---

## References

- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md` (Scope Addendum)
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md` section 4 (Call-Site Map) + section 13 (L1)
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md` (J1 Coverage Matrix table)
- `.planning/phases/23-engine-integration-rejection-paths/23-VERIFICATION.md` (Phase 23 PARTIAL provenance)
- `tests/integration/recovery-audit-link.test.ts` (now: consolidated 6-command bi-directional round-trip contract)
- `docs/superpowers/plans/2026-05-18-audit-wire-6-commands.md` (Phase 23-04 execution plan)

---

*Coverage captured at end of Phase 25; refreshed 2026-05-18 at Phase 23-04 closure. All 14 db-touching commands either write audit entries with bi-directional recovery refs (8) or do not emit recovery envelopes (6) — no remaining asymmetry.*
