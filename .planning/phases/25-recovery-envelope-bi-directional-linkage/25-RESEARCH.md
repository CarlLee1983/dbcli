# Phase 25: Recovery Envelope Bi-directional Linkage - Research

**Researched:** 2026-05-15
**Domain:** TypeScript / Bun monorepo — audit log ⇄ recovery envelope cross-linkage
**Confidence:** HIGH (every claim grounded in current source; no training-data extrapolation)

## Summary

Phase 25 lives entirely in dbcli's existing surface area — there is **no new library** to evaluate, **no new dependency** to add, **no new commander subcommand** to register. The work is:

1. Plumb a pre-generated UUID (`crypto.randomUUID()`, already in use at `src/core/audit/logger.ts:20`) through three existing functions: `writeAuditEntry`, `emitRecoveryEnvelope`, and `writeLastEnvelopeSync` / `writeLastEnvelope`.
2. Extend `SavedRecoveryEnvelope` (`src/core/recovery/apply-types.ts:94-101`) and its zod parser (`src/core/recovery/envelope-schema.ts:64-72`) with two optional fields.
3. Inject `audit_recent: AuditEntryBrief[]` into the JSON renderers of four commands (`inspect`, `guide`, `recover`, `recover --apply`) — render-layer only, not stored on disk.
4. Add release-blocking contract tests covering the round-trip.

**Primary recommendation:** Follow CONTEXT.md D-50..D-61 verbatim. Centralize the audit-recent helper in a new file `src/core/audit/recent.ts` (per Specific Idea in CONTEXT.md) so all four commands share one read path. Treat `AuditEntryBrief` as a NEW exported type from `src/core/audit/types.ts` (it does not exist today — the inline `BriefEntry` in `src/commands/audit.ts:88` lacks `id`).

