# Phase 25: Recovery Envelope Bi-directional Linkage — Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 15 new/modified + 4 read-only analogs
**Analogs found:** 15 / 15
**J1 scope reminder:** Only `inspect.ts` + `query.ts` are wired surfaces for bi-directional ref. `guide.ts` writes audit but does NOT emit envelope (no D-J catch-block patch). DOCS-02 (`audit_recent` injection) applies to all 4 agent commands (`inspect` / `guide` / `recover` / `recover --apply`).

## File Classification

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/core/recovery/apply-types.ts` | model (interface) | request-response | self (line 94-101 SavedRecoveryEnvelope) | exact (in-place edit) |
| `src/core/recovery/envelope-schema.ts` | model (zod schema) | request-response | self (line 64-72 savedRecoveryEnvelopeSchema) | exact (in-place edit) |
| `src/core/recovery/emit.ts` | service (writer) | file-I/O sync | self (line 22 emitRecoveryEnvelope, line 41 writeLastEnvelopeSync) | exact (signature extension) |
| `src/core/recovery/last-envelope.ts` | service (writer) | file-I/O async | self + emit.ts sibling | exact (signature extension) |
| `src/core/audit/integration-helper.ts` | service (helper) | file-I/O async | self (line 53 AuditOutcome, line 65 writeAuditEntry) | exact (return type + outcome field) |
| `src/core/audit/types.ts` | model (interface) | request-response | self (line 4 AuditEntry) | exact (new exported type sibling) |
| `src/core/audit/recent.ts` | service / utility (NEW) | file-I/O async | `src/core/audit/reader.ts` (readEntries+tailEntries) + `src/commands/audit.ts:88` briefify | role-match (new module composing reader API) |
| `src/commands/inspect.ts` | controller | request-response | self (line 68-83 catch block) | exact (D-J template applied in place) |
| `src/commands/guide.ts` | controller | request-response | `src/commands/inspect.ts` (snapshot+brief render) | role-match (NO catch D-J patch; DOCS-02 only) |
| `src/commands/recover.ts` | controller | file-I/O + request-response | self (line 264-282 print sites) | exact (DOCS-02 wrap at two print sites) |
| `src/commands/query.ts` | controller | request-response | `src/commands/inspect.ts` catch block | role-match (D-J template; outer cli.ts catch NOT touched per L3) |
| `src/core/inspect/types.ts` | model (interface) | request-response | self (line 64-75 InspectSnapshot) | exact (append optional field) |
| `src/core/guide/types.ts` | model (interface) | request-response | `src/core/inspect/types.ts` | role-match (mirror placement) |
| `src/core/recovery/render-json.ts` | utility (renderer) | transform | self (line 4-7 renderJson) | exact (unchanged; wrap at caller per L-recover.ts) |
| `src/core/recovery/apply-render-json.ts` | utility (renderer) | transform | self (line 3-5 renderApplyJson) | exact (unchanged; wrap at caller) |
| `src/core/recovery/next-render-json.ts` | utility (renderer) | transform | self | **out of scope (L2)** — not touched |
| `tests/integration/recovery-audit-link.test.ts` | test (NEW) | event-driven | `tests/integration/audit-envelope.test.ts` Phase 24 contract | role-match |

---

## Pattern Assignments

### 1. `src/core/recovery/apply-types.ts` (model, request-response)

**Analog:** self — `src/core/recovery/apply-types.ts:94-101`

**Current shape:**
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

**Delta to apply (D-50 / D-52 / D-53):** insert two optional wrapper-level fields immediately after `schemaVersion`. Do NOT touch `RecoveryEnvelope` body (D-52). Do NOT bump `schemaVersion`.

```ts
export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  /** Envelope-level UUID. Pre-generated at emitRecoveryEnvelope() entry. D-50/D-51. */
  id?: string
  /** ID of the audit entry that recorded this failure. Undefined when audit disabled or write failed (D-53). */
  audit_ref?: string
  savedAt: string
  command: string
  cwd: string
  envelope: RecoveryEnvelope
}
```

---

### 2. `src/core/recovery/envelope-schema.ts` (model, request-response)

**Analog:** self — `src/core/recovery/envelope-schema.ts:64-72`

**Current shape:**
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

**Delta to apply (D-54 / L7):** add two `.optional()` fields BEFORE `savedAt`. The `.strict()` modifier means missing field is fine but unknown keys reject — so adding both TS interface AND zod schema is mandatory.

```ts
export const savedRecoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().optional(),         // ← Phase 25 D-50
    audit_ref: z.string().optional(),  // ← Phase 25 D-53
    savedAt: z.string().min(1),
    command: z.string(),
    cwd: z.string().min(1),
    envelope: recoveryEnvelopeSchema,
  })
  .strict()
