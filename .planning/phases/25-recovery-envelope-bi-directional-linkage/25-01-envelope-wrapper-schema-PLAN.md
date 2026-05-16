---
phase: 25
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/recovery/apply-types.ts
  - src/core/recovery/envelope-schema.ts
  - tests/unit/core/recovery/envelope-schema.test.ts
autonomous: true
requirements: [INTEGRATE-02, INTEGRATE-03]
must_haves:
  truths:
    - "SavedRecoveryEnvelope TypeScript interface declares optional id and audit_ref fields"
    - "parseSavedRecoveryEnvelope accepts new envelopes with id + audit_ref"
    - "parseSavedRecoveryEnvelope accepts legacy envelopes that lack id + audit_ref (D-54 backward compat)"
    - "RECOVERY_SCHEMA_VERSION and SavedRecoveryEnvelope.schemaVersion remain 1 (D-52 - no bump)"
    - "RecoveryEnvelope body shape (src/core/recovery/types.ts) is untouched (D-52)"
  artifacts:
    - path: "src/core/recovery/apply-types.ts"
      provides: "SavedRecoveryEnvelope with id?: string + audit_ref?: string optional fields"
      contains: "id?: string"
    - path: "src/core/recovery/envelope-schema.ts"
      provides: "savedRecoveryEnvelopeSchema with id/audit_ref as .optional() under .strict()"
      contains: "id: z.string().optional()"
    - path: "tests/unit/core/recovery/envelope-schema.test.ts"
      provides: "unit tests asserting both legacy and new envelope shapes parse"
      contains: "audit_ref"
  key_links:
    - from: "src/core/recovery/envelope-schema.ts"
      to: "src/core/recovery/apply-types.ts"
      via: "type SavedRecoveryEnvelope (zod parser must round-trip the TS interface)"
      pattern: "id: z\\.string\\(\\)\\.optional\\(\\)"
---

<objective>
Extend the on-disk recovery envelope wrapper (`SavedRecoveryEnvelope`) with two new optional wrapper-level fields - `id` (UUID v4 envelope id, D-50) and `audit_ref` (UUID of the audit entry that recorded the failure, D-53) - and the corresponding zod parser so the on-disk file can carry the new fields without breaking legacy envelopes.

Purpose: Phase 25's bi-directional ref between audit entries and saved recovery envelopes lives on the wrapper, not on the `RecoveryEnvelope` body (D-52). This plan is Wave 1 type-plumbing that unblocks Plan 04 (emit.ts uses the new shape) and Plan 08 (contract test).

Output: SavedRecoveryEnvelope interface + zod schema updated; unit test added covering legacy AND new envelope parse cases.
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
@src/core/recovery/apply-types.ts
@src/core/recovery/envelope-schema.ts

<interfaces>
Current SavedRecoveryEnvelope (src/core/recovery/apply-types.ts:94-101):
```ts
export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  savedAt: string
  command: string
  cwd: string
  envelope: RecoveryEnvelope
}
```

Current zod schema (src/core/recovery/envelope-schema.ts:64-72):
```ts
export const savedRecoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    savedAt: z.string().min(1),
    command: z.string(),
    cwd: z.string().min(1),
    envelope: recoveryEnvelopeSchema,
  })
  .strict()
```

Note: `.strict()` rejects unknown keys. Both the TS interface AND the zod schema must declare the new fields, or new envelopes (with `id` / `audit_ref`) will be rejected at parse time (RESEARCH L7).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend SavedRecoveryEnvelope interface with optional id + audit_ref</name>
  <read_first>
    - src/core/recovery/apply-types.ts (lines 94-101, the SavedRecoveryEnvelope interface)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 1, exact target shape)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-50, D-52, D-53)
  </read_first>
  <files>src/core/recovery/apply-types.ts</files>
  <behavior>
    - Adding `id?: string` and `audit_ref?: string` fields to `SavedRecoveryEnvelope` is a purely additive type change.
    - `schemaVersion` field stays `1` (D-52, no bump).
    - Field placement: insert both new fields directly after `schemaVersion` and before `savedAt`.
    - Existing callers that build `SavedRecoveryEnvelope` literals without the new fields must still typecheck (because the fields are optional).
  </behavior>
  <action>
Open `src/core/recovery/apply-types.ts` and modify the `SavedRecoveryEnvelope` interface declared at lines 94-101.

Insert two new optional fields immediately after `schemaVersion: 1` and before `savedAt: string`:

