---
phase: 25
plan: 05
status: complete
completed: 2026-05-16
requirements: [INTEGRATE-02, INTEGRATE-03]
key-files:
  modified:
    - src/commands/inspect.ts
    - src/commands/query.ts
  created:
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-05-SUMMARY.md
---

# 25-05 SUMMARY — wire J1 catch blocks (inspect + query)

## What shipped

The D-J template from PATTERNS.md is applied verbatim to the two J1 catch blocks. After this plan, a failing `dbcli query --recovery` or `dbcli inspect --recovery` produces:

- An audit entry with `recovery_ref === envelope.id`
- A `.dbcli/last-recovery.json` with `id === audit_entry.recovery_ref` AND `audit_ref === audit_entry.id`

ROADMAP success criteria #1/#2 (the bi-directional ref between audit entry and recovery envelope) are now satisfied for these two surfaces. Plan 08 will lock the contract.

### `src/commands/inspect.ts` (catch block)

```ts
} catch (err) {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID() // Phase 25 D-51 / D-J
  }
  if (config) {
    auditId = await writeAuditEntry(config, 'inspect', options, {
      success: false,
      target: '*',
      error: err,
      ...(envelopeId && { recovery_ref: envelopeId }),
    })
  }
  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(
      err,
      { operation: 'inspect' },
      { envelopeId, auditRef: auditId ?? undefined }
    )
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

### `src/commands/query.ts` (catch block)

Same template with `operation: 'query'` and the `extractTableName(sql)` context preserved. The three typed-error branches (BlacklistError / PermissionError / ConnectionError) are kept verbatim AFTER the emit block — they run iff `--recovery` is off (emit calls `process.exit()` first when `--recovery` is on).

## L3 + J1 scope locks observed

**L3 — cli.ts outer catches NOT modified** (`git diff --name-only HEAD~1` returns only `src/commands/inspect.ts` and `src/commands/query.ts`; `cli.ts` is unchanged). The outer cli.ts catch is an unreachable safety net; modifying it would risk a double-emit per RESEARCH §L3.

**J1 — 6 unwired commands NOT touched** (verified: `grep -c envelopeId src/commands/{insert,update,delete,export,q,schema}.ts` returns 0 for all six). Those commands continue to emit a single-direction envelope only; their audit-side write is deferred to Phase 23-04 follow-up. Plan 08's J1 asymmetry guard test will assert this scope lock by failing if any of these six files starts producing an envelope with `audit_ref`.

## Ordering invariant

The catch block is structured so that:
1. `envelopeId` is pre-generated FIRST (only when `--recovery` is on).
2. `writeAuditEntry` runs SECOND with `recovery_ref: envelopeId` in `outcome`.
3. `emitRecoveryEnvelope` runs LAST with `auditRef: auditId ?? undefined`.

Step 3 calls `process.exit()` synchronously, so any code after the emit block (typed-error rendering, default stderr message) only runs when `--recovery` is off. That's the existing UX and it is preserved.

## Tests

No new unit/integration test files in this plan — Plan 08 is the dedicated contract test for the bi-directional ref round-trip. Regression coverage exercised inline:

- `bun test tests/integration/inspect.test.ts tests/integration/recovery.test.ts tests/integration/commands/query.test.ts tests/unit/commands/query.test.ts` → 68 pass / 0 fail
- `bun run typecheck` → exit 0

## Hand-off

- **Plan 08 (contract test)**: round-trips a real failing `dbcli query` and `dbcli inspect` invocation, asserts `audit_entry.recovery_ref === envelope.id` AND `envelope.audit_ref === audit_entry.id`. ALSO asserts the J1 asymmetry guard: any of the 6 unwired commands producing an envelope MUST NOT carry `audit_ref`.
- **Phase 23-04 (backlog)**: wire `writeAuditEntry` into the 6 unwired catch blocks. After that, Phase 25's J1 lock can be retired.

## Self-Check: PASSED

- [x] `crypto` imported in both `inspect.ts` and `query.ts`.
- [x] Catch blocks pre-generate `envelopeId` only on `--recovery`.
- [x] `writeAuditEntry` receives `recovery_ref: envelopeId` via conditional spread.
- [x] `emitRecoveryEnvelope` receives `envelopeId` and `auditRef: auditId ?? undefined`.
- [x] Typed-error rendering in `query.ts` preserved verbatim.
- [x] `cli.ts` outer catches NOT modified (L3 respected).
- [x] 6 unwired commands NOT modified (J1 respected).
- [x] `bun run typecheck` exits 0.