```

---

### 3. `src/core/recovery/emit.ts` (service, file-I/O sync)

**Analog:** self — `src/core/recovery/emit.ts:9-58`

**Current shape:**
```ts
export interface EmitOptions extends RecoveryRenderOptions {
  exitCode?: number
  argv?: string[]
  cwd?: string
}

export function emitRecoveryEnvelope(
  error: unknown,
  ctx: RecoveryContext,
  options: EmitOptions = {}
): never {
  const envelope = classifyError(error, ctx)
  const cwd = options.cwd ?? process.cwd()
  const argv = options.argv ?? buildArgvFromProcess()
  writeLastEnvelopeSync(cwd, envelope, argv)
  process.stdout.write(renderJson(envelope, { brief: options.brief === true }) + '\n')
  process.exit(options.exitCode ?? 1)
}

function writeLastEnvelopeSync(cwd: string, envelope: RecoveryEnvelope, argv: string[]): void {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    command: sanitizeCommandSummary(argv),
    cwd,
    envelope,
  }
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    renameSync(tmp, target)
  } catch {
    // Best-effort: writes are warnings, not errors.
  }
}
```

**Delta to apply (D-51 / I1 / K1):** add `envelopeId` + `auditRef` to `EmitOptions`. At `emitRecoveryEnvelope()` entry, if `options.envelopeId` is undefined, default to `crypto.randomUUID()` (inline). Pass both into `writeLastEnvelopeSync`. The sync writer copies them onto the saved payload.

```ts
import { randomUUID } from 'node:crypto'

export interface EmitOptions extends RecoveryRenderOptions {
  exitCode?: number
  argv?: string[]
  cwd?: string
  /** Phase 25 D-51: pre-generated envelope id. Defaults to crypto.randomUUID() when omitted. */
  envelopeId?: string
  /** Phase 25 D-53: audit entry id captured by caller's writeAuditEntry. Undefined when audit disabled / failed. */
  auditRef?: string
}

export function emitRecoveryEnvelope(
  error: unknown,
  ctx: RecoveryContext,
  options: EmitOptions = {}
): never {
  const envelope = classifyError(error, ctx)
  const cwd = options.cwd ?? process.cwd()
  const argv = options.argv ?? buildArgvFromProcess()
  const envelopeId = options.envelopeId ?? randomUUID()    // ← Phase 25 D-51 / I1
  writeLastEnvelopeSync(cwd, envelope, argv, envelopeId, options.auditRef)
  process.stdout.write(renderJson(envelope, { brief: options.brief === true }) + '\n')
  process.exit(options.exitCode ?? 1)
}

function writeLastEnvelopeSync(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  id: string,                  // ← new
  auditRef: string | undefined // ← new
): void {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    id,                                                  // ← new
    ...(auditRef !== undefined && { audit_ref: auditRef }),  // ← omit when undefined
    savedAt: new Date().toISOString(),
    command: sanitizeCommandSummary(argv),
    cwd,
    envelope,
  }
  // try/catch unchanged (best-effort)
}
```

**Note:** stdout `renderJson(envelope, ...)` is NOT changed — that renders `RecoveryEnvelope` body (D-52 forbids touching the body). Only the on-disk wrapper carries the new fields.

---

### 4. `src/core/recovery/last-envelope.ts` (service, file-I/O async)

**Analog:** self — `src/core/recovery/last-envelope.ts:63-85`

**Current shape:**
```ts
export async function writeLastEnvelope(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  now: () => Date = () => new Date()
): Promise<void> {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    savedAt: now().toISOString(),
    command: sanitizeCommandSummary(argv),
    cwd,
    envelope,
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, target)
  } catch {
    // Best-effort: writes are warnings, not errors.
  }
}
```

**Delta to apply (K1):** parallel to `writeLastEnvelopeSync` — accept optional `id` / `auditRef` and copy onto payload. Default `id` to `randomUUID()` for the async path (some test callers do not pre-generate).

```ts
import { randomUUID } from 'node:crypto'

export async function writeLastEnvelope(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  now: () => Date = () => new Date(),
  id: string = randomUUID(),    // ← Phase 25
  auditRef?: string             // ← Phase 25
): Promise<void> {
  // ... payload construction includes id + (audit_ref when defined)
}
```

**Why the default:** `writeLastEnvelope` is used by tests + the non-emit async path; never producing an id-less wrapper keeps `parseSavedRecoveryEnvelope` round-trip stable. (`recover --from <old-file>` still parses files without `id` because the schema marks it optional.)

---

### 5. `src/core/audit/integration-helper.ts` (service, file-I/O async)

**Analog:** self — `src/core/audit/integration-helper.ts:53-109`

**Current shape:**
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
    // ... build entry ...
    await logger.write(entry)
  } catch {
    // D6: Never throw from audit integration.
  }
}
```

**Delta to apply (D-J / K1 / L5):**

