---
phase: 25
plan: 06
status: complete
completed: 2026-05-16
requirements: [DOCS-02]
key-files:
  modified:
    - src/core/inspect/types.ts
    - src/core/guide/types.ts
    - src/commands/inspect.ts
    - src/commands/guide.ts
  created:
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-06-SUMMARY.md
---

# 25-06 SUMMARY — DOCS-02 audit_recent in inspect + guide

## What shipped

Two snapshot types and two command handlers gain DOCS-02 `audit_recent` embedding for agent-facing JSON paths.

### Type extensions

```ts
// src/core/inspect/types.ts
export interface InspectSnapshot {
  // ... existing fields ...
  audit_recent?: AuditEntryBrief[]  // Phase 25 DOCS-02
}

// src/core/guide/types.ts
export interface GuideSnapshot {
  // ... existing fields including context: InspectSnapshot ...
  audit_recent?: AuditEntryBrief[]  // Phase 25 DOCS-02 — TOP LEVEL
}
```

Both interfaces gain a trailing optional field of type `AuditEntryBrief[]` (the 5-key brief from Plan 03). `INSPECT_SCHEMA_VERSION` and `GUIDE_SCHEMA_VERSION` stay at `1` — additive optional field is non-breaking per RESEARCH §G1.

### Top-level vs context (Guide)

`GuideSnapshot.context: InspectSnapshot` automatically inherits `audit_recent?` from the type extension on `InspectSnapshot`. **But the contract is to embed at the TOP level**, not inside `context`. The injection in `guide.ts` writes to `snap.audit_recent`, not `snap.context.audit_recent`. Plan 08's contract test asserts agents must use `top_level.audit_recent` and ignores `context.audit_recent` (which remains `undefined` because `collectGuide` does not populate it).

### Injection sites

**`src/commands/inspect.ts`** — between `requireSchemaCacheOrThrow` and `renderJson`:

```ts
if (options.requireSchemaCache === true) {
  const { requireSchemaCacheOrThrow } = await import('@/core/inspect')
  requireSchemaCacheOrThrow(snap.schemaCache, snap.system ?? null)
}

// Phase 25 DOCS-02
if (config) {
  const { shouldEmbedRecent, loadRecentAudit } = await import('@/core/audit/recent')
  if (shouldEmbedRecent({ forAgent, format })) {
    snap.audit_recent = await loadRecentAudit(config, configPath)
  }
}

const out = format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
```

**`src/commands/guide.ts`** — between `collectGuide` and `renderJson`. Mutates `snap.audit_recent` directly (NOT `snap.context.audit_recent`). Catch block at L92-102 NOT modified (guide does not emit envelopes per PATTERNS §9).

## Guide catch block NOT touched

`grep -c emitRecoveryEnvelope src/commands/guide.ts` returns `0`. Guide does not have a recovery-envelope emission path; the D-J catch-block template only applies to commands that already had `emitRecoveryEnvelope` (J1 — i.e., `query.ts` + `inspect.ts`). Guide's catch block stays at its pre-Phase-25 shape (audit-only write).

## Tests

No new tests in this plan — Plan 08 will round-trip `dbcli inspect --for-agent` and `dbcli guide health --for-agent` and assert `top_level.audit_recent` is present in JSON output (and absent in markdown). Regression coverage:

- `bun test tests/integration/inspect.test.ts tests/integration/guide.test.ts tests/unit/core/inspect/ tests/unit/core/guide/` → 78 pass / 0 fail
- `bun run typecheck` → exit 0

## Hand-off

- **Plan 07 (recover / recover --apply)**: applies the same DOCS-02 embed pattern at the print site, but the output shape there is the rendered command output (not a snapshot type) — so the injection is a print-site wrap, not a snapshot mutation.
- **Plan 08 (contract test)**: assert DOCS-02 4-surface coverage (inspect + guide + recover + recover --apply) all carry `audit_recent` in agent JSON, all absent in markdown.

## Self-Check: PASSED

- [x] `InspectSnapshot.audit_recent?: AuditEntryBrief[]` declared.
- [x] `GuideSnapshot.audit_recent?: AuditEntryBrief[]` declared at TOP level.
- [x] `INSPECT_SCHEMA_VERSION` and `GUIDE_SCHEMA_VERSION` still `1`.
- [x] `inspect.ts` and `guide.ts` both gate the embed on `shouldEmbedRecent({ forAgent, format })`.
- [x] `guide.ts` writes to `snap.audit_recent` (NOT `snap.context.audit_recent`).
- [x] `guide.ts` catch block unchanged (no D-J patch — guide doesn't emit envelopes).
- [x] `bun run typecheck` exits 0; 78 inspect+guide tests pass.
