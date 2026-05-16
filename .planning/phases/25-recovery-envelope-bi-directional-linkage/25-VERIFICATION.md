---
phase: 25-recovery-envelope-bi-directional-linkage
verified: 2026-05-16T14:50:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Agent ergonomics — LLM client consumes `audit_recent` and joins `envelope.audit_ref → entry.id` correctly"
    expected: "Agent stitches the bi-directional ref into a single forensics narrative in a real session"
    why_human: "Behavioral / DX check; cannot assert from a single CLI invocation. VALIDATION.md explicitly marks this as Manual-Only."
  - test: "SKILL.md / agent-guide rendering of the new `audit_recent` block"
    expected: "Field appears cleanly in the JSON layouts agents consume; layout readable"
    why_human: "Documentation / visual layout check; SKILL.md update is Phase 26's job — this is a forward-look smoke test."
---

# Phase 25: Recovery Envelope Bi-directional Linkage Verification Report

**Phase Goal:** 讓 audit log 和既有 recovery envelope（v1.17.0 起）互為起點，agent 可以從任一端跳到另一端，補上 forensics 的完整路徑。

**Verified:** 2026-05-16T14:50:00Z
**Status:** passed (with 2 human-verification follow-ups documented)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Command 失敗時產生的 audit entry，其 `recovery_ref` 指向當次寫入的 `.dbcli/last-recovery.json`（含 envelope id / path） | ✓ VERIFIED | Empirical spot-check (synthetic tmpdir): `inspect --require-schema-cache --recovery --no-connect` produced audit entry with `recovery_ref: "d51d1844-..."` exactly matching the envelope's `id` field. Source: `src/commands/inspect.ts:78-89` (catch block pre-generates `envelopeId`, passes it via `recovery_ref: envelopeId` to `writeAuditEntry`). |
| 2 | 同一次失敗寫入的 recovery envelope 新增 `audit_ref` 欄位，反向指向觸發它的 audit entry id | ✓ VERIFIED | Same spot-check: envelope `audit_ref: "54a8d49b-..."` exactly matches the audit entry's `id`. Source: `src/commands/inspect.ts:92-101` (catch captures `auditId` from `writeAuditEntry` return, passes via `emitRecoveryEnvelope({ auditRef: auditId ?? undefined })`); `src/core/recovery/emit.ts:37,49-66` (writeLastEnvelopeSync persists `audit_ref` conditionally). |
| 3 | `dbcli inspect` 與 `dbcli recover` 在 agent guide 輸出中自動引用 recent audit（last N 筆摘要） | ✓ VERIFIED | Empirical spot-check: `inspect --for-agent` JSON contains top-level `audit_recent: []` (D-60 fall-through path). Source: `src/commands/inspect.ts:59-65`, `src/commands/guide.ts:81-87`, `src/commands/recover.ts:255-271, 287, 307` — all 4 surfaces inject. Contract test exercises all 4 (19/19 pass). |
| 4 | 雙向欄位在 `--format json` agent-facing 輸出皆存在且互相對得上（contract test 守住） | ✓ VERIFIED | `tests/integration/recovery-audit-link.test.ts` (410 lines, 6 describe blocks, 19 tests / 0 fail). Release-blocking round-trip test asserts both `envelope.id === audit.recovery_ref` AND `envelope.audit_ref === audit.id`. J1 asymmetry guard parameterized over 6 unwired commands. Re-run during verification: `19 pass / 0 fail / 43 expect() calls / 5.21s`. |

**Score:** 4/4 truths verified

---