**Critical surprise** (not in CONTEXT.md): **6 commands that emit recovery envelopes today do NOT call `writeAuditEntry` at all** (insert / update / delete / export / q / schema). Phase 23 PARTIAL left these unwired. Phase 25 must explicitly decide: ship bi-directional ref only on the wired surface, OR close the Phase 23 gap as part of this phase. See § Open landmines item L1.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Bun-first.** Use `bun test`, `bun run src/cli.ts`, `bun:sqlite`, `Bun.file`, etc. No node, npm, jest, vitest, dotenv, express, ws, better-sqlite3.
- **Dev invocation:** `dbcli` is not installed in PATH during development — use `bun run src/cli.ts` everywhere.
- **No `.md` files unless explicitly requested.** Documentation work for SKILL.md / feature-matrix.md / README is **Phase 26 scope**, NOT Phase 25.
- **dbcli usage workflow** (from AGENTS.md): blacklist list → schema → query. Not directly relevant to Phase 25 implementation, but any new tests that touch dbcli end-to-end should follow this order.
- **Sensitive output single source:** redaction lives in `src/utils/redaction.ts` + `tests/helpers/sensitive-output.ts`. Do NOT add a second redaction layer (Phase 22 D-22 / Cross-Phase Risk #2).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Area A — recovery_ref / audit_ref shape

- **D-50:** `SavedRecoveryEnvelope` wrapper gets `id: string` (UUID v4). `AuditEntry.recovery_ref` aligns with this `id`. No `path`-shaped alternative, no compound `{id, path}`. Phase 24 `audit show --recovery-ref` exact-match (D-37) reused as-is.
- **D-51:** `emitRecoveryEnvelope()` pre-generates the envelope id at entry (`crypto.randomUUID()`). The same id is passed to `writeAuditEntry` (catch block, awaited first) and `writeLastEnvelopeSync` (envelope write path). NO refactor of sync write; NO reliance on emit return value; `process.exit()` behavior preserved. D6 retained — audit/envelope write failures only warn.
- **D-52:** `id` and `audit_ref` live on `SavedRecoveryEnvelope` wrapper, NOT on `RecoveryEnvelope` body. `RECOVERY_SCHEMA_VERSION = 1` unchanged. `stdout` envelope JSON shape unchanged (agent clients un-broken). `SavedRecoveryEnvelope.schemaVersion = 1` unchanged; new fields optional.
- **D-53:** `audit_ref?: string` (optional) on wrapper same layer. D6 hard rules:
  - audit write succeeds → `audit_ref` = audit entry UUID
  - audit disabled (`audit.enabled=false`) → `audit_ref` omitted
  - audit write fails (lock budget / permission / rotation stall) → `audit_ref` omitted (best-effort)
  - envelope write failure → unchanged (warn only)
- **D-54:** Old envelope backward compat — `parseSavedRecoveryEnvelope` (zod) marks `id` / `audit_ref` as optional; `recover --from` accepts old files without these fields, no malformed error. No migration ceremony (envelope is ephemeral).
- **D-55:** `audit show --recovery-ref <id>` lookup-miss behavior unchanged from Phase 24 D-37 — stderr "No audit entry matches '<x>'." + exit 1. No Phase 25 fallback for "old entry with no recovery_ref".

#### Area D — DOCS-02 inspect / guide / recover / recover --apply embed recent audit

- **D-56:** `audit_recent: AuditEntryBrief[]` embedded in all 4 agent paths (inspect snapshot, guide JSON, recover envelope JSON, recover --apply result JSON).
- **D-57:** Trigger = agent-facing path only. `--for-agent` (= `--format json --brief`) OR explicit `--format json`. Human markdown unchanged. NO `--with-audit` flag. NO "always embed".
- **D-58:** Default N = 5 (hard-coded constant, no `--audit-n=<N>` flag). Distinct from Phase 24 `audit tail` default of 10. Time order: latest LAST (per D-5 from Phase 24).
- **D-59:** Brief shape: `{ ts, command, target, success, id }`. Reuses Phase 24 `tail --brief` shape PLUS `id` (so agents can client-side join `entry.id === envelope.audit_ref`). PROHIBITED: `redacted_query`, `redacted_sql`, `metadata`, `session_id`, `engine`, `side_effect_tier`. Brief tailoring happens at render layer (reader returns full entries, render strips — same pattern as Phase 24 J).
- **D-60:** disabled / empty / unavailable all return `audit_recent: []`. Shape stable; agent uses `length === 0` to detect. NO `audit_status` field (that's `audit health`'s job).
- **D-61:** No `is_origin` flag on entries. `envelope.audit_ref` is the cross-ref; agent does client-side `entry.id === envelope.audit_ref` if it cares to highlight.

### Claude's Discretion

The following are for the planner to decide; researcher surfaces tradeoffs (see § Planner Discretion Items below):

- **E:** Contract test scope + release-blocking. Recommended placement: `tests/integration/recovery-audit-link.test.ts` (parallel to `audit-contract.test.ts`).
- **F:** `recover --apply` self-audit — should the `recover` command itself write an audit entry? Aligned with Phase 24 F: probably NO.
- **G:** `InspectSnapshot.audit_recent` placement + type name (`AuditEntryBrief` vs `RecentAuditEntry`).
- **H:** Reader reuse. `readEntries` + `tailEntries` from `src/core/audit/reader.ts`. Current connection only (no `--all`).
- **I:** envelope id generation site — `emit.ts` `emitRecoveryEnvelope()` entry point. Inline `crypto.randomUUID()`.
- **J:** catch block ordering template (audit first, then envelope). `AuditOutcome` gets `recovery_ref?: string`.
- **K:** `writeAuditEntry` returns entry id. `writeLastEnvelope*` accepts `auditRef?: string`.
- **L:** No i18n keys needed (DOCS-02 is JSON structure, not human text).
- **M:** Test impact:
  - audit-contract.test.ts unchanged (entry shape stable)
  - `audit show --recovery-ref` test fixtures need UUID-style ref values, not placeholder strings
  - emit-envelope tests need a new backward-compat test (D-54)

### Deferred Ideas (OUT OF SCOPE)

- `--audit-n=<N>` flag (N=5 hard-coded)
- `audit_status` field (use `audit health` instead)
- `recent[i].is_origin` annotation (client-side join)
- `recovery_ref` compound (id + path)
- `RECOVERY_SCHEMA_VERSION` bump 1→2
- `SavedRecoveryEnvelope.schemaVersion` bump 1→2
- `audit show --recovery-ref` path fallback
- `recover --apply` self-audit entry (deferred per F)
- SKILL.md / feature-matrix.md / CHANGELOG → Phase 26
- Tamper-evident / hash-chain / signed audit log → out of scope (compliance roadmap)
- `audit resource <table>` secondary index → seed
- `audit verify <id>` correlation → seed
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INTEGRATE-02 | Command 失敗時，audit entry 的 `recovery_ref` 指向 `.dbcli/last-recovery.json` | § Anchor Files (writeAuditEntry, emit.ts, AuditOutcome); § Call-Site Map shows all 7 emit sites + which currently lack writeAuditEntry; § Specifics — envelope id pre-generation pattern |
| INTEGRATE-03 | Recovery envelope 新增 `audit_ref`，反向指向 audit entry id | § Anchor Files (SavedRecoveryEnvelope, parseSavedRecoveryEnvelope); § Current Shapes (SavedRecoveryEnvelope verbatim); § Specifics — writeAuditEntry return value upgrade |
| DOCS-02 | `dbcli inspect` / `recover` flow agent guide auto-references recent audit | § JSON Renderer Map (4 render paths: inspect renderJson, guide renderJson, recover renderJson, recover --apply renderApplyJson); § Reader API (tailEntries + readEntries already support last-N from single connection); § Specifics — `loadRecentAudit` helper |
</phase_requirements>

## 1. Anchor Files

Exact paths + line numbers the planner / executor must read. Every file below was confirmed open in this research session.

### Recovery envelope (touched by Phase 25)

| File | Lines | Role | Phase 25 action |
|------|-------|------|-----------------|
| `src/core/recovery/emit.ts` | 22 (`emitRecoveryEnvelope`), 41 (`writeLastEnvelopeSync`) | Sole emit entry point; sync envelope write | Pre-generate UUID at entry; accept `envelopeId?` / `auditRef?` in `EmitOptions`; pass both to `writeLastEnvelopeSync` |
| `src/core/recovery/last-envelope.ts` | 6 (`LAST_ENVELOPE_PATH`), 63 (`writeLastEnvelope` async), 87 (`readLastEnvelope`), 108 (`readLastEnvelopeRaw`) | Async writer / readers | Add `id` / `audit_ref` to the saved payload; readers untouched (zod parser handles new optional fields) |
| `src/core/recovery/envelope-schema.ts` | 64-72 (`savedRecoveryEnvelopeSchema`), 95-99 (`parseSavedRecoveryEnvelope`) | zod schema | Add `id: z.string().optional()` and `audit_ref: z.string().optional()` |
| `src/core/recovery/apply-types.ts` | 94-101 (`SavedRecoveryEnvelope`) | TypeScript interface | Add `id?: string` and `audit_ref?: string` |
| `src/core/recovery/types.ts` | 11-26 (`RECOVERY_CODES`), 66-77 (`RecoveryEnvelope`) | RecoveryEnvelope BODY — **NOT touched** (D-52) | None |

### Audit writer / reader (touched by Phase 25)

| File | Lines | Role | Phase 25 action |
|------|-------|------|-----------------|
| `src/core/audit/types.ts` | 4-31 (`AuditEntry`), 24 (`recovery_ref?: string` already exists) | Entry interface | Add new exported type `AuditEntryBrief` here (for DOCS-02). Do NOT touch `AuditEntry`. |
| `src/core/audit/integration-helper.ts` | 53-59 (`AuditOutcome`), 65-109 (`writeAuditEntry`) | Audit write helper | Add `recovery_ref?: string` to `AuditOutcome`; change return type from `Promise<void>` to `Promise<string \| null>` (id on success, null on disabled/failed) |
| `src/core/audit/logger.ts` | 42-47 (`AuditWriteResult`), 134 (`const id = randomUUID()`), 185 (`return { success: true, rotated, id }`) | Already returns id on success | NO changes — return value already includes `id`; integration-helper just needs to propagate it |
| `src/core/audit/reader.ts` | 23-26 (`ReadOptions`), 55-65 (`readEntries`), 98-104 (`tailEntries`) | Read-only API | NO changes. Reused by new `recent.ts` helper. |

### Commands with JSON output to inject `audit_recent` (touched by Phase 25 DOCS-02)

| Command | File | JSON-render call site | Notes |
|---------|------|----------------------|-------|
| `inspect` | `src/commands/inspect.ts:59` | `renderJson(snap, { brief })` from `@/core/inspect` | Currently passes `InspectSnapshot`; need to inject `audit_recent` into snapshot OR override at render layer |
| `guide` | `src/commands/guide.ts:83` | `renderJson(snap, { brief })` from `@/core/guide` | Same pattern as inspect |
| `recover` (envelope read) | `src/commands/recover.ts:266` | `renderJson(source.envelope)` from `@/core/recovery` | `source.envelope` is `RecoveryEnvelope`, NOT `SavedRecoveryEnvelope`. The audit_recent injection point is the print site, not the type. Two options: (1) overload renderJson, (2) print combined `{...envelope, audit_recent}` envelope directly |
| `recover --apply` | `src/commands/recover.ts:281` | `renderApplyJson(result)` from `@/core/recovery/apply-render-json` | Same — `ApplyResult` interface needs render-layer audit_recent injection |

### JSON renderers (extension points for `audit_recent`)

| File | Lines | Function | Extension shape |
|------|-------|----------|-----------------|
| `src/core/inspect/render-json.ts` | 7-10 (`renderJson`), 12-21 (`toBrief`) | Inspect render | Either extend `InspectSnapshot` with `audit_recent?` OR add second-arg `{ audit_recent }` to `renderJson`. **Recommendation:** field on snapshot (per CONTEXT.md G), keeps single source of truth |
| `src/core/guide/render-json.ts` | 7-10 (`renderJson`), 12-15 (`toBrief`) | Guide render | Same pattern |
| `src/core/recovery/render-json.ts` | 4-7 (`renderJson`), 9-11 (`toBrief`) | Recovery envelope render — operates on `RecoveryEnvelope` body | Cannot embed `audit_recent` in `RecoveryEnvelope` (locked by D-52). Wrap the print site instead: print `{ ...envelope, audit_recent }` from `recover.ts` directly. Render function unchanged. |
| `src/core/recovery/apply-render-json.ts` | 3-5 (`renderApplyJson`) | One-liner over `ApplyResult` | Same wrapping pattern — print `{ ...result, audit_recent }` from `recover.ts` |
| `src/core/recovery/next-render-json.ts` | 3-5 (`renderNextJson`) | `recover --next` render | **D-56 lists 4 commands, NOT `--next`.** Leave next-render-json unchanged. The planner should confirm scope: CONTEXT.md uses "recover (envelope output)" and "recover --apply" — `--next` is a separate JSON path not in scope. |

### Tests

| File | Role | Phase 25 action |
|------|------|-----------------|
| `tests/integration/audit-contract.test.ts` | Phase 22 release-blocker; locks `AuditEntry` JSONL shape | **DO NOT modify** (Phase 22 contract). Phase 24 envelope test enforces this (test #5 in `audit-envelope.test.ts` is a meta-guard: "Phase 22 audit-contract.test.ts is not modified by Phase 24"). Phase 25 must respect the same fence. |
| `tests/integration/audit-envelope.test.ts` | Phase 24 release-blocker; locks `audit tail --all` envelope wrapper | **DO NOT modify**. |
| `tests/integration/audit-show-health.test.ts` | Phase 24 — needs UUID-style fixtures (M) | Light update if fixtures use placeholder `recovery_ref` strings. Grep needed. |
| `tests/integration/recovery.test.ts` | Recovery happy paths | NO modification. New file is parallel. |
| `tests/integration/recovery-audit-link.test.ts` | **NEW** (E) | Round-trip contract: failure → audit + envelope with matching refs; `audit_recent` shape in 4 commands; old envelope back-compat |
| `tests/helpers/sensitive-output.ts` | Redaction helper | NO modification. New refs are opaque UUIDs — no new sensitive fragments to forbid. |

## 2. Current `SavedRecoveryEnvelope` Shape (verbatim)

Source: `src/core/recovery/apply-types.ts:94-101`

```ts
export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  savedAt: string
  /** Sanitized command summary. Never a verbatim argv dump. */
  command: string
  cwd: string
  envelope: RecoveryEnvelope
}
```

Source: `src/core/recovery/envelope-schema.ts:64-72`

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

**Phase 25 target shape** (per D-50..D-54):

```ts
export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  /** Envelope-level UUID. Pre-generated at emitRecoveryEnvelope() entry. */
  id?: string
  /** ID of the audit entry that recorded this failure. Undefined when audit disabled or write failed (D-53). */
  audit_ref?: string
  savedAt: string
  command: string
  cwd: string
  envelope: RecoveryEnvelope
}
```

And zod:

```ts
export const savedRecoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().optional(),         // ← new
    audit_ref: z.string().optional(),  // ← new
    savedAt: z.string().min(1),
    command: z.string(),
    cwd: z.string().min(1),
    envelope: recoveryEnvelopeSchema,
  })
  .strict()
```

**Important:** the schema uses `.strict()`. Without explicit `.optional()` on the new fields, old envelopes (lacking `id` / `audit_ref`) would still parse — but new fields appearing in old test fixtures would FAIL parse if `.strict()` doesn't list them. The optional declarations cover both directions.

## 3. Current `writeAuditEntry` Signature + Return Type (verbatim)

Source: `src/core/audit/integration-helper.ts:53-109`

```ts
export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
}

export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<void> {
  try {
    const logger = await getAuditLogger(config, options.config || '.dbcli')
    // ... builds entry, then:
    await logger.write(entry)
  } catch {
    // D6: Never throw from audit integration.
  }
}
```

**Phase 25 target shape** (per D-J / D-K):

```ts
export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
  recovery_ref?: string   // ← new (D-J)
}

export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<string | null> {  // ← new return type (D-K)
  try {
    // ...
    const result = await logger.write(entry)
    if ('success' in result && result.success) return result.id
    return null
  } catch {
    return null
  }
}
```

**Already available:** `AuditLogger.write()` returns `AuditWriteResult` (`src/core/audit/logger.ts:42-47`), and on success returns `{ success: true, rotated: boolean, id: string }`. The id is right there — integration-helper just needs to propagate it. No changes to `logger.ts` are needed.

**Existing caller blast radius:** 17 call sites across `src/core/query-executor.ts`, `src/commands/report.ts`, `src/commands/doctor.ts`, `src/commands/inspect.ts`, `src/commands/query.ts` (4 sites), `src/commands/plan.ts` (2 sites), `src/commands/guide.ts`. Changing return type from `Promise<void>` to `Promise<string | null>` is **backward-compatible at the type level** for callers that ignore the return (TypeScript permits `await foo()` to drop the result), so existing code does not break. New callers that NEED the id (the 7 envelope-emitting commands per D-J) opt in.

## 4. Call-Site Map for the Failure Path

Every place that today calls `emitRecoveryEnvelope`. Phase 25 must touch each (insert `auditId = await writeAuditEntry(...)` ↔ `emitRecoveryEnvelope(..., { envelopeId, auditRef: auditId })` ordering per D-J).

| # | Source file | Line | Operation | `writeAuditEntry` called today? | Phase 25 ordering work |
|---|-------------|------|-----------|-------------------------------|----------------------|
| 1 | `src/cli.ts` | 154-155 | `query` (outer catch — redundant safety net) | NO at this catch (inner catch in `commands/query.ts:167` already does) | Inner catch path is canonical — modify `commands/query.ts:167` only; outer catch is a fallback after process already exited via emit |
| 2 | `src/cli.ts` | 214-215 | `insert` (outer catch) | NO at outer; **also NO at `commands/insert.ts:273-281` inner catch** | **GAP — see § Open Landmines L1** |
| 3 | `src/cli.ts` | 242-243 | `update` (outer catch) | NO at outer; **also NO at `commands/update.ts:305-313` inner catch** | **GAP** |
| 4 | `src/cli.ts` | 269-270 | `delete` (outer catch) | NO at outer; **also NO at `commands/delete.ts:274-282` inner catch** | **GAP** |
| 5 | `src/cli.ts` | 302-304 | `export` (outer catch) | NO at outer; **also NO at `commands/export.ts:144-152` inner catch** | **GAP** |
| 6 | `src/commands/schema.ts` | 223-224 | `schema` | **NO** | **GAP** |
| 7 | `src/commands/q.ts` | 219-223 | `q` (saved query) | **NO** | **GAP** |
| 8 | `src/commands/inspect.ts` | 78-79 | `inspect` | **YES** at 70 (success at 63, failure at 70 — both already wired) | Add `auditId` capture + pass to emit |
| 9 | `src/commands/insert.ts` | 274-281 | `insert` (inner catch) | **NO** | Same as #2 |
| 10 | `src/commands/export.ts` | 145-152 | `export` (inner catch) | **NO** | Same as #5 |
| 11 | `src/commands/update.ts` | 306-313 | `update` (inner catch) | **NO** | Same as #3 |
| 12 | `src/commands/query.ts` | 174-180 | `query` (inner catch) | **YES** at 167 | Add `auditId` capture + pass |
| 13 | `src/commands/delete.ts` | 275-282 | `delete` (inner catch) | **NO** | Same as #4 |

`commands/guide.ts` has `writeAuditEntry` but NO `emitRecoveryEnvelope` (guide doesn't emit envelopes — it's a planning command).

**Net pattern (D-J template applied to a wired command like inspect):**

```ts
} catch (err) {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()
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
    emitRecoveryEnvelope(err, { operation: 'inspect' }, {
      envelopeId,
      auditRef: auditId ?? undefined,
    })
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

## 5. JSON Envelope Assembly for inspect / guide / recover / recover --apply

| Command | JSON build site | Build expression | `audit_recent` injection point |
|---------|----------------|------------------|-------------------------------|
| `inspect` | `src/commands/inspect.ts:59` | `renderJson(snap, { brief })` | Snapshot-side: extend `InspectSnapshot` with `audit_recent?: AuditEntryBrief[]`, populate in `collectInspect` (cleanest, snapshot is the contract type) OR render-side: pass as second-arg option |
| `guide` | `src/commands/guide.ts:83` | `renderJson(snap, { brief })` | Same options. Snapshot-side touches `GuideSnapshot` in `src/core/guide/types.ts:60`. |
| `recover` (no `--apply` / `--next`) | `src/commands/recover.ts:266` | `renderJson(source.envelope)` — operates on `RecoveryEnvelope` body | Render is over `RecoveryEnvelope` body (D-52 forbids touching that type). **Solution:** keep `renderJson` unchanged; in `recover.ts` build `{ ...source.envelope, audit_recent }` directly and JSON.stringify. Or add a wrapping function `renderEnvelopeWithAudit(envelope, audit_recent)` in `src/core/recovery/render-json.ts` |
| `recover --apply` | `src/commands/recover.ts:281` | `renderApplyJson(result)` | `ApplyResult` interface in `src/core/recovery/apply-types.ts:79-92` is the natural home; add `audit_recent?: AuditEntryBrief[]` field OR wrap at print site like recover |

**Trigger condition** (D-57): `forAgent === true || format === 'json'`. Each of the 4 commands already computes `format` and `forAgent` at the top of its action handler:

| Command | Format detection |
|---------|-------------------|
| inspect | `src/commands/inspect.ts:37-39` |
| guide | `src/commands/guide.ts:46-48` |
| recover | `src/commands/recover.ts:231-233` (auto-derives `format` from `--apply` / `--next` mode) |
| recover --apply | same as recover |

CONTEXT.md Specifics suggest a shared helper:

```ts
// src/core/audit/recent.ts (NEW)
function shouldEmbedRecent(opts: { forAgent?: boolean; format: string; brief?: boolean }): boolean {
  return opts.forAgent === true || opts.format === 'json'
}
async function loadRecentAudit(config: DbcliConfig, configPath: string, n = 5): Promise<AuditEntryBrief[]>
```

The `loadRecentAudit` helper must not throw — on any failure (no audit dir, disabled, corrupted file, etc.) return `[]` per D-60.

## 6. Reader API for Last-N Entries

Source: `src/core/audit/reader.ts`

Existing API confirmed sufficient for Phase 25:

```ts
// reader.ts:55-65
export async function readEntries(
  auditFilePath: string,
  opts?: ReadOptions
): Promise<AuditEntry[]>

// reader.ts:98-104
export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[] {
  if (n <= 0) return []
  return entries
    .slice()
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-n)
}
```

**Notes for the planner:**

1. **Time order:** `tailEntries` sorts ASCending by `ts`, then `slice(-n)` — i.e., latest LAST. Matches D-58 / D-5.
2. **Current connection only** (D-H): use `readEntries(auditFilePath)` for the current connection's file. Do NOT use `discoverConnections` + `mergeByTimestamp` (those are `audit tail --all` territory and outside DOCS-02 scope).
3. **Rotated segment inclusion:** `readEntries` accepts `{ include_rotated: true }`. Phase 24's `audit show --recovery-ref` uses `include_rotated: true` (`src/commands/audit.ts:393, 432`). Phase 25 DOCS-02 should ALSO use `include_rotated: true` so that audit_recent contains the latest 5 entries even if rotation just happened.
4. **Error tolerance:** `readEntries` skips a truncated last line (warns to stderr) and HARD-FAILS on middle-line corruption (throws). `loadRecentAudit` must wrap in try/catch and return `[]` on any throw (D-60 / D-H). The stderr warning from a truncated last line is acceptable to surface (it's how Phase 24 already behaves).
5. **No lock acquired:** reader is `O_RDONLY`, append-safe (writer uses `O_APPEND`). Concurrent reads during a write are safe.

**Brief tailoring** must happen in `loadRecentAudit` (or just before the JSON stringify) — reader returns full `AuditEntry[]`:

```ts
function briefifyForRecent(entry: AuditEntry): AuditEntryBrief {
  return {
    id: entry.id,
    ts: entry.ts,
    command: entry.command,
    target: entry.target,
    success: entry.success,
  }
}
```

Note this differs from `src/commands/audit.ts:88-97` `briefify` which omits `id`. Phase 25 brief MUST include `id` (D-59).

## 7. Rotation Interaction

**Scenario:** envelope's `audit_ref` points to id `xxx-yyy`, audit log rotates 3 days later, segment containing `xxx-yyy` is renamed `default.jsonl.1`. Agent reads envelope and runs `dbcli audit show <xxx-yyy>` — does it still resolve?

**Today's behavior** (Phase 24, `src/commands/audit.ts:393, 432`):

```ts
for (const e of await readEntries(auditFile, { include_rotated: true })) {
  if (e.id === lookup || e.id.startsWith(lookup)) matches.push(...)
}
```

- `include_rotated: true` walks BOTH `default.jsonl` (current) AND `default.jsonl.1` (rotated).
- The audit logger only keeps ONE rotation segment (`src/core/audit/logger.ts:70-94`, see also Phase 21 D-09/10/11). So `xxx-yyy` is reachable for one rotation cycle, then disappears.

**Implication for Phase 25:**
- For the active failure case (envelope written in `.dbcli/last-recovery.json` → agent reads it minutes/hours later), the audit entry is essentially guaranteed to still be in `default.jsonl` (single segment is 10 MB / 1000 entries). Resolves cleanly.
- For long-lived envelopes (envelope file kept by user, audit log rotates past the entry twice), the lookup returns "No audit entry matches". This is the **D-55 path**: existing Phase 24 behavior, NOT extended by Phase 25.
- For DOCS-02 `audit_recent`: the reader walks the same path. If the active envelope's `audit_ref` is rotated out, `audit_recent` will simply not include it. Agent can still client-side check `entry.id === envelope.audit_ref` — match will be empty, which is fine.

**Recommendation:** Phase 25 uses `readEntries(auditFile, { include_rotated: true })` for DOCS-02 `audit_recent` (consistent with Phase 24's show-recovery-ref behavior). 5 entries from 1010 total is trivial; rotated segment is single-file and small.

## 8. Redaction Surface

**Claim:** The new fields (`audit_ref`, `recovery_ref`, `id` on envelope) carry no sensitive data — they are opaque `crypto.randomUUID()` strings of the form `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`. No SQL leak risk.

**Verification:**
1. `crypto.randomUUID()` (`src/core/audit/logger.ts:20`) — Node.js built-in, produces RFC 4122 v4 UUID. Documented at https://nodejs.org/api/crypto.html#cryptorandomuuid (cited).
2. Existing `id` field in `AuditEntry` (`src/core/audit/types.ts:5`) uses same source. Phase 22 contract test (`tests/integration/audit-contract.test.ts:65`) already asserts `typeof parsed.id === 'string'` — no other content validation, consistent with "opaque random string".
3. `sanitizeCommandSummary` (`src/core/recovery/last-envelope.ts:23-61`) redacts `--config`, `--param`, etc. before writing the envelope's `command` field. Phase 25 does NOT introduce new command-text surfaces — refs are just UUIDs.
4. `redactArgv` / `redactSql` / `redactSensitive` / `redactParams` (`src/utils/redaction.ts`) — full surface review confirms nothing in Phase 25's new fields triggers any redaction rule.

**Redaction tests that need EXTENDING (M):** `tests/integration/audit-show-health.test.ts` and any audit-show tests with placeholder `recovery_ref` values like `"recovery-ref-string"` should use realistic UUID-style values to avoid false positives in future regex-tightening of the contract. Grep `tests/integration/audit-show-health.test.ts` for `recovery_ref` to enumerate the fixtures.

**Redaction tests that DO NOT need touching:**
- `tests/helpers/sensitive-output.ts` — DEFAULT_FORBIDDEN_FRAGMENTS lists no UUID patterns; UUIDs are not in the threat model.
- `tests/integration/audit-contract.test.ts` — locked by Phase 22, must not be modified.
- `tests/integration/audit-envelope.test.ts` — locked by Phase 24, must not be modified.

## 9. Validation Architecture (Nyquist — REQUIRED by config.json)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in Bun test runner) |
| Config file | None — Bun auto-discovers `*.test.ts` |
| Quick run command | `bun test tests/integration/recovery-audit-link.test.ts` |
| Full suite command | `bun run release:check` (= prettier + typecheck + lint --max-warnings=0 + `bun test` + build + dist smoke) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| INTEGRATE-02 | failed command writes audit entry with non-empty `recovery_ref` matching saved envelope `id` | integration (release-blocking) | `bun test tests/integration/recovery-audit-link.test.ts` | ❌ Wave 0 |
| INTEGRATE-03 | `SavedRecoveryEnvelope.audit_ref` matches the audit entry's `id` | integration (release-blocking) | same file | ❌ Wave 0 |
| DOCS-02 | inspect / guide / recover / recover --apply `--for-agent` JSON contains `audit_recent` array | integration | same file | ❌ Wave 0 |
| DOCS-02 edge | audit disabled / empty / unavailable → `audit_recent: []` (3 cases) | integration | same file | ❌ Wave 0 |
| D-54 back-compat | old envelope (no `id` / `audit_ref`) accepted by `recover --from` | integration | same file | ❌ Wave 0 |
| D-J ordering | audit write precedes envelope write at failure path | unit | `bun test tests/unit/...emit-ordering.test.ts` | ❌ Wave 0 — OPTIONAL; planner discretion if integration test suffices |
| Backward compat | parseSavedRecoveryEnvelope accepts both old + new envelope shapes | unit | `bun test tests/unit/core/recovery/envelope-schema.test.ts` | exists? — needs grep |

### Sampling Rate
- **Per task commit:** `bun test tests/integration/recovery-audit-link.test.ts`
- **Per wave merge:** `bun test` (full suite, currently ~2151 tests)
- **Phase gate:** `bun run release:check` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/integration/recovery-audit-link.test.ts` — NEW file covering INTEGRATE-02 / -03 / DOCS-02 round-trip
- [ ] `tests/unit/core/recovery/envelope-schema.test.ts` — confirm exists; if yes, add 2 new cases (old envelope back-compat, new envelope with id/audit_ref); if no, create
- [ ] Decide if `--no-brief` interaction with `--for-agent` for DOCS-02 mirrors Phase 24 audit subcommands (`src/commands/audit.ts:286-292`). Plan likely needs to inherit the same `briefSource = command.getOptionValueSource('brief')` pattern in inspect / guide / recover so explicit `--no-brief` disables brief while still embedding `audit_recent` (audit_recent is independent of brief).

### Edge cases the contract test must cover (D-59 / D-60 / D-54)

1. **`audit.enabled = false`** → `audit_recent: []` (D-60)
2. **Audit dir missing** → `audit_recent: []` (D-60) — reader returns `[]` for ENOENT (`reader.ts:33`)
3. **Audit file empty** → `audit_recent: []` (D-60)
4. **N=5 cap** — 10 entries in file, response has exactly 5 most-recent (latest last)
5. **Brief shape** — exact key set `{ts, command, target, success, id}`. Forbidden keys (`redacted_query`, `redacted_sql`, `metadata`, `session_id`, `engine`, `side_effect_tier`) MUST be absent (D-59)
6. **Old envelope back-compat** — saved fixture with NO `id` / `audit_ref` parses via `parseSavedRecoveryEnvelope` without error
7. **Round-trip match** — failed command produces (a) audit entry with `recovery_ref === X` and (b) saved envelope with `id === X` AND `audit_ref === <entry.id>`

## 10. Security Domain

Phase 25 introduces no new external input surface — refs are produced by the same `crypto.randomUUID()` used elsewhere. ASVS applicability is narrow:

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | zod schemas in `src/core/recovery/envelope-schema.ts` validate parsed envelopes from `recover --from <file>`; new optional fields validated as `z.string().optional()`. Untrusted input is only the file content; sandboxing already handled by recovery v1.17.0. |
| V6 Cryptography | yes | `crypto.randomUUID()` from `node:crypto`. RFC 4122 v4 UUIDs. NEVER hand-roll. Already in use at `logger.ts:20`. |
| V7 Error Handling | yes | D6 fail-soft: audit write failures never throw to caller (`integration-helper.ts:105-108`); envelope write failures swallowed (`emit.ts:55-57`). Phase 25 preserves both. |

### Known Threat Patterns for dbcli stack

| Pattern | STRIDE | Standard Mitigation | Phase 25 hook |
|---------|--------|---------------------|---------------|
| Audit entry forgery via `--config` injection | Tampering | `redactArgv` masks `--config` value; entry `recovery_ref` is opaque UUID from crypto | No new attack surface (refs are not derived from user input) |
| Envelope file tampering on disk | Tampering | Recovery envelope is ephemeral; `recover --apply` already runs allowlist gating (`src/core/recovery/apply-allowlist.ts`) | New `audit_ref` field is informational only — `--apply` never consumes it to make a decision |
| Sensitive data leak via `audit_recent` | Information Disclosure | Brief shape EXCLUDES `redacted_query`, `redacted_sql`, `metadata`, `error` (D-59) | Render-layer brief tailoring must be airtight — contract test asserts forbidden keys absent |
| Reader stall on huge audit file | DoS | Phase 24 reader has no time bound but rotation cap is 10 MB / 1000 entries; `tailEntries` sorts in-memory (fine at 1010 entries) | `audit_recent` reads same files — same DoS bound |

## 11. Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All tests + dev runner | ✓ (assumed — see `bun run release:check` in STATE.md) | — | — |
| `node:crypto.randomUUID` | UUID generation | ✓ | Node 16+ (Bun ships with newer) | — |
| `node:fs/promises` | reader / writer | ✓ | — | — |
| `zod` | envelope schema parser | ✓ | — | — |
| External DB (PostgreSQL / MySQL / Mongo / Redis / ES) | Phase 23 audit-engines tests | ✓ in CI | — | — |
| `commander` | CLI surface | ✓ | — | — |

**No external dependencies required for Phase 25.** All work is in-tree refactor + new contract test.

## 12. Planner Discretion Items (E – M)

Each item presents 2–3 options with concrete pros/cons. Planner picks.

### E. Contract test scope + release-blocking

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **E1** | NEW file `tests/integration/recovery-audit-link.test.ts`; round-trip (1)+(2) release-blocking, (3) DOCS-02 standard | parallel to `audit-contract.test.ts` / `audit-envelope.test.ts` style; isolates Phase 25 surface | one more test file to maintain |
| E2 | Extend `tests/integration/audit-contract.test.ts` | fewer files | violates Phase 24 envelope test #5 meta-guard ("Phase 22 audit-contract.test.ts is not modified by Phase 24") — and arguably Phase 25 inherits the same fence; Phase 22 file is contract-only for `AuditEntry` JSONL shape |
| E3 | Split: round-trip in new file (release-blocking), DOCS-02 in `tests/integration/audit-envelope.test.ts` extension | DOCS-02 closer to existing audit envelope tests | violates Phase 24 meta-guard fence on envelope test as well |

**Researcher note:** E1 is consistent with CONTEXT.md Specifics recommendation and respects the contract-test isolation invariant from Phase 22/24.

### F. `recover --apply` self-audit

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **F1** | `recover --apply` does NOT call `writeAuditEntry` at all | mirrors Phase 24 F (audit subcommands don't write audit); avoids audit-on-recovery loop | `recover --apply` outcome is not visible in `audit tail` |
| F2 | `recover --apply` writes ONE summary entry at the end (`command: 'recover'`) | gives forensics visibility for recovery actions | crosses Phase 24 F principle; outside INTEGRATE-02/-03 scope |
| F3 | Defer entirely to a future phase | conservative; keeps scope tight | leaves a small forensics gap |

**Researcher note:** F1 / F3 are equivalent for Phase 25 (no work either way). The commands that `recover --apply` EXECUTES still write their own audit entries via their normal handlers — that path is untouched. F2 is a Phase 25 scope extension.

### G. `InspectSnapshot.audit_recent` placement + type name

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **G1** | Add `audit_recent?: AuditEntryBrief[]` to `InspectSnapshot` (last field, after `warnings`); same on `GuideSnapshot` and `ApplyResult` | snapshot is single source of truth; brief tailored once when populating | bumps the InspectSnapshot / GuideSnapshot contract (additive but visible to agents) — Phase 22/Phase 24 didn't lock these contracts on agent side, so additive is safe; verify `INSPECT_SCHEMA_VERSION` stays at 1 (additive optional field, no bump) |
| G2 | Render-only injection (e.g., `renderJson(snap, { brief, audit_recent })`) — never on snapshot type | snapshot stays minimal | scattered: 4 render call sites each need to pass it; agent gets the same shape regardless, but the type story for `audit_recent` lives in `recent.ts` only |
| G3 | Wrap output: `{ snapshot, audit_recent }` at the print site | maximally decoupled | breaks `--format json` shape (agents expect a flat object today) — REJECTED |

**Type name:** CONTEXT.md uses `AuditEntryBrief` in D-56; researcher recommends defining it as a NEW exported type in `src/core/audit/types.ts`:

```ts
export type AuditEntryBrief = Pick<AuditEntry, 'id' | 'ts' | 'command' | 'target' | 'success'>
```

This is also what `src/commands/audit.ts:88` should ideally be using (currently inline `BriefEntry`, missing `id`). Phase 24 brief tailoring stays as-is (no `id` for `audit tail --brief`); Phase 25 introduces the variant with `id` and uses it.

### H. Reader reuse + fall-through

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **H1** | Inline call `readEntries(auditFile, { include_rotated: true })` + `tailEntries` in new `src/core/audit/recent.ts` helper; try/catch wrap returning `[]` on any error | DRY, single helper for 4 commands; respects rotated lookups | none |
| H2 | Each command re-implements its own audit_recent loader | flexible per command | DRY violation; bug risk — 4 places to keep behavior identical |
| H3 | Add a new method `audit_recent` on the reader module | API expansion | over-engineering for 5-line helper |

**Recommendation:** H1.

### I. envelope id generation site

| Option | Description |
|--------|-------------|
| **I1** | Inline `crypto.randomUUID()` at `emitRecoveryEnvelope()` entry (`src/core/recovery/emit.ts:22`), used as default if `options.envelopeId` absent. Caller can pass `envelopeId` for pre-generated UUIDs from catch blocks. |
| I2 | Add a separate service `EnvelopeIdService` | over-engineering for one `randomUUID()` call |

**Recommendation:** I1.

### J. catch block ordering

CONTEXT.md template is sufficient (see § 4 Call-Site Map). Planner just applies it. The decision the planner must make for **6 commands without `writeAuditEntry`** (insert / update / delete / export / q / schema):

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **J1** | Phase 25 only wires bi-directional ref where `writeAuditEntry` already exists (commands that wrote audit in Phase 23 happy path: `inspect`, `guide`, `query`, `report`, `doctor`, `plan`). For the 6 commands without audit, `--recovery` still works (envelope written) but `audit_ref` stays undefined, `recovery_ref` is not present in any audit entry (because no entry is written). | Keeps Phase 25 scope tight; respects Phase 23 PARTIAL boundary | Asymmetric — `insert` failure produces envelope but no audit entry; `query` failure produces both. Forensics gap noted in ROADMAP. |
| J2 | Phase 25 also closes Phase 23 PARTIAL by adding `writeAuditEntry` to the 6 unwired commands. | INTEGRATE-02 actually becomes verifiable for all DB commands; phase boundary cleaner | Scope creep — these belong to Phase 23-04 per ROADMAP `STATE.md`; Phase 25 success criteria say "Command 失敗時" without distinguishing which commands |
| J3 | Phase 25 only wires `query` + `inspect` (the canonical DOCS-02 surfaces); defer everything else | even tighter | Asymmetric to the point of inconsistency |

**Researcher note — this is THE central planner decision.** ROADMAP Phase 23 line says "PARTIAL — DML/DDL audit deltas deferred to Phase 23-04 audit-only deltas". ROADMAP Phase 25 success criterion #1 says "Command 失敗時產生的 audit entry". For commands without `writeAuditEntry`, no entry exists, so criterion #1 is vacuously satisfied — but the spirit (forensics path on ALL commands) is not. The planner should explicitly call this out and either (a) ship J1 and document the gap, or (b) absorb the Phase 23-04 work into Phase 25.

### K. `audit_ref` propagation

| Option | Description |
|--------|-------------|
| **K1** | `writeAuditEntry` returns `Promise<string \| null>`; caller pre-generates `envelopeId`, awaits `writeAuditEntry` with `recovery_ref: envelopeId`, captures returned `auditId`, passes to `emitRecoveryEnvelope` via `{ envelopeId, auditRef }`. **Matches CONTEXT.md Specifics catch block template.** |
| K2 | Make `emitRecoveryEnvelope` accept a `getAuditId: () => Promise<string \| null>` callback to defer audit-write into emit | tighter coupling; harder to test |
| K3 | Restructure so envelope is written first, returns id, then audit entry references it | inverts the D-J / D-51 decision; rejected by CONTEXT.md A2 |

**Recommendation:** K1.

### L. i18n

CONTEXT.md D-L: no new keys. **Confirmed:** the 4 commands' `--for-agent` paths are pure JSON. No new human-facing strings. Confirmed via inspection of `src/i18n/messages/{en,zh-TW}.json` — no audit_recent message keys needed.

### M. Existing test impact

CONTEXT.md D-M summary:
- `audit-contract.test.ts`: **no change** (Phase 22 fence)
- `audit show --recovery-ref` tests (`tests/integration/audit-show-health.test.ts`): light update if fixtures use placeholder ref strings; grep needed by planner
- `emit-envelope` tests: NEW backward-compat case (D-54). Existing tests in `tests/unit/core/recovery/` should not break since new fields are optional.

## 13. Open Landmines / Surprises

### L1. Phase 23 PARTIAL gap directly affects Phase 25 success criterion #1

**Problem:** Six commands emit recovery envelopes today (insert / update / delete / export / q / schema) but do NOT call `writeAuditEntry`. ROADMAP § Progress Table line 140 marks Phase 23 as "Partial (query/diagnostic surface; DML/DDL deferred to 23-04)". A `dbcli insert ... --recovery` failure today produces a recovery envelope on disk but **no audit entry**. Phase 25's bi-directional ref is only meaningful for commands that actually write audit entries.

**Decision needed (J1 vs J2):** ship Phase 25 only over the wired surface (J1) and accept the asymmetry, OR absorb the Phase 23-04 work and close the gap. The planner must surface this to the discuss-phase / user explicitly because it changes Phase 25's scope materially.

**Researcher's read:** The ROADMAP names "Phase 23-04 audit-only deltas" as the right place for the closure work; Phase 25 dependency is "Phase 23 (audit entries must exist on failure paths)". The PARTIAL status arguably blocks Phase 25 from being clean. Pragmatic recommendation: ship J1 in Phase 25 (link the wired surface), open a Phase 23-04 plan in parallel that adds `writeAuditEntry` to the 6 unwired commands following Phase 23's `try/catch` integration pattern, and let Phase 26 docs/release-gate sweep up both.

### L2. `recover --next` is NOT in DOCS-02 scope, but uses a sibling JSON renderer

D-56 lists 4 commands: inspect, guide, recover (envelope), recover --apply. `recover --next` (`src/core/recovery/next-render-json.ts`, `src/commands/recover.ts:257-262`) is a separate agent-facing JSON path that also reads the saved envelope. The planner should consciously decide whether to embed `audit_recent` in `recover --next` too. **Researcher's read:** CONTEXT.md is explicit (4 commands), so leave `--next` alone in Phase 25. Mention this in the plan summary so it isn't a surprise in Phase 26.

### L3. The outer catch in `cli.ts` for query / insert / update / delete / export is a DUPLICATE emit path

`src/cli.ts:149-159` wraps `queryCommand` with `try/catch` that calls `emitRecoveryEnvelope` if `options.recovery === true`. But `commands/query.ts:174-180` ALSO has an inner catch that emits. Same pattern for insert / update / delete / export. The outer catch is unreachable when the inner one runs (process.exit kills first), but a thrown error that escapes the inner finally could hit the outer.

**Implication for Phase 25:** add the `envelopeId` pre-generation pattern to the **inner** catch only (per § 4 table). The outer catch is a fallback safety net; modifying it would mean two envelope writes for the same failure. Skip it.

### L4. `next-render-json.ts` does not pass options to renderer

Unlike inspect / guide which pass `{ brief }`, `recover --next` calls `renderNextJson(result)` with no options. The brief-mode bifurcation already exists in `next-types.ts` but renders the full `NextResult` either way. Not a Phase 25 issue (it's not in scope) but flagged because if Phase 26 ever wants to add `audit_recent` to `--next`, the render function needs an options-arg refactor.

### L5. Audit logger's `AuditWriteResult` has a `success: true, rotated, id` shape — but uses `'success' in result` as the discriminator

Source: `src/core/audit/logger.ts:42-47`:

```ts
export type AuditWriteResult =
  | { skipped: 'disabled' }
  | { skipped: 'lock-budget-exhausted' }
  | { skipped: 'write-failed'; error: string }
  | { success: true; rotated: boolean; id: string }
```

The success path has `success: true`, all skip paths have `skipped: <reason>`. The integration-helper change for K needs to use `'success' in result` (not `result.success`) — same pattern as `audit-contract.test.ts:47`:

```ts
const result = await logger.write(entryPayload)
if (!('success' in result)) throw new Error('Write failed')
```

The planner's `writeAuditEntry` upgrade should be:

```ts
const result = await logger.write(entry)
return 'success' in result ? result.id : null
```

### L6. `--for-agent` ALREADY exists on inspect / guide; recover has no `--for-agent` flag

- inspect: `src/commands/inspect.ts:15-16` (`--brief`, `--for-agent`)
- guide: `src/commands/guide.ts:33-34`
- recover: `src/commands/recover.ts` has no explicit `--brief` flag, no `--for-agent`. `format === 'json'` is the auto-default when `--apply` / `--next` is on; `--format json` is opt-in for the envelope-print path.

**Discrepancy:** `recover` does NOT support `--for-agent` today. D-57 says "only `--for-agent` (= `--format json --brief`) or explicit `--format json`". For `recover` and `recover --apply`, the trigger is "format === 'json'" (which is auto-true for --apply / --next, and opt-in via `--format json` for the envelope-print path). Researcher's read: D-61 + D-57 together mean `recover` triggers `audit_recent` whenever it outputs JSON. Planner should explicitly NOT add a `--for-agent` flag to `recover` — keep it consistent with current surface (just check `format === 'json'`).

### L7. SavedRecoveryEnvelope zod schema uses `.strict()`

`src/core/recovery/envelope-schema.ts:72` — `.strict()` means unknown keys fail parse. New fields `id` / `audit_ref` MUST be added to the schema (not just the TS interface) or new envelopes will be rejected at parse time. The TS interface change alone is not sufficient. Double-check both sides.

### L8. `commands/recover.ts` has TWO branches that build envelope output

- `source.envelope` print at line 266 (no-apply, no-next mode)
- `renderApplyJson(result)` at line 281 (--apply)

Both need the `audit_recent` injection independently. The audit-recent load can be hoisted to one call after `resolveApplySource` returns:

```ts
// (pseudo)
const source = await resolveApplySource(...)
const config = await configModule.read(...)  // need to add this read
const audit_recent = await loadRecentAudit(config, configPath, 5)
// then both branches use it
```

But: today `recover.ts` does NOT call `configModule.read`. Loading config inside `recover` is new work — keep it light (read with try/catch, return `[]` if config missing) per D-60.

### L9. `recover --from` accepts external envelopes — `audit_recent` semantics are tricky

`recover --from external.json` — the `external.json` came from another working directory / another invocation. The current working directory's audit log may be unrelated. Should DOCS-02 still embed `audit_recent` from the current cwd's audit log? Researcher's read: YES — `audit_recent` is "what happened in THIS session/cwd recently" (per D-58 "hand-off context"), independent of where the envelope came from. The agent can client-side decide if it's relevant. No special handling needed for `--from`; just embed current cwd's audit_recent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `crypto.randomUUID()` always returns a v4 UUID of 36 chars (8-4-4-4-12 hex) and never collides in practice | § 8 Redaction, § 12 K | Negligible — Node.js guarantee per RFC 4122; same primitive already trusted by Phase 21-22 |
| A2 | Adding optional fields to `SavedRecoveryEnvelope.schemaVersion = 1` does not break agent-facing clients that read `.dbcli/last-recovery.json` | § User Constraints D-54 | Low — JSON is forward-compatible; agents that hard-code an exact key whitelist would need to add the new keys, but agent tooling generally tolerates unknown keys |
| A3 | Phase 24's `briefify` (lacking `id`) is intentional and not a bug — Phase 25's brief-with-id is a NEW shape, not a fix | § 12 G | Low — confirmed in CONTEXT.md D-59 ("加上 `id` 讓 client side join") |
| A4 | The L1 gap (6 commands without `writeAuditEntry`) is a planner-discretion decision, not a researcher-resolved fact | § 13 L1 | Medium — if user expects Phase 25 to also close Phase 23-04, J1 will under-deliver; planner MUST surface this to discuss-phase before locking |

## Sources

### Primary (HIGH confidence — verified by direct file read)

- `src/core/recovery/emit.ts` — emitRecoveryEnvelope entry point, sync writer
- `src/core/recovery/last-envelope.ts` — async writer, readers, `LAST_ENVELOPE_PATH`
- `src/core/recovery/envelope-schema.ts` — zod parser
- `src/core/recovery/apply-types.ts` — `SavedRecoveryEnvelope`, `ApplyResult`
- `src/core/recovery/types.ts` — `RecoveryEnvelope` body, `RECOVERY_SCHEMA_VERSION`
- `src/core/recovery/render-json.ts` / `apply-render-json.ts` / `next-render-json.ts`
- `src/core/audit/types.ts` — `AuditEntry`
- `src/core/audit/integration-helper.ts` — `writeAuditEntry`, `AuditOutcome`, `getAuditLogger`
- `src/core/audit/logger.ts` — `AuditLogger.write` return shape, randomUUID source
- `src/core/audit/reader.ts` — `readEntries`, `tailEntries`, `discoverConnections`, `mergeByTimestamp`
- `src/commands/inspect.ts` / `guide.ts` / `recover.ts` — DOCS-02 injection points + format/forAgent detection
- `src/commands/audit.ts` — Phase 24 brief shape, `--recovery-ref` lookup (rotation interaction)
- `src/commands/{insert,update,delete,export,query,q,schema}.ts` — catch-block patterns + Phase 23 PARTIAL evidence
- `src/cli.ts` — outer catch sites (L3)
- `src/utils/redaction.ts` — confirms refs don't interact with redaction rules
- `tests/integration/audit-contract.test.ts` — Phase 22 fence
- `tests/integration/audit-envelope.test.ts` — Phase 24 envelope contract + meta-guard
- `tests/integration/audit-engines.test.ts` / `audit-show-health.test.ts` / `audit-tail.test.ts` — fixture patterns
- `tests/helpers/sensitive-output.ts` — redaction forbidden fragments
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — milestone context
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md` — locked decisions
- `.planning/phases/{21,22,23,24}-*/`-VERIFICATION.md — Phase status (esp. 23 PARTIAL)
- `.planning/config.json` — `nyquist_validation: true` confirmed
- `CLAUDE.md` / `AGENTS.md` — Bun-first conventions

### Secondary (MEDIUM confidence)

- Node.js `crypto.randomUUID()` documentation (training-data knowledge, well-established API)

### Tertiary (LOW confidence)

- None. Phase 25 work is fully grounded in the current codebase.

## Metadata

**Confidence breakdown:**
- Anchor file mapping: HIGH — every file opened and line-cited
- SavedRecoveryEnvelope / writeAuditEntry shape: HIGH — verbatim from source
- Call-site map: HIGH — `grep` enumerated all emit + audit-write sites
- Rotation interaction: HIGH — confirmed by reader.ts:59-64 (include_rotated walks .jsonl + .jsonl.1 only) + logger.ts:70-94 (single rotation segment)
- Redaction surface: HIGH — refs are opaque UUIDs from `crypto.randomUUID()`, no new sensitive input
- Validation Architecture: HIGH — `bun:test` is current, framework runtime confirmed in STATE.md (`2151 pass / 3 skip / 0 fail`)
- Planner discretion items: MEDIUM — surfaced as options + pros/cons; user / discuss-phase / planner must pick
- L1 (Phase 23 PARTIAL gap): HIGH — confirmed via `grep writeAuditEntry` + Phase 23-VERIFICATION.md

**Research date:** 2026-05-15
**Valid until:** 30 days (codebase is stable; Phase 24 just landed 2026-05-15; no upstream churn expected before Phase 25 plans)

## RESEARCH COMPLETE