1. `AuditOutcome` gains optional `recovery_ref?: string`.
2. Build the entry with `...(outcome.recovery_ref && { recovery_ref: outcome.recovery_ref })`.
3. Change return type to `Promise<string | null>`.
4. Use `'success' in result` discriminator (L5) to extract `result.id`.

```ts
export interface AuditOutcome {
  success: boolean
  error?: any
  metadata?: Record<string, unknown>
  sql?: string
  target?: string
  recovery_ref?: string   // ← Phase 25 D-J
}

export async function writeAuditEntry(
  config: DbcliConfig,
  commandName: string,
  options: { config?: string; [key: string]: unknown },
  outcome: AuditOutcome
): Promise<string | null> {   // ← Phase 25 D-K / K1
  try {
    const logger = await getAuditLogger(config, options.config || '.dbcli')
    // ... existing engine/target/tier/error/redaction logic unchanged ...

    const entry: Omit<AuditEntry, 'id' | 'ts' | 'session_id'> = {
      engine,
      command: commandName,
      side_effect_tier: tier,
      target,
      success: outcome.success,
      redacted_query: redactArgv(process.argv),
      ...(outcome.sql && { redacted_sql: redactSql(outcome.sql) }),
      ...(errorMessage && { error: errorMessage }),
      ...(outcome.recovery_ref && { recovery_ref: outcome.recovery_ref }),  // ← new
      metadata: outcome.metadata,
    }

    const result = await logger.write(entry)
    return 'success' in result ? result.id : null   // ← Phase 25 L5
  } catch {
    return null                                     // ← Phase 25 D6
  }
}
```

**Backward-compat note:** 17 existing call sites do `await writeAuditEntry(...)` and ignore the return. TS permits dropping the return — no caller breaks. New consumers (catch blocks in `inspect.ts` / `query.ts`) opt in via `const auditId = await writeAuditEntry(...)`.

---

### 6. `src/core/audit/types.ts` (model, request-response)

**Analog:** self — `src/core/audit/types.ts:4-31` (existing `AuditEntry`)

**Existing `AuditEntry` already carries `recovery_ref?: string` (line 24) since Phase 22 D-17. Phase 25 does NOT touch `AuditEntry` itself.**

**Delta to apply (D-59 / G):** add NEW exported type `AuditEntryBrief` as a `Pick` over `AuditEntry`. This is the DOCS-02 contract for `audit_recent` items.

```ts
/**
 * Phase 25 D-59: brief audit entry for DOCS-02 `audit_recent` embeds.
 * Reuses Phase 24 `tail --brief` shape PLUS `id` so agents can client-side
 * join `entry.id === envelope.audit_ref`.
 * PROHIBITED: redacted_query, redacted_sql, metadata, session_id, engine,
 * side_effect_tier (D-59 forbidden keys).
 */
export type AuditEntryBrief = Pick<
  AuditEntry,
  'id' | 'ts' | 'command' | 'target' | 'success'
>
```

**Note:** this differs from `src/commands/audit.ts:88` inline `BriefEntry` (which omits `id`). Phase 24 `tail --brief` stays as-is per Assumption A3.

---

### 7. `src/core/audit/recent.ts` (service / utility, file-I/O async — NEW FILE)

**Analog:** `src/core/audit/reader.ts:55-65 + 98-104` (read+tail) + `src/commands/audit.ts:88-97` (briefify pattern, but with `id` per D-59)

**Reader API to compose (already exists, no change):**
```ts
// src/core/audit/reader.ts:55-65
export async function readEntries(
  auditFilePath: string,
  opts?: ReadOptions
): Promise<AuditEntry[]> {
  if (opts?.include_rotated === true) {
    const rotated = await readSingle(`${auditFilePath}.1`)
    const current = await readSingle(auditFilePath)
    return rotated.concat(current)
  }
  return readSingle(auditFilePath)
}

// src/core/audit/reader.ts:98-104
export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[] {
  if (n <= 0) return []
  return entries
    .slice()
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-n)
}
```

**Briefify pattern (analog from `src/commands/audit.ts:88-97` — Phase 25 ADDS `id`):**
```ts
// Phase 24 brief (NO id) — leave unchanged
type BriefEntry = Pick<AuditEntry, 'ts' | 'command' | 'target' | 'success'>
function briefify(entry: AuditEntry): BriefEntry { ... }
```

**Delta to apply — create new file `src/core/audit/recent.ts`:**