```ts
export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  /** Phase 25 D-50/D-51: envelope-level UUID, pre-generated at emitRecoveryEnvelope() entry. Optional for backward compatibility with v1.17-v1.19 envelopes. */
  id?: string
  /** Phase 25 D-53: ID of the audit entry that recorded this failure. Omitted when audit is disabled or write failed (best-effort). */
  audit_ref?: string
  savedAt: string
  /** Sanitized command summary. Never a verbatim argv dump. */
  command: string
  cwd: string
  envelope: RecoveryEnvelope
}
```

Do NOT touch `RecoveryEnvelope` (in `src/core/recovery/types.ts`) - D-52 forbids it. Do NOT bump `schemaVersion`. Do NOT modify `ApplyResult` (apply-render-json injection lives at the caller per Plan 07).

Run `bun run typecheck` to verify no existing call site breaks (writeLastEnvelope / writeLastEnvelopeSync construct SavedRecoveryEnvelope literals; they will still typecheck because new fields are optional).
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-01-t1.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-01-t1.log | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "id\\?: string" src/core/recovery/apply-types.ts` returns a line inside the `SavedRecoveryEnvelope` interface (between `schemaVersion: 1` and `savedAt: string`).
    - `grep -nE "audit_ref\\?: string" src/core/recovery/apply-types.ts` returns a line inside the `SavedRecoveryEnvelope` interface.
    - `grep -nE "schemaVersion: 1" src/core/recovery/apply-types.ts` still returns the SavedRecoveryEnvelope literal (no bump to 2).
    - `grep -nE "RECOVERY_SCHEMA_VERSION" src/core/recovery/types.ts` shows the version is unchanged (still `1`).
    - `bun run typecheck` exits 0 (no new TS errors).
  </acceptance_criteria>
  <done>
    SavedRecoveryEnvelope interface declares `id?: string` and `audit_ref?: string` exactly between `schemaVersion: 1` and `savedAt: string`. TypeScript compiles without new errors. RecoveryEnvelope and RECOVERY_SCHEMA_VERSION are untouched.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend zod savedRecoveryEnvelopeSchema and add unit tests covering legacy + new envelope parsing</name>
  <read_first>
    - src/core/recovery/envelope-schema.ts (lines 64-72, current schema; lines 95-99, parseSavedRecoveryEnvelope)
    - tests/unit/core/recovery/envelope-schema.test.ts (existing test file - examine how existing tests assert on legacy envelopes)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 2, exact target schema)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (L7 - `.strict()` interaction)
  </read_first>
  <files>
    src/core/recovery/envelope-schema.ts,
    tests/unit/core/recovery/envelope-schema.test.ts
  </files>
  <behavior>
    Test cases to add (RED first):
    - `parseSavedRecoveryEnvelope` returns `{ ok: true }` for a payload that has `id: '<UUID>'` and `audit_ref: '<UUID>'`, and the returned `value` exposes both fields.
    - `parseSavedRecoveryEnvelope` returns `{ ok: true }` for a payload WITHOUT `id` and WITHOUT `audit_ref` (legacy envelope, D-54 backward compat). The returned `value.id` is `undefined` and `value.audit_ref` is `undefined`.
    - `parseSavedRecoveryEnvelope` returns `{ ok: false }` when an unknown extra key is present (the `.strict()` modifier still rejects unknown keys other than `id` / `audit_ref`).
    - `parseSavedRecoveryEnvelope` returns `{ ok: false }` when `id` is present but not a string (e.g. `id: 42`).
  </behavior>
  <action>
**Step A - extend the zod schema in `src/core/recovery/envelope-schema.ts`:**

Modify the `savedRecoveryEnvelopeSchema` declaration at lines 64-72 to insert `id` and `audit_ref` as `.optional()` fields, placed BEFORE `savedAt`. The `.strict()` call must remain - only the two new keys are added to the whitelist:

```ts
export const savedRecoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().optional(),         // Phase 25 D-50
    audit_ref: z.string().optional(),  // Phase 25 D-53
    savedAt: z.string().min(1),
    command: z.string(),
    cwd: z.string().min(1),
    envelope: recoveryEnvelopeSchema,
  })
  .strict()
