---
phase: 25
plan: 07
status: complete
completed: 2026-05-16
requirements: [DOCS-02]
key-files:
  modified:
    - src/commands/recover.ts
  created:
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-07-SUMMARY.md
---

# 25-07 SUMMARY — DOCS-02 audit_recent in recover

## What shipped

`src/commands/recover.ts` now embeds `audit_recent` at the top level of both agent-facing JSON paths, completing the DOCS-02 4-surface coverage (inspect + guide + recover + recover --apply).

### Hoisted load (single fetch per invocation)

```ts
const source = await resolveApplySource({...})

let audit_recent: import('@/core/audit/types').AuditEntryBrief[] = []
if (format === 'json' && options.next !== true) {
  try {
    const { configModule } = await import('@/core/config')
    const configPath = `${process.cwd()}/.dbcli`
    const config = await configModule.read(configPath)
    if (config) {
      const { loadRecentAudit } = await import('@/core/audit/recent')
      audit_recent = await loadRecentAudit(config, configPath)
    }
  } catch {
    audit_recent = [] // D-60
  }
}
```

Trigger condition: `format === 'json' && options.next !== true`. The format gate enforces D-57 (recover has no `--for-agent` flag per RESEARCH L6, so json is the only signal). The `next !== true` gate enforces L2 (the `--next` JSON path is the 5th excluded path per D-56).

The belt-and-suspenders `try / catch` is intentional: `loadRecentAudit` already swallows internal errors (D-60), but `configModule.read` may itself throw if the `.dbcli` dir is malformed — that throw is also collapsed to `[]`.

### Print-site wraps (D-52 preserved)

**No-apply branch:**

```ts
if (format === 'markdown') {
  console.log(renderMarkdown(source.envelope))
} else {
  console.log(JSON.stringify({ ...source.envelope, audit_recent }, null, 2))
}
```

**--apply branch:**

```ts
if (format === 'markdown') {
  console.log(renderApplyMarkdown(result))
} else {
  console.log(JSON.stringify({ ...result, audit_recent }, null, 2))
}
```

The `renderJson` and `renderApplyJson` helper imports were removed — they operated on the `RecoveryEnvelope` body / `ApplyResult` types directly, and per D-52 those types must not gain `audit_recent`. Instead we shallow-spread the envelope/result and add `audit_recent` at the consumer (this file). Lint enforces this — unused imports are release-blocking.

## L2 + F1 boundaries observed

**L2 — `--next` branch NOT modified** (still calls `renderNextJson(result)` verbatim). `--next` is the 5th JSON path that D-56 explicitly excludes.

**F1 — `recover --apply` does NOT call `writeAuditEntry`** (`grep -nE "writeAuditEntry" src/commands/recover.ts` returns nothing). Per CONTEXT.md F1, audit emission for `recover --apply` is a separate downstream concern; this plan only embeds the read-side `audit_recent`.

## Tests

No new tests in this plan — Plan 08's contract test exercises all 4 surfaces end-to-end. Regression coverage:

- `bun test tests/integration/recovery.test.ts tests/integration/recover-apply.test.ts tests/integration/recover-next.test.ts` → 64 pass / 0 fail
- `bun run typecheck` → exit 0
- `bun run lint src/commands/recover.ts` → 0 errors / 0 warnings (release-blocking gate)

## Hand-off

- **Plan 08 (contract test)**: round-trips all 4 surfaces — `dbcli inspect --for-agent`, `dbcli guide health --for-agent`, `dbcli recover --format json`, `dbcli recover --apply` — and asserts `audit_recent` is present in JSON, absent in markdown, and equals `[]` on disabled/missing audit.

## Self-Check: PASSED

- [x] `audit_recent` loaded once and shared across both branches.
- [x] Trigger: `format === 'json' && options.next !== true`.
- [x] Both no-apply and --apply JSON branches wrap `{ ...payload, audit_recent }` at print site.
- [x] `--next` branch unchanged (L2).
- [x] `writeAuditEntry` NOT called (F1).
- [x] `RecoveryEnvelope` body and `ApplyResult` types NOT extended (D-52).
- [x] D-60 fall-through on config-read failure → `audit_recent = []`.
- [x] Unused imports removed (lint `--max-warnings=0` clean).
- [x] `bun run typecheck` exits 0; 64 recover tests pass.