```ts
/**
 * Phase 25 DOCS-02 / D-56..D-61: load recent audit entries for embed
 * in inspect / guide / recover / recover --apply JSON output.
 *
 * Single source of truth for the trigger condition and brief tailoring.
 * Read-only; never throws (errors → []).
 */
import { getAuditLogger } from './integration-helper'
import { readEntries, tailEntries } from './reader'
import type { AuditEntry, AuditEntryBrief } from './types'
import type { DbcliConfig } from '../../utils/validation'

/** Phase 25 D-58: hard-coded. NO --audit-n flag. */
export const RECENT_AUDIT_DEFAULT_N = 5

/**
 * Phase 25 D-57: only embed when output is agent-facing JSON.
 * --for-agent (= json + brief) OR explicit --format json.
 * Human markdown never gets audit_recent.
 */
export function shouldEmbedRecent(opts: {
  forAgent?: boolean
  format: string
}): boolean {
  return opts.forAgent === true || opts.format === 'json'
}

function briefifyForRecent(entry: AuditEntry): AuditEntryBrief {
  return {
    id: entry.id,
    ts: entry.ts,
    command: entry.command,
    target: entry.target,
    success: entry.success,
  }
}

/**
 * Phase 25 D-60: disabled / empty / unavailable / corrupted ALL return [].
 * Phase 25 H: current connection only, include_rotated: true (consistent with
 * Phase 24 audit show --recovery-ref behavior at src/commands/audit.ts:393).
 */
export async function loadRecentAudit(
  config: DbcliConfig,
  configPath: string,
  n: number = RECENT_AUDIT_DEFAULT_N
): Promise<AuditEntryBrief[]> {
  try {
    if (config.audit?.enabled === false) return []
    const logger = await getAuditLogger(config, configPath)
    // Logger exposes its audit file path via getHealth().currentFile.
    const auditFile = logger.getHealth().currentFile
    const entries = await readEntries(auditFile, { include_rotated: true })
    return tailEntries(entries, n).map(briefifyForRecent)
  } catch {
    return []
  }
}
```

**Failure modes intentionally swallowed:** ENOENT (no audit dir), corrupted middle line (reader throws — Phase 24 reader.ts:47), permission, audit disabled. All collapse to `[]` per D-60.

---

### 8. `src/commands/inspect.ts` (controller, request-response) — J1 wired surface

**Analog:** self — `src/commands/inspect.ts:34-84` (full action handler). The D-J catch block template lives here per CONTEXT.md J.

**Current catch block (line 68-83):**
```ts
} catch (err) {
  if (config) {
    await writeAuditEntry(config, 'inspect', options, {
      success: false,
      target: '*',
      error: err,
    })
  }

  if (options.recovery === true) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(err, { operation: 'inspect' })
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

**Delta to apply (D-J / D-K / K1) — patched catch block:**
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
      ...(envelopeId && { recovery_ref: envelopeId }),   // ← Phase 25 D-J
    })
  }

  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(err, { operation: 'inspect' }, {
      envelopeId,                                         // ← Phase 25 D-51
      auditRef: auditId ?? undefined,                     // ← Phase 25 K1
    })
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

**Additional delta — DOCS-02 happy-path injection (after `const snap = await collectInspect(...)`):**
```ts
const snap = await collectInspect({ ... })
// ... requireSchemaCacheOrThrow ...

// Phase 25 DOCS-02 / D-56 / D-57: embed audit_recent on agent JSON paths
if (config && format === 'json' && shouldEmbedRecent({ forAgent, format })) {
  const { loadRecentAudit } = await import('@/core/audit/recent')
  snap.audit_recent = await loadRecentAudit(config, configPath)
}

const out = format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
```

**Note:** `format` for inspect is always `'json'` when `forAgent === true` (line 38). The injection condition simplifies to `shouldEmbedRecent({ forAgent, format })` returning true. Human markdown path never sets `audit_recent` (D-57).

**Import additions:**
```ts
import crypto from 'node:crypto'
import { shouldEmbedRecent } from '@/core/audit/recent'
```

---

### 9. `src/commands/guide.ts` (controller, request-response) — DOCS-02 only

**Analog:** `src/commands/inspect.ts:45-67` (snapshot-build + happy-path render) — guide mirrors inspect's structure

**Current happy-path render (line 73-91):**
```ts
const snap = await collectGuide({
  workspace: process.cwd(),
  configPath,
  goal: validated,
  probe: options.probe === true,
  brief,
  probeTimeoutMs: options.probeTimeout as number,
})

const out =
  format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
console.log(out)

if (config) {
  await writeAuditEntry(config, 'guide', options, {
    success: true,
    target: goal as string,
  })
}
```

**Delta to apply (DOCS-02 only — guide has NO emit envelope, so NO D-J catch patch):**
```ts
const snap = await collectGuide({ ... })

// Phase 25 DOCS-02
if (config && format === 'json' && shouldEmbedRecent({ forAgent, format })) {
  const { loadRecentAudit } = await import('@/core/audit/recent')
  snap.audit_recent = await loadRecentAudit(config, configPath)
}