```

Do NOT touch `recoveryEnvelopeSchema` (the inner body schema) - D-52.
Do NOT touch `parseRecoveryEnvelope` (no scope change to body parser).
`parseSavedRecoveryEnvelope` already uses `savedRecoveryEnvelopeSchema.safeParse` - its behavior automatically picks up the new optional fields.

**Step B - add unit tests in `tests/unit/core/recovery/envelope-schema.test.ts`:**

Inspect the existing file for the active import / describe pattern. Append a new `describe('SavedRecoveryEnvelope id + audit_ref (Phase 25)', ...)` block with the four test cases:

```ts
describe('SavedRecoveryEnvelope id + audit_ref (Phase 25)', () => {
  const validEnvelope = {
    // Embed a minimal valid RecoveryEnvelope body that already passes recoveryEnvelopeSchema.
    // Reuse the pattern from existing tests in this file.
  }

  test('accepts envelope with id + audit_ref (new shape)', () => {
    const payload = {
      schemaVersion: 1,
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      audit_ref: '8b3c8f0c-1234-4abc-9def-0123456789ab',
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(true)
    expect(r.value?.id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479')
    expect(r.value?.audit_ref).toBe('8b3c8f0c-1234-4abc-9def-0123456789ab')
  })

  test('accepts legacy envelope WITHOUT id and audit_ref (D-54 backward compat)', () => {
    const payload = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(true)
    expect(r.value?.id).toBeUndefined()
    expect(r.value?.audit_ref).toBeUndefined()
  })

  test('rejects payload with unknown extra key (.strict() preserved)', () => {
    const payload = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
      unknownField: 'bad',
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(false)
  })

  test('rejects payload where id is not a string', () => {
    const payload = {
      schemaVersion: 1,
      id: 42,
      savedAt: '2026-05-15T10:42:18Z',
      command: 'dbcli query',
      cwd: '/tmp/x',
      envelope: validEnvelope,
    }
    const r = parseSavedRecoveryEnvelope(payload)
    expect(r.ok).toBe(false)
  })
})
```

When building `validEnvelope`, copy the exact shape from the existing tests in this file (it must satisfy `recoveryEnvelopeSchema` - typically requires `schemaVersion: 1, generatedAt, ok: false, error: { code, category, message }, recovery: []`).

Run `bun test tests/unit/core/recovery/envelope-schema.test.ts` and confirm all four new cases pass.
  </action>
  <verify>
    <automated>bun test tests/unit/core/recovery/envelope-schema.test.ts 2>&1 | tee /tmp/test-25-01-t2.log; grep -E "(pass|fail|error)" /tmp/test-25-01-t2.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "id: z\\.string\\(\\)\\.optional\\(\\)" src/core/recovery/envelope-schema.ts` returns a line inside `savedRecoveryEnvelopeSchema`.
    - `grep -nE "audit_ref: z\\.string\\(\\)\\.optional\\(\\)" src/core/recovery/envelope-schema.ts` returns a line inside `savedRecoveryEnvelopeSchema`.
    - `grep -cE "\\.strict\\(\\)" src/core/recovery/envelope-schema.ts` >= 2 (the modifier is preserved on both recoveryEnvelopeSchema and savedRecoveryEnvelopeSchema).
    - `bun test tests/unit/core/recovery/envelope-schema.test.ts` exits 0 with at least 4 new tests passing (search log for "SavedRecoveryEnvelope id + audit_ref (Phase 25)").
    - All existing tests in the same file still pass (no regressions in the legacy `recoveryEnvelopeSchema` tests).
  </acceptance_criteria>
  <done>
    Zod schema accepts `id` and `audit_ref` as optional strings; legacy envelopes (without these fields) still parse successfully; unknown extra keys are still rejected by `.strict()`. Four new unit tests pass under `bun test`.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0.
2. `bun test tests/unit/core/recovery/envelope-schema.test.ts` exits 0 with all new + existing tests green.
3. `grep -n "id?: string\|audit_ref?: string" src/core/recovery/apply-types.ts` shows both fields declared optional on SavedRecoveryEnvelope.
4. `grep -n "z.string().optional()" src/core/recovery/envelope-schema.ts | wc -l` >= 2.
5. `grep -nE "RECOVERY_SCHEMA_VERSION|schemaVersion: 1" src/core/recovery/types.ts src/core/recovery/apply-types.ts` confirms neither version constant nor the literal `schemaVersion: 1` is bumped (D-52).
</verification>

<success_criteria>
- SavedRecoveryEnvelope has `id?: string` and `audit_ref?: string` declared exactly per PATTERNS.md section 1.
- savedRecoveryEnvelopeSchema declares both fields as `.optional()`, retains `.strict()`, and `parseSavedRecoveryEnvelope` round-trips both legacy and new shapes.
- Unit tests demonstrate D-54 backward compatibility (legacy envelope parses) and the strict-mode invariant (unknown keys still rejected).
- No changes to RecoveryEnvelope body, RECOVERY_SCHEMA_VERSION, or schemaVersion literal.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-01-SUMMARY.md` documenting:
- The two new optional fields and their decision references (D-50, D-53)
- The four new unit test cases and why each matters
- Confirmation that D-52 boundaries were respected (no changes to envelope body or version)
- Pointer forward: Plan 04 (emit.ts) consumes this shape; Plan 08 (contract test) round-trips it via `recover --from`.
</output>