## Required Artifacts (per-plan must_haves)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/recovery/apply-types.ts` | `SavedRecoveryEnvelope` declares `id?: string` + `audit_ref?: string` between `schemaVersion: 1` and `savedAt` | ✓ VERIFIED | Lines 94-105 — both fields present with D-50 / D-53 doc comments. `schemaVersion: 1` literal unchanged. |
| `src/core/recovery/envelope-schema.ts` | `savedRecoveryEnvelopeSchema` declares `id` + `audit_ref` as `.optional()` under `.strict()` | ✓ VERIFIED | Lines 64-74 — `id: z.string().optional()` line 67, `audit_ref: z.string().optional()` line 68, `.strict()` line 74 retained. |
| `src/core/recovery/emit.ts` | `EmitOptions.envelopeId?` + `EmitOptions.auditRef?`; `emitRecoveryEnvelope` pre-generates UUID; `writeLastEnvelopeSync` persists both with conditional `audit_ref` spread | ✓ VERIFIED | Lines 10-21 (EmitOptions), 36 (`envelopeId = options.envelopeId ?? randomUUID()`), 37 (call passes id + auditRef), 49-66 (writeLastEnvelopeSync signature + payload). |
| `src/core/recovery/last-envelope.ts` | `writeLastEnvelope` async accepts `id` (defaulted to `randomUUID()`) + optional `auditRef`; conditional spread for omit-on-undefined | ✓ VERIFIED | Lines 64-90 — `id: string = randomUUID()` line 69, `auditRef?: string` line 70, `...(auditRef !== undefined && { audit_ref: auditRef })` line 77. |
| `src/core/audit/integration-helper.ts` | `AuditOutcome.recovery_ref?: string`; `writeAuditEntry` returns `Promise<string \| null>`; uses `'success' in result` discriminator (L5) | ✓ VERIFIED | Line 60 (`recovery_ref?: string`), line 76 (return type), line 107 (conditional spread of `recovery_ref` onto entry), line 114 (`'success' in result ? result.id : null`). |
| `src/core/audit/types.ts` | `AuditEntryBrief` exported as `Pick` over `AuditEntry` with exactly 5 keys | ✓ VERIFIED | Line 41 — `Pick<AuditEntry, 'id' \| 'ts' \| 'command' \| 'target' \| 'success'>`. Forbidden keys excluded by `Pick`. |
| `src/core/audit/recent.ts` | `RECENT_AUDIT_DEFAULT_N = 5`, `shouldEmbedRecent`, `loadRecentAudit` exported; `include_rotated: true`; never throws (catch → `[]`) | ✓ VERIFIED | Line 14 (constant = 5), 21-23 (shouldEmbedRecent), 40-54 (loadRecentAudit with `include_rotated: true` on line 49 and `} catch { return [] }` on lines 51-53). |
| `src/core/inspect/types.ts` | `InspectSnapshot.audit_recent?: AuditEntryBrief[]` trailing optional field; `INSPECT_SCHEMA_VERSION` unchanged | ✓ VERIFIED | Line 2 import, line 77 field. Schema version untouched. |
| `src/core/guide/types.ts` | `GuideSnapshot.audit_recent?: AuditEntryBrief[]` at TOP level (not inside `context`); `GUIDE_SCHEMA_VERSION` unchanged | ✓ VERIFIED | Line 2 import, line 73 field. Top-level placement confirmed by grep. |
| `src/commands/inspect.ts` | D-J catch block: pre-gen envelopeId, recovery_ref spread, capture auditId, pass envelopeId + auditRef to emit. DOCS-02 injection between collectInspect and renderJson. | ✓ VERIFIED | Catch lines 77-105 matches PATTERNS.md section 8. DOCS-02 injection lines 59-65. |
| `src/commands/query.ts` | D-J catch block with table-name context preserved; 3 typed-error branches preserved AFTER emit | ✓ VERIFIED | Catch lines 165-204 (envelopeId line 168, auditRef line 191, extractTableName preserved, all 3 typed-error branches still present per grep). |
| `src/commands/guide.ts` | DOCS-02 injection at top-level `snap.audit_recent`; NO `emitRecoveryEnvelope`, NO D-J patch | ✓ VERIFIED | Lines 83-87 inject `snap.audit_recent`. Grep `emitRecoveryEnvelope` in guide.ts returns 0 lines. |
| `src/commands/recover.ts` | Lazy config + audit_recent load gated by `format === 'json' && options.next !== true`; two print-site `JSON.stringify({...source.envelope, audit_recent})` and `{...result, audit_recent}` wraps; NO `writeAuditEntry` (F1) | ✓ VERIFIED | Lines 255-271 (hoisted load), 287 (no-apply wrap), 307 (apply wrap). Grep `writeAuditEntry` in recover.ts returns 0 lines (F1 lock confirmed). `--next` branch (lines 273-278) untouched. |
| `tests/integration/recovery-audit-link.test.ts` | New release-blocking contract test ≥200 lines, 6 describe blocks | ✓ VERIFIED | 410 lines, 6 describe blocks, 19 tests / 0 fail. Re-run during verification: green. |
| `tests/integration/audit-show-health.test.ts` | UUID-style `KNOWN_RECOVERY_REF` fixture (RESEARCH M) | ✓ VERIFIED | Line 79: `const KNOWN_RECOVERY_REF = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'` — RFC 4122 example UUID. |
| `25-J1-COVERAGE-MATRIX.md` | Standalone coverage matrix, all 14 commands, Phase 23-04 follow-up section | ✓ VERIFIED | 78 lines, 14 command rows in the matrix table, Phase 23-04 referenced 5 times. |
| `.planning/STATE.md` | Phase 23-04 follow-up bullet under Accumulated Context; Phase 25 marked as shipped 2026-05-16 | ✓ VERIFIED | Line 32 (Status: Phase 25 shipped 2026-05-16 with J1), line 168 ("Phase 25 J1 asymmetry" Accumulated Context bullet). |
| `25-VALIDATION.md` | Frontmatter `status: approved`, `nyquist_compliant: true`, `wave_0_complete: true` | ✓ VERIFIED | All three flags set; 11 sign-off `- [x]` checkboxes. |