const out = format === 'markdown' ? renderMarkdown(snap, { brief }) : renderJson(snap, { brief })
```

**Catch block (line 92-102): NOT modified.** Guide does not call `emitRecoveryEnvelope`. CONTEXT.md addendum + J1 scope: only commands that today have BOTH `writeAuditEntry` AND `emitRecoveryEnvelope` get the bi-directional ref. Guide gets DOCS-02 audit_recent only.

---

### 10. `src/commands/recover.ts` (controller, file-I/O + request-response) — DOCS-02 dual injection

**Analog:** self — `src/commands/recover.ts:223-292` (action handler with two JSON print sites)

**Current print sites (lines 264-282):**
```ts
if (options.apply !== true) {
  const out =
    format === 'markdown' ? renderMarkdown(source.envelope) : renderJson(source.envelope)
  console.log(out)
  return
}

const noVerify = options.verify === false
const result = await runApply(
  {
    envelope: source.envelope,
    cwd: source.cwd,
    source: { kind: source.kind, path: source.path },
  },
  { allowWrite, noVerify }
)

const out = format === 'markdown' ? renderApplyJson(result) : renderApplyMarkdown(result)
console.log(out)
process.exit(exitCodeFor(result.finalStatus))
```

**Delta to apply (DOCS-02 / L8 / L-recover):**

1. After `resolveApplySource(...)` returns, lazily load config + audit_recent ONCE (per L8).
2. At the no-apply JSON print site, build `{ ...source.envelope, audit_recent }` and stringify directly (NOT through `renderJson` — D-52 forbids `RecoveryEnvelope` body extension).
3. At the `--apply` JSON print site, wrap `{ ...result, audit_recent }` similarly.
4. Both sites only inject when `format === 'json'` AND `audit_recent` was actually loaded (D-57 / D-60).
5. `--next` branch (line 257-262): **NOT touched (L2)** — out of Phase 25 scope.

```ts
const source = await resolveApplySource({ from: options.from as string | undefined, cwd: process.cwd() })

// Phase 25 DOCS-02 — load once, share between both JSON paths
let audit_recent: AuditEntryBrief[] = []
if (format === 'json') {
  try {
    const { configModule } = await import('@/core/config')
    // recover.ts does not currently have access to a commander instance with --config;
    // use process.cwd() as the conventional path resolver entry (matches existing
    // `recover` invocation pattern where config is auto-discovered).
    const cwd = process.cwd()
    const configPath = `${cwd}/.dbcli`
    const config = await configModule.read(configPath)
    const { loadRecentAudit } = await import('@/core/audit/recent')
    audit_recent = await loadRecentAudit(config, configPath)
  } catch {
    audit_recent = []  // D-60
  }
}

if (options.next === true) {
  // unchanged — L2 out of scope
}

if (options.apply !== true) {
  if (format === 'markdown') {
    console.log(renderMarkdown(source.envelope))
  } else {
    // D-52: cannot put audit_recent on RecoveryEnvelope body type. Wrap at print site.
    console.log(JSON.stringify({ ...source.envelope, audit_recent }, null, 2))
  }
  return
}

// --apply path
const result = await runApply({ ... }, { allowWrite, noVerify })
if (format === 'markdown') {
  console.log(renderApplyMarkdown(result))
} else {
  console.log(JSON.stringify({ ...result, audit_recent }, null, 2))
}
process.exit(exitCodeFor(result.finalStatus))
```

**Important constraints:**
- Per L6: `recover` does NOT have a `--for-agent` flag. The trigger is purely `format === 'json'` (auto-true for `--apply` / `--next`; opt-in via `--format json` for envelope-print).
- Per L9: `recover --from <external>` still embeds current cwd's audit_recent — that is intentional ("hand-off context for this session").
- Per F1: `recover --apply` itself does NOT call `writeAuditEntry` (aligns with Phase 24 F decision).

---

### 11. `src/commands/query.ts` (controller, request-response) — J1 wired surface

**Analog:** `src/commands/inspect.ts:68-83` catch block (D-J template)

**Current catch block (line 165-202):**
```ts
} catch (error) {
  if (config) {
    await writeAuditEntry(config, 'query', options, {
      success: false,
      sql,
      error,
    })
  }

  if (options.recovery === true) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(error, {
      operation: 'query',
      table: (await import('@/utils/engine-hints')).extractTableName(sql) ?? undefined,
    })
  }

  // ... typed error rendering (BlacklistError / PermissionError / ConnectionError) ...
```

**Delta to apply (D-J / D-K / J1):** apply the same template as `inspect.ts:68-83`, with the SQL-aware emit context preserved.

```ts
} catch (error) {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()
  }
  if (config) {
    auditId = await writeAuditEntry(config, 'query', options, {
      success: false,
      sql,
      error,
      ...(envelopeId && { recovery_ref: envelopeId }),
    })
  }

  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(error, {
      operation: 'query',
      table: (await import('@/utils/engine-hints')).extractTableName(sql) ?? undefined,
    }, {
      envelopeId,
      auditRef: auditId ?? undefined,
    })
  }

  // ... typed error rendering unchanged ...
