---
phase: 25
plan: 01
status: complete
completed: 2026-05-16
requirements: [INTEGRATE-02, INTEGRATE-03]
key-files:
  created:
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-01-SUMMARY.md
  modified:
    - src/core/recovery/apply-types.ts
    - src/core/recovery/envelope-schema.ts
    - tests/unit/core/recovery/envelope-schema.test.ts
---

# 25-01 SUMMARY — Envelope Wrapper Schema

## What shipped

Extended the on-disk `SavedRecoveryEnvelope` wrapper with two optional fields that carry the bi-directional ref to audit:

- `id?: string` — envelope-level UUID v4, pre-generated at `emitRecoveryEnvelope()` entry (D-50/D-51). Consumed by Plan 04.
- `audit_ref?: string` — id of the audit entry that recorded the failure (D-53). Consumed by Plan 04/05 via the J1 catch blocks on `inspect.ts` + `query.ts`.

Both fields are optional, placed between `schemaVersion: 1` and `savedAt: string`. The `RecoveryEnvelope` body in `src/core/recovery/types.ts` is untouched (D-52). `RECOVERY_SCHEMA_VERSION` and the `schemaVersion: 1` literal are unchanged (no bump per D-52).

The zod parser (`savedRecoveryEnvelopeSchema`) gains matching `.optional()` entries while keeping `.strict()` — so unknown extra keys (other than `id` / `audit_ref`) are still rejected. `parseSavedRecoveryEnvelope` round-trips the new shape unchanged.

## Tests

Added a new `describe('SavedRecoveryEnvelope id + audit_ref (Phase 25)', …)` block in `tests/unit/core/recovery/envelope-schema.test.ts` with four cases:

1. **New shape parses** — payload with both `id` and `audit_ref` returns `{ok: true}` and the fields survive parse.
2. **Legacy shape parses** — payload WITHOUT `id`/`audit_ref` still returns `{ok: true}`; both fields read back as `undefined`. This is the D-54 backward-compat guard for v1.17–v1.19 envelopes on disk.
3. **`.strict()` preserved** — payload with an unknown extra key `unknownField` is rejected (`{ok: false}`).
4. **Type-safety guard** — payload with `id: 42` (number, not string) is rejected.

Final: `bun test tests/unit/core/recovery/envelope-schema.test.ts` → 9 pass / 0 fail (5 existing + 4 new). `bun run typecheck` exits 0.

## D-52 boundaries respected

- `recoveryEnvelopeSchema` (inner body) unchanged.
- `parseRecoveryEnvelope` unchanged.
- `RECOVERY_SCHEMA_VERSION` (in `src/core/recovery/types.ts`) still `1`.
- `SavedRecoveryEnvelope.schemaVersion` literal stays `1`.

## Hand-off

- **Plan 04 (`emit.ts`)**: consumes the new shape. Pre-generates UUID for `id`, accepts `audit_ref` via `writeLastEnvelope*(envelope, {id, auditRef})`.
- **Plan 08 (contract test)**: round-trips this shape via `dbcli recover --from <file>` and asserts both fields survive disk + parse.
- **D-54 back-compat** is locked in here — any caller that writes a legacy envelope (no id/audit_ref) still parses on read.

## Self-Check: PASSED

- [x] SavedRecoveryEnvelope declares `id?: string` and `audit_ref?: string` between `schemaVersion: 1` and `savedAt: string`.
- [x] savedRecoveryEnvelopeSchema declares both as `.optional()`, retains `.strict()`.
- [x] 4 new unit tests pass.
- [x] No changes to RecoveryEnvelope body / RECOVERY_SCHEMA_VERSION / schemaVersion literal.
- [x] `bun run typecheck` exits 0.