All 17 artifacts verified at Levels 1+2 (exist, substantive), Level 3 (wired via imports/usage), and Level 4 (data flows through to user-visible output per the empirical spot-check above).

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| inspect.ts catch block | core/recovery/emit.ts `emitRecoveryEnvelope({envelopeId, auditRef})` | inline dynamic import + options object | ✓ WIRED | Lines 92-101: `emitRecoveryEnvelope(err, { operation: 'inspect' }, { envelopeId, auditRef: auditId ?? undefined })` |
| query.ts catch block | core/recovery/emit.ts | same template + extractTableName context | ✓ WIRED | Lines 181-193 — operation: 'query', envelopeId, auditRef present |
| inspect.ts catch block | integration-helper.ts `writeAuditEntry(...)` returning entry id | discriminator-based return | ✓ WIRED | Lines 84-89: `auditId = await writeAuditEntry(config, 'inspect', options, { ..., ...(envelopeId && { recovery_ref: envelopeId }) })` |
| inspect.ts happy path | core/audit/recent.ts `loadRecentAudit` | dynamic import after `requireSchemaCacheOrThrow` | ✓ WIRED | Lines 59-65 — gated by `shouldEmbedRecent` |
| guide.ts happy path | core/audit/recent.ts `loadRecentAudit` | dynamic import; top-level placement | ✓ WIRED | Lines 84-87 — `snap.audit_recent` (top-level, NOT `snap.context.audit_recent`) |
| recover.ts no-apply branch | core/audit/recent.ts + print-site wrap | hoisted variable + JSON.stringify spread | ✓ WIRED | Lines 258-270 (load), 287 (wrap) |
| recover.ts --apply branch | same | same | ✓ WIRED | Line 307: `JSON.stringify({ ...result, audit_recent }, null, 2)` |
| emit.ts writeLastEnvelopeSync | apply-types.ts SavedRecoveryEnvelope wrapper | persisted payload literal | ✓ WIRED | Lines 58-66 — `id` always, `audit_ref` conditional |
| recovery-audit-link.test.ts | src/cli.ts | spawn-subprocess via `bun run` | ✓ WIRED | Lines 47-59 (`run` helper); 19/19 tests pass against the live CLI |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| Inspect failure envelope (`<cwd>/.dbcli/last-recovery.json`) | `id`, `audit_ref` | `crypto.randomUUID()` (envelope id) + `writeAuditEntry` return value (audit id) | YES — observed UUIDs `d51d1844-...` and `54a8d49b-...` matching in both directions | ✓ FLOWING |
| Inspect failure audit entry (JSONL) | `recovery_ref`, `id` | `outcome.recovery_ref` (== pre-generated envelopeId) + logger's `crypto.randomUUID()` | YES — both UUIDs present in JSONL on disk | ✓ FLOWING |
| `inspect --for-agent` JSON | `audit_recent` | `loadRecentAudit(config, configPath)` reads `.dbcli/audit/default.jsonl` via reader | YES — observed `"audit_recent": []` at top level (D-60 fall-through; contract test seeds entries to exercise the populated path) | ✓ FLOWING |
| `guide --for-agent` JSON | top-level `audit_recent` | same helper; injected at top level (not `snap.context.audit_recent`) | YES — contract test green | ✓ FLOWING |
| `recover --format json` JSON | `audit_recent` | hoisted load → `{ ...source.envelope, audit_recent }` | YES — contract test seeds `last-recovery.json` and asserts | ✓ FLOWING |
| `recover --apply` JSON | `audit_recent` | hoisted load → `{ ...result, audit_recent }` | YES — contract test exercises this | ✓ FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Bi-directional ref round-trip via inspect | `bun run src/cli.ts --config <tmpdir> inspect --require-schema-cache --recovery --no-connect` | Envelope `id="d51d1844-..."` and `audit_ref="54a8d49b-..."`; audit entry `id="54a8d49b-..."` and `recovery_ref="d51d1844-..."` — both UUIDs match in both directions | ✓ PASS |
| DOCS-02 audit_recent embedding in inspect JSON | `bun run src/cli.ts --config <tmpdir> inspect --for-agent --no-connect` | JSON has top-level `audit_recent: []` (empty due to D-60 fall-through; field shape correct) | ✓ PASS |
| Phase 25 contract test re-run | `bun test tests/integration/recovery-audit-link.test.ts` | 19 pass / 0 fail / 43 expect() calls / 5.21s | ✓ PASS |
| J1 asymmetry — 6 unwired commands lack writeAuditEntry/audit_ref | `grep -nE "writeAuditEntry\|recovery_ref\|envelopeId\|auditRef" src/commands/{insert,update,delete,export,q,schema}.ts` | All 6 files emit envelope only; ZERO matches for any audit-side keyword | ✓ PASS |
| F1 — recover does NOT self-audit | `grep -n "writeAuditEntry" src/commands/recover.ts` | No matches | ✓ PASS |
| L3 — cli.ts outer catches untouched | `grep -cE "envelopeId\|auditRef" src/cli.ts` | 0 matches (outer catch not modified) | ✓ PASS |
| D-52 — RecoveryEnvelope body type untouched | Read `src/core/recovery/types.ts` — `RecoveryEnvelope` carries no `id` / `audit_ref` | Confirmed: only `SavedRecoveryEnvelope` wrapper got new fields; body type unchanged | ✓ PASS |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| INTEGRATE-02 | 25-01, 25-02, 25-04, 25-05, 25-08, 25-09 | Command 失敗時，audit entry 的 `recovery_ref` 指向 `.dbcli/last-recovery.json` (含 envelope id) | ✓ SATISFIED | Truth #1 verified empirically. Plan 02 writes `recovery_ref` onto entry; Plan 04 emits envelope with `id`; Plan 05 wires them via inspect.ts + query.ts catch blocks. |
| INTEGRATE-03 | 25-01, 25-04, 25-05, 25-08, 25-09 | Recovery envelope 增加 `audit_ref` 欄位，反向指向觸發它的 audit entry id | ✓ SATISFIED | Truth #2 verified empirically. Plan 01 adds `audit_ref?` to SavedRecoveryEnvelope wrapper; Plan 04 persists it conditionally; Plan 05 supplies it from awaited writeAuditEntry return value (via D-K signature). |
| DOCS-02 | 25-03, 25-06, 25-07, 25-08, 25-09 | inspect / guide / recover / recover --apply 在 agent guide 輸出自動引用 recent audit | ✓ SATISFIED | Truth #3 verified empirically. Plan 03 ships shared helper (`shouldEmbedRecent`, `loadRecentAudit`, `AuditEntryBrief`). Plan 06 injects in inspect + guide. Plan 07 wraps recover's two JSON print sites. Contract test exercises all 4 surfaces. |