```

**Out of scope (L3):** the outer catch in `src/cli.ts:149-159` is a duplicate fallback — do NOT modify it. It only fires if the inner catch lets an error escape (rare; inner already process.exits).

---

### 12. `src/core/inspect/types.ts` (model, request-response)

**Analog:** self — `src/core/inspect/types.ts:64-75` (InspectSnapshot)

**Current shape:**
```ts
export interface InspectSnapshot {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION
  system: SnapshotSystem | null
  connection: ConnectionSection
  permission: PermissionSection
  blacklist: BlacklistSection
  objects: ObjectsSection
  schemaCache: SchemaCacheSection
  snippets: SnippetsSection
  suggestedCommands: string[]
  warnings: string[]
}
```

**Delta to apply (G1):** append optional `audit_recent?: AuditEntryBrief[]` after `warnings`. Additive optional field — `INSPECT_SCHEMA_VERSION` stays at 1 (assumption A2 covered by D-54-equivalent agent forward-compat).

```ts
import type { AuditEntryBrief } from '@/core/audit/types'

export interface InspectSnapshot {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION
  system: SnapshotSystem | null
  connection: ConnectionSection
  permission: PermissionSection
  blacklist: BlacklistSection
  objects: ObjectsSection
  schemaCache: SchemaCacheSection
  snippets: SnippetsSection
  suggestedCommands: string[]
  warnings: string[]
  /** Phase 25 DOCS-02: last N audit entries (brief shape). Only populated on agent JSON paths. */
  audit_recent?: AuditEntryBrief[]
}
```

---

### 13. `src/core/guide/types.ts` (model, request-response)

**Analog:** `src/core/inspect/types.ts:64-75` — same placement pattern

**Current shape (line 60-71):**
```ts
export interface GuideSnapshot {
  schemaVersion: typeof GUIDE_SCHEMA_VERSION
  generatedAt: string
  goal: GuideGoalId
  context: InspectSnapshot
  steps: GuideStep[]
  warnings: GuideWarning[]
}
```

**Delta to apply (G1):**
```ts
import type { AuditEntryBrief } from '@/core/audit/types'

