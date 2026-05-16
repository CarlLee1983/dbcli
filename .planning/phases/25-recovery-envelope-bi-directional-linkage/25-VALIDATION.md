---
phase: 25
slug: recovery-envelope-bi-directional-linkage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `25-RESEARCH.md` §9 Validation Architecture (Nyquist required by `.planning/config.json`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (Bun 1.x; current suite 2151 pass / 3 skip / 0 fail per STATE.md) |
| **Config file** | none — `bunfig.toml` + per-file imports of `bun:test` |
| **Quick run command** | `bun test tests/integration/recovery-audit-link.test.ts` (Phase 25's new contract test, once Wave 0 lands) |
| **Targeted run** | `bun test tests/integration/recovery-audit-link.test.ts tests/unit/core/recovery tests/unit/commands/{inspect,guide,recover}.test.ts` |
| **Full suite command** | `bun run release:check` (typecheck + lint `--max-warnings=0` + `bun test` + build + dist smoke) |
| **Estimated runtime** | quick ~3s · targeted ~10s · full ~75s |

---

## Sampling Rate

- **After every task commit:** Run quick / targeted command (touched files only)
- **After every plan wave:** Run `bun test` (full unit + integration; skip release:check until verify)
- **Before `$gsd-verify-work`:** `bun run release:check` must be green
- **Max feedback latency:** 15 seconds (targeted run on a single command)

---

## Per-Task Verification Map

> Filled in by `gsd-planner` during planning. Each row binds one plan task to one automated check. Examples below are templates the planner refines.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 (envelope schema) | 1 | INTEGRATE-02/-03 | — | `SavedRecoveryEnvelope.id` / `audit_ref` accepted by `parseSavedRecoveryEnvelope`; legacy envelope (no id / audit_ref) still parses | unit | `bun test tests/unit/core/recovery/envelope-schema.test.ts` | ❌ W0 | ⬜ pending |
| 25-02-01 | 02 (writeAuditEntry id return) | 1 | INTEGRATE-02 | — | `writeAuditEntry` returns entry UUID on success, `null` on disabled / failure (D6) | unit | `bun test tests/unit/core/audit/integration-helper.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-01 | 03 (emit envelope id) | 2 | INTEGRATE-02/-03 | — | `emitRecoveryEnvelope` accepts `EmitOptions.envelopeId` + `auditRef`; pre-generates UUID when omitted | unit | `bun test tests/unit/core/recovery/emit.test.ts` | ❌ W0 | ⬜ pending |
| 25-04-01..N | 04 (wire catch blocks, J1 surface only) | 2 | INTEGRATE-02/-03 | — | wired commands (`query` / `inspect` / `guide` + remaining Phase 23 wired) emit envelope with `audit_ref` and audit entry with `recovery_ref` on failure | integration | `bun test tests/integration/recovery-audit-link.test.ts` | ❌ W0 | ⬜ pending |
| 25-05-01 | 05 (`audit_recent` helper) | 2 | DOCS-02 | — | `loadRecentAudit` returns latest 5 from current connection, returns `[]` when audit disabled / missing / empty | unit | `bun test tests/unit/core/audit/recent.test.ts` | ❌ W0 | ⬜ pending |
| 25-06-01..04 | 06 (inject into 4 commands) | 3 | DOCS-02 | — | `inspect` / `guide` / `recover` / `recover --apply` `--for-agent` or `--format json` output contains `audit_recent` array | integration | `bun test tests/integration/recovery-audit-link.test.ts` | ❌ W0 | ⬜ pending |
| 25-07-01 | 07 (J1 asymmetry guard) | 3 | INTEGRATE-02/-03 | — | unwired commands (insert / update / delete / export / q / schema) emit envelope but `audit_ref` is `undefined` (never `null` / empty) | integration | `bun test tests/integration/recovery-audit-link.test.ts` | ❌ W0 | ⬜ pending |
| 25-08-01 | 08 (release gate) | 4 | INTEGRATE-02/-03 / DOCS-02 | — | `bun run release:check` exits 0 | full | `bun run release:check` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: planner refines exact task IDs / counts. The matrix above is a coverage skeleton — every cell maps a Phase 25 success criterion to one automated invocation.*

---

## Wave 0 Requirements

- [ ] `tests/integration/recovery-audit-link.test.ts` — new file. Covers: bi-directional ref round-trip (1+2), `audit_recent` injection across 4 commands (3), J1 asymmetry guard (criterion 4 wired vs unwired), legacy envelope backward-compat (D-54).
- [ ] `tests/unit/core/recovery/envelope-schema.test.ts` — extend (or new file) for the `id?` / `audit_ref?` optional fields + zod `.strict()` interaction.
- [ ] `tests/unit/core/recovery/emit.test.ts` — extend for `EmitOptions.envelopeId` / `auditRef` + pre-generate behavior.
- [ ] `tests/unit/core/audit/integration-helper.test.ts` — extend `writeAuditEntry` return-type tests (entry id vs `null`).
- [ ] `tests/unit/core/audit/recent.test.ts` — new helper test for `loadRecentAudit` (5-entry cap, disabled / empty / missing fall-through to `[]`, rotation-aware via `include_rotated: true`).

*All five test files are "Wave 0" — they must exist (even if red) before the implementation tasks in Wave 1+ execute.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent ergonomics — does an LLM client actually consume `audit_recent` correctly when joining `envelope.audit_ref → entry.id`? | DOCS-02 | Behavioral / DX check; not a pure unit assertion | Manual smoke: trigger a failed `dbcli query`, then run `dbcli recover --format json` and confirm the returned `audit_recent[]` includes the just-written entry and that `audit_ref` ↔ `id` matches. |
| Skill markdown rendering of the new `audit_recent` block | DOCS-02 (forward-looks Phase 26) | Visual / doc layout; Phase 26 task but worth eyeballing now | Run `bun run src/cli.ts inspect --for-agent` and confirm JSON shape; visual verification only — not a Phase 25 release gate. |

---

## Validation Sign-Off

- [ ] All planned tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (5 test files above)
- [ ] No watch-mode flags (CI-safe single-shot runs only)
- [ ] Feedback latency < 15s for targeted runs, < 80s for full release-check
- [ ] `nyquist_compliant: true` set in frontmatter (planner updates after wave 0 lands)

**Approval:** pending — planner to fill matrix from concrete plan task IDs, then flip `status: approved` and `nyquist_compliant: true`.