REQUIREMENTS.md traceability table at `.planning/REQUIREMENTS.md:135-142` still shows these IDs as "Pending" — this is a documentation lag, not a behavior gap. The actual code-level requirements are satisfied; the table is updated during Phase 26 docs / release-gate work per project convention.

No orphaned requirements: all phase plan frontmatters declare only the three IDs in the phase scope.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/commands/inspect.ts` | 36 | `let config: any` | ℹ️ Info | Pre-existing weak typing on the `config` variable; not a Phase 25 regression. Outside Phase 25 scope. |
| `tests/integration/recovery-audit-link.test.ts` | 71-93 | `readAuditEntries` probes for two audit file layouts (`.dbcli/audit/default.jsonl` vs `.dbcli/.dbcli/audit/default.jsonl`) | ⚠️ Warning | Documents (and works around) a pre-existing inspect.ts bug: the catch block's `writeAuditEntry` call passes the subcommand-local `options` (which lacks `--config` since only the parent program declares it), so the audit logger falls back to relative `.dbcli` path, producing nested `.dbcli/.dbcli/audit/...`. Documented in 25-08-SUMMARY.md as "pre-existing bug, fix belongs in a follow-up." NOT a Phase 25 regression. |

No blocker anti-patterns found. The two items above are documented and intentional pragmatic workarounds.

---

## Human Verification Required

Two items intentionally deferred to human verification per the phase's own VALIDATION.md "Manual-Only Verifications" section:

### 1. Agent ergonomics — LLM client consumes `audit_recent` correctly

**Test:** Trigger a failed `dbcli query --recovery` in a real session, then ask an LLM agent (via the dbcli CLI) to interpret the resulting JSON. Confirm the agent successfully joins `envelope.audit_ref → entry.id` from the embedded `audit_recent` list and produces a forensics narrative that names the failing command.

**Expected:** Agent emits a chain-of-evidence summary referencing both the recovery envelope and the matching audit entry by id.

**Why human:** Behavioral / UX check — automated tests can confirm the data is on the wire; only a human session can confirm an agent actually uses it well. VALIDATION.md explicitly flags this as Manual-Only.

### 2. Skill markdown rendering of the new `audit_recent` block

**Test:** Run `bun run src/cli.ts inspect --for-agent` in a workspace with seeded audit entries; visually inspect the JSON layout in a code editor.

**Expected:** Field placement / readability matches the agent-facing shape Phase 26 docs will describe.

**Why human:** Visual / doc layout — Phase 26 will codify the SKILL.md update; this is a forward-look smoke test to catch any obvious layout issues before Phase 26 starts.

---

## Gaps Summary

No release-blocking gaps. The phase shipped feature-complete with:

- All 4 ROADMAP success criteria verified (4/4)
- All 17 plan must-have artifacts present at Levels 1+2+3+4
- All 9 key links wired
- Release gate documented green (2438 pass / 3 skip / 0 fail per 25-09-SUMMARY)
- Contract test re-confirmed during verification (19/19 pass)
- Empirical end-to-end spot-check confirms bi-directional UUIDs match in both directions

The J1 asymmetry (6 unwired commands emit envelopes without `audit_ref`) is **intentional scope, not a gap**. It is:
- Documented in CONTEXT.md Scope Addendum (J1 chosen over J2 / J3)
- Captured as a standalone deliverable in `25-J1-COVERAGE-MATRIX.md`
- Defended by a parameterized contract test that fails if any of the 6 commands silently flips into the wired surface
- Recorded as Phase 23-04 follow-up in STATE.md Accumulated Context (line 168)

The REQUIREMENTS.md traceability table showing "Pending" for the three requirements is a documentation-lag artifact, not a behavior gap. Updating it is part of Phase 26's docs work (the standard pattern). Actual code-level requirements are satisfied and contractually defended by the release-blocking contract test.

---

*Verified: 2026-05-16T14:50:00Z*
*Verifier: Claude (gsd-verifier)*