export interface GuideSnapshot {
  schemaVersion: typeof GUIDE_SCHEMA_VERSION
  generatedAt: string
  goal: GuideGoalId
  context: InspectSnapshot
  steps: GuideStep[]
  warnings: GuideWarning[]
  /** Phase 25 DOCS-02: last N audit entries (brief shape). Only populated on agent JSON paths. */
  audit_recent?: AuditEntryBrief[]
}
```

**Note:** `context: InspectSnapshot` already has its own `audit_recent?` field after delta 12, but populating it in `collectGuide` is wasted work — `guide` injects `audit_recent` at the top-level `GuideSnapshot`, not nested under `context`. Document this in the test (DOCS-02 contract: agent reads `top_level.audit_recent`, not `context.audit_recent`).

---

### 14. `src/core/recovery/render-json.ts` (utility, transform)

**Analog:** self — already verbatim from § Read above.

**Current shape (line 4-7):**
```ts
export function renderJson(env: RecoveryEnvelope, options: RecoveryRenderOptions = {}): string {
  const out = options.brief ? toBrief(env) : env
  return JSON.stringify(out, null, 2)
}
```

**Delta to apply: NONE.** D-52 forbids embedding `audit_recent` in `RecoveryEnvelope` body. The injection happens at the `recover.ts` print site via direct `JSON.stringify({ ...envelope, audit_recent })`.

---

### 15. `src/core/recovery/apply-render-json.ts` (utility, transform)

**Analog:** self

**Current shape:**
```ts
export function renderApplyJson(result: ApplyResult): string {
  return JSON.stringify(result, null, 2)
}
```

**Delta to apply: NONE** (same rationale as render-json.ts). `recover.ts` wraps `{ ...result, audit_recent }` at the print site.

Alternative (planner discretion): if injecting via `ApplyResult` is cleaner, add `audit_recent?: AuditEntryBrief[]` to `ApplyResult` (`apply-types.ts:79-92`). The recommendation is to keep `ApplyResult` clean of render-only state and wrap at the print site — same pattern as `recover.ts` for the envelope-print branch. Both branches stay symmetric.

---

### 16. `src/core/recovery/next-render-json.ts` (utility, transform)

**OUT OF SCOPE — L2.** `recover --next` is not in DOCS-02 (D-56 lists 4 commands; `--next` is a 5th JSON path explicitly excluded). Do not modify.

---

### 17. `tests/integration/recovery-audit-link.test.ts` (test — NEW FILE)

**Analog:** `tests/integration/audit-envelope.test.ts` (Phase 24 envelope contract). Located parallel; uses same `bun test` framework + isolated tmpdir fixture pattern.

**Coverage matrix (per CONTEXT.md E + Scope Addendum):**

| # | Scenario | Type | Release-blocking? |
|---|----------|------|-------------------|
| 1 | `dbcli query <bad-sql> --recovery` → audit entry has `recovery_ref` AND saved envelope has matching `id` | round-trip | **YES** (INTEGRATE-02 + INTEGRATE-03) |
| 2 | Saved envelope `audit_ref` matches the audit entry's `id` | round-trip | **YES** |
| 3 | `dbcli inspect --recovery` (intentional failure) → same round-trip | round-trip on inspect surface | **YES** |
| 4 | J1 coverage: `dbcli insert <bad> --recovery` → envelope written, `audit_ref` is undefined, no audit entry exists | asymmetry guard | YES (negative contract) |
| 5 | `dbcli inspect --for-agent` JSON contains `audit_recent: []` when audit disabled (`audit.enabled=false`) | DOCS-02 | standard |
| 6 | `dbcli inspect --for-agent` JSON contains `audit_recent: [{...5 entries...}]` when audit has 10 entries | DOCS-02 / N=5 cap | standard |
| 7 | `audit_recent` items have ONLY `{id, ts, command, target, success}` — forbidden keys absent (`redacted_query`, `metadata`, `session_id`, `engine`, `side_effect_tier`) | D-59 brief shape | standard |
| 8 | Same for `dbcli guide <goal> --for-agent`, `dbcli recover --format json`, `dbcli recover --apply` | DOCS-02 4-surface | standard |
| 9 | Old envelope fixture (no `id` / `audit_ref`) `recover --from <old.json>` parses without error | D-54 back-compat | standard |
| 10 | Audit dir missing → `audit_recent: []` (not an error) | D-60 fall-through | standard |

**Reference patterns to mirror from `tests/integration/audit-envelope.test.ts`:**
- isolated `.dbcli/audit/` tmpdir per test
- `bun run src/cli.ts ... --config <tmpdir>/.dbcli` invocation
- `JSON.parse(stdout)` then assert keys / shape
- meta-guard test that asserts Phase 22 audit-contract test file (line `tests/integration/audit-contract.test.ts`) is NOT modified by Phase 25

---

## Shared Patterns

### Pattern: D-J catch block template (wired surface)
**Source:** CONTEXT.md `<decisions>` § J  + `src/commands/inspect.ts:68-83` (current canonical)
**Apply to:** `src/commands/inspect.ts`, `src/commands/query.ts` (J1 wired surface only — 2 files)
**NOT applied to:** `guide.ts` (no emit), `insert/update/delete/export/q/schema.ts` (no audit — J1 defer)
**Excerpt (copy-paste-ready):**
```ts
} catch (err) {
  let auditId: string | null = null
  let envelopeId: string | undefined
  if (options.recovery === true) {
    envelopeId = crypto.randomUUID()
  }
  if (config) {
    auditId = await writeAuditEntry(config, '<commandName>', options, {
      success: false,
      target: '<target>',
      error: err,
      ...(envelopeId && { recovery_ref: envelopeId }),
    })
  }
  if (envelopeId !== undefined) {
    const { emitRecoveryEnvelope } = await import('@/core/recovery')
    emitRecoveryEnvelope(err, { operation: '<commandName>', /* table?: */ }, {
      envelopeId,
      auditRef: auditId ?? undefined,
    })
  }
  console.error((err as Error).message)
  process.exit(1)
}
```

### Pattern: DOCS-02 audit_recent injection (4 commands)
**Source:** `src/core/audit/recent.ts` (new module — see § 7)
**Apply to:** `inspect.ts`, `guide.ts`, `recover.ts` (both no-apply + --apply branches) — 4 surfaces total
**Trigger (D-57):** `format === 'json'` AND (`forAgent === true` OR explicit `--format json`)
**Excerpt:**
```ts
// snapshot-based commands (inspect / guide)
if (config && format === 'json' && shouldEmbedRecent({ forAgent, format })) {
  const { loadRecentAudit } = await import('@/core/audit/recent')
  snap.audit_recent = await loadRecentAudit(config, configPath)
}

// recover (no snapshot type to mutate — wrap at print site)
const audit_recent = format === 'json'
  ? await loadRecentAudit(config, configPath).catch(() => [])
  : []
