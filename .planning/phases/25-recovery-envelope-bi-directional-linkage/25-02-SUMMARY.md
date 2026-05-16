---
phase: 25
plan: 02
status: complete
completed: 2026-05-16
requirements: [INTEGRATE-02]
key-files:
  created:
    - tests/unit/core/audit/integration-helper.test.ts
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-02-SUMMARY.md
  modified:
    - src/core/audit/integration-helper.ts
---

# 25-02 SUMMARY — writeAuditEntry id-return + recovery_ref pass-through

## What shipped

`writeAuditEntry` now returns the persisted audit entry id (or `null`), and `AuditOutcome` carries an optional `recovery_ref` that gets written onto the entry. This is the wire that Plan 05's catch blocks ride to attach `recovery_ref` and capture the audit id back for envelope `audit_ref`.

### `AuditOutcome` (D-J)

```ts
export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
  /** Phase 25 D-J */
  recovery_ref?: string
}
```

When `outcome.recovery_ref` is present it is spread onto the persisted entry verbatim — no redaction applied (RESEARCH §8: the value is an opaque `crypto.randomUUID()`, not user text). When absent, the `recovery_ref` key is omitted from the JSONL row entirely (matches the existing conditional-spread style for `redacted_sql` and `error`).

### Return-type widening (D-K / L5)

```ts
async function writeAuditEntry(...): Promise<string | null>
```

The id-or-null discriminator uses `'success' in result` (NOT `result.success`) per the L5 narrowing rule — the skipped variants of `AuditWriteResult` don't have a `.success` property, so a `.success` access would be a strict-mode type error.

Branches:
- `{ success: true, id, rotated }` → return `id`
- `{ skipped: 'disabled' | 'lock-budget-exhausted' | 'write-failed' }` → return `null`
- thrown internal (logger / capability / redaction failure) → return `null` via the D6 catch

## 17 existing callers — backward compat

Existing call sites (`src/commands/{inspect,query,guide,plan,doctor,report,audit}.ts`, `src/core/query-executor.ts`, plus their integration test) drop the return value of `await writeAuditEntry(...)`. TypeScript permits dropping a `Promise<T>` return, so widening from `Promise<void>` → `Promise<string | null>` is non-breaking. `bun run typecheck` exits 0 with the change in place.

## Tests

`tests/unit/core/audit/integration-helper.test.ts` (new), 5 cases under `describe('writeAuditEntry return value (Phase 25 D-K)')`:

1. **Success returns UUID** — `expect(id).toMatch(/^[0-9a-f-]{36}$/)`.
2. **Disabled returns null** — `audit.enabled = false` → `id === null`.
3. **`recovery_ref` persists on disk** — pass a UUID via `outcome.recovery_ref`; read back from `<workDir>/.dbcli/audit/default.jsonl`; the entry has `recovery_ref` equal to the value supplied.
4. **`recovery_ref` omitted when not supplied** — entry on disk does NOT have a `recovery_ref` key (`'recovery_ref' in last === false`).
5. **Return-ignoring callers still work** — the test calls `await writeAuditEntry(...)` without capturing the return, asserting nothing throws. This is the backward-compat guard for the 17 pre-Phase-25 sites.

Final: `bun test tests/unit/core/audit/integration-helper.test.ts` → 5 pass / 0 fail. `bun test tests/unit/core/audit/` → 63 pass / 0 fail (no regression in lock / logger / reader / rotation / session-id). `bun run typecheck` exits 0.

## Hand-off

- **Plan 05 (`inspect.ts` + `query.ts` catch blocks)**: `const auditId = await writeAuditEntry(config, cmd, options, { success: false, error, recovery_ref: envelopeId })` and feed `auditId` into `emitRecoveryEnvelope(..., { auditRef: auditId ?? undefined })`.
- **Plan 04 (`emit.ts`)**: pre-generates the envelope `id` that gets passed as `recovery_ref` on the audit side.
- **Plan 08 (contract test)**: round-trips both directions — audit entry's `recovery_ref` should equal envelope's `id`; envelope's `audit_ref` should equal audit entry's `id`.

## Self-Check: PASSED

- [x] `AuditOutcome.recovery_ref?: string` declared.
- [x] `writeAuditEntry` returns `Promise<string | null>` and uses `'success' in result` discriminator.
- [x] `recovery_ref` spread is conditional and unredacted.
- [x] 5 new unit tests pass.
- [x] 17 existing callers continue to compile and run.
- [x] `bun run typecheck` exits 0; `bun test tests/unit/core/audit/` exits 0.
