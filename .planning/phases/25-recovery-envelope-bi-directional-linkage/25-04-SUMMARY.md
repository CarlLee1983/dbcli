---
phase: 25
plan: 04
status: complete
completed: 2026-05-16
requirements: [INTEGRATE-02, INTEGRATE-03]
key-files:
  created:
    - tests/unit/core/recovery/emit.test.ts
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-04-SUMMARY.md
  modified:
    - src/core/recovery/emit.ts
    - src/core/recovery/last-envelope.ts
---

# 25-04 SUMMARY — emit envelope id + audit_ref

## What shipped

Both recovery-envelope writers now accept and persist the new wrapper fields shipped in Plan 01.

### `emit.ts` (sync, exit-on-emit path)

`EmitOptions` gains `envelopeId?: string` (D-51) and `auditRef?: string` (D-53). `emitRecoveryEnvelope` pre-generates the envelope id via `crypto.randomUUID()` at entry when `options.envelopeId` is omitted. Caller-supplied ids are persisted verbatim. The private `writeLastEnvelopeSync` helper now takes `id` and `auditRef` as positional args and builds the on-disk payload as:

```ts
const payload: SavedRecoveryEnvelope = {
  schemaVersion: 1,
  id,
  ...(auditRef !== undefined && { audit_ref: auditRef }),  // D-53 conditional spread
  savedAt: new Date().toISOString(),
  command: sanitizeCommandSummary(argv),
  cwd,
  envelope,
}
```

`process.exit()` semantics are preserved (sync write, then sync exit — D-51 forbids restructuring).

### `last-envelope.ts` (async sibling)

`writeLastEnvelope` gains two trailing params: `id: string = randomUUID()` and `auditRef?: string`. Default for `id` is a UUID so existing test callers (which pass only `cwd, envelope, argv, now`) keep working unmodified. `auditRef` is omitted from JSON when undefined — same conditional-spread pattern as the sync sibling.

### D-52 boundary preserved

The stdout JSON produced by `renderJson(envelope, …)` still operates on the inner `RecoveryEnvelope` body. It does NOT gain `id` / `audit_ref` keys — those live on the on-disk `SavedRecoveryEnvelope` wrapper only. Test 5 asserts this explicitly.

## Tests

`tests/unit/core/recovery/emit.test.ts` (new), 8 cases across 2 describe blocks:

**`emitRecoveryEnvelope id + audit_ref (Phase 25 D-51 / D-53)` — 5 subprocess tests**
1. `id` is a UUID v4 when `envelopeId` omitted.
2. Caller-supplied `envelopeId` is persisted verbatim.
3. `audit_ref` is persisted when supplied.
4. `audit_ref` key is OMITTED from JSON when `auditRef` is undefined.
5. Stdout JSON body shape unchanged (D-52) — `id` / `audit_ref` absent from stdout.

**`writeLastEnvelope id + audit_ref (Phase 25 K1)` — 3 in-process tests**
6. Default `id` is UUID v4 when arg omitted; no `audit_ref` on disk.
7. Explicit `id` + `auditRef` are both persisted.
8. `auditRef === undefined` → on-disk `audit_ref` key absent.

Final: `bun test tests/unit/core/recovery/emit.test.ts` → 8 pass / 0 fail. `bun test tests/unit/core/recovery/ tests/unit/recovery/ tests/integration/recovery.test.ts` → 294 pass / 0 fail. `bun run typecheck` exits 0.

## Hand-off

- **Plan 05 (catch-block wiring)**: pre-generate envelope id at catch entry, call `writeAuditEntry(..., { ..., recovery_ref: envelopeId })`, capture the returned audit id, then call `emitRecoveryEnvelope(err, ctx, { envelopeId, auditRef: auditId ?? undefined })`. The bi-directional ref is then captured atomically on both sides.
- **Plan 08 (contract test)**: round-trips a real `query` failure through this path and asserts `audit_entry.recovery_ref === envelope.id` AND `envelope.audit_ref === audit_entry.id`.

## Self-Check: PASSED

- [x] `EmitOptions.envelopeId?` and `EmitOptions.auditRef?` declared.
- [x] `emitRecoveryEnvelope` pre-generates UUID when `envelopeId` absent; persists it as `id` on disk.
- [x] `writeLastEnvelopeSync` and `writeLastEnvelope` both conditional-spread `audit_ref` (omit when undefined).
- [x] D-52 stdout body unchanged — `renderJson` still passes `envelope` (not `payload`).
- [x] `process.exit()` preserved (D-51).
- [x] 8 new unit tests pass; 294 recovery tests pass total.
- [x] `bun run typecheck` exits 0.