console.log(JSON.stringify({ ...source.envelope, audit_recent }, null, 2))
```

### Pattern: Read-only reader composition
**Source:** `src/core/audit/reader.ts:55-65` + `src/core/audit/reader.ts:98-104`
**Apply to:** `src/core/audit/recent.ts` (only consumer for DOCS-02; H1 decision)
**Excerpt:** see § 7. Always pass `{ include_rotated: true }` (consistent with `src/commands/audit.ts:393` recovery-ref lookup).

### Pattern: D-60 fall-through (DOCS-02 error tolerance)
**Source:** CONTEXT.md D-60 + D-H + `src/core/audit/reader.ts:31-34` (ENOENT → `[]`)
**Apply to:** every call to `loadRecentAudit` — `inspect.ts` / `guide.ts` / `recover.ts`
**Rule:** disabled / empty / unavailable / corrupted ALL collapse to `audit_recent: []`. DOCS-02 NEVER fails the parent command. The reader's stderr warning on truncated last line is permitted (matches Phase 24 behavior).

### Pattern: AuditWriteResult discriminator (L5)
**Source:** `src/core/audit/logger.ts:42-47` + `tests/integration/audit-contract.test.ts:47` precedent
**Apply to:** `src/core/audit/integration-helper.ts` (writeAuditEntry return-path)
**Excerpt:**
```ts
// L5 — use 'success' in result (NOT result.success — only the success variant has it)
const result = await logger.write(entry)
return 'success' in result ? result.id : null
```

### Pattern: D-52 wrapper-vs-body separation
**Source:** CONTEXT.md `<decisions>` § D-52
**Apply to:** all envelope-related deltas
**Rule:** `id` / `audit_ref` go on `SavedRecoveryEnvelope` wrapper (apply-types.ts + envelope-schema.ts).
**Forbidden:** touching `RecoveryEnvelope` body type (`src/core/recovery/types.ts:66-77`) or `RECOVERY_SCHEMA_VERSION`. The stdout JSON shape from `emitRecoveryEnvelope` MUST stay unchanged so agent clients un-broken (the saved file gets new wrapper fields; stdout does not).

---

## No Analog Found

None. All Phase 25 files have either a self-analog (in-place modification) or a strong codebase analog (`src/core/audit/reader.ts` for `recent.ts`, `tests/integration/audit-envelope.test.ts` for the new contract test).

---

## J1 Coverage Matrix (deliverable per CONTEXT.md Scope Addendum)

| Command | Has `writeAuditEntry` today? | Has `emitRecoveryEnvelope` today? | Phase 25 bi-directional ref? | Phase 25 DOCS-02? |
|---------|------------------------------|-----------------------------------|------------------------------|---------------------|
| `query` | YES (`query.ts:167`) | YES (`query.ts:175`) | **YES (J1 wired)** | N/A (no JSON output type) |
| `inspect` | YES (`inspect.ts:63, 70`) | YES (`inspect.ts:78`) | **YES (J1 wired)** | **YES** |
| `guide` | YES (`guide.ts:87, 94`) | NO | N/A (no emit to link) | **YES** |
| `recover` | NO (F1 — not self-audit) | N/A (recover RENDERS envelope, doesn't emit) | N/A | **YES** (both branches) |
| `report` | YES (`report.ts:87, 97`) | NO | N/A | NO |
| `doctor` | YES (`doctor.ts:733`) | NO | N/A | NO |
| `plan` | YES (`plan.ts:51, 68`) | NO | N/A | NO |
| `insert` | **NO** | YES (`insert.ts:275` + `cli.ts:214`) | **NO (defer Phase 23-04)** | N/A |
| `update` | **NO** | YES (`update.ts:307` + `cli.ts:242`) | **NO (defer Phase 23-04)** | N/A |
| `delete` | **NO** | YES (`delete.ts:276` + `cli.ts:269`) | **NO (defer Phase 23-04)** | N/A |
| `export` | **NO** | YES (`export.ts:146` + `cli.ts:302`) | **NO (defer Phase 23-04)** | N/A |
| `q` | **NO** | YES (`q.ts:219`) | **NO (defer Phase 23-04)** | N/A |
| `schema` | **NO** | YES (`schema.ts:223`) | **NO (defer Phase 23-04)** | N/A |

Source for current call-site state: `grep writeAuditEntry src/commands/` + `grep emitRecoveryEnvelope src/` (run 2026-05-15).

---

## Metadata

**Analog search scope:** `src/core/recovery/`, `src/core/audit/`, `src/commands/`, `src/core/inspect/`, `src/core/guide/`, `tests/integration/`
**Files read:** apply-types.ts, envelope-schema.ts, emit.ts, last-envelope.ts, integration-helper.ts, types.ts (audit), reader.ts, logger.ts (lines 35-235), inspect.ts (command), guide.ts (command), query.ts (command), recover.ts (command), audit.ts (command, lines 75-175), render-json.ts (recovery), apply-render-json.ts, next-render-json.ts, render-json.ts (inspect), render-json.ts (guide), inspect types.ts, guide types.ts
**Pattern extraction date:** 2026-05-15

## PATTERN MAPPING COMPLETE
