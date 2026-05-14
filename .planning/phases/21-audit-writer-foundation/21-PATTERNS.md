# Phase 21: Audit Writer Foundation — Pattern Map

**Generated:** 2026-05-14
**Source:** `21-CONTEXT.md` decisions D-01..D-16
**Files analyzed:** 6 new files + 2 modified files
**Analogs found:** 8 / 8 (100% coverage)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/audit/logger.ts` (NEW) | service / stateful writer | request-response (async write) | `src/core/concurrent-lock.ts` + `src/core/schema-writer.ts` | exact (class skeleton + lock semantics) |
| `src/core/audit/session-id.ts` (NEW) | service / state cache | file-I/O | `src/core/recovery/last-envelope.ts` | exact (atomic tmp+rename, lazy mkdir, PID-stamped JSON) |
| `src/core/audit/lock.ts` (NEW) | utility / lock manager | request-response (short retry) | `src/core/concurrent-lock.ts` | exact (lockfile + exp backoff + stale cleanup) — change tunings only |
| `src/core/audit/rotation.ts` (NEW, planner discretion) | utility | file-I/O | *no direct analog* — fresh code; mirrors `AtomicFileWriter` rename pattern | role-match only |
| `src/utils/validation.ts` (MODIFIED) | config | schema | existing `DbcliConfigV2Schema` body in same file | exact — add `audit` block alongside `blacklist` |
| `src/core/config.ts` (MODIFIED, CONFIG-03) | config-loader migration | transform | existing zod defaults + `DbcliConfigSchema.parse(...)` flow | exact (no procedural migration needed — zod defaults absorb missing fields) |
| `tests/unit/core/audit/*.test.ts` (NEW) | test | unit | `tests/unit/core/concurrent-lock.test.ts` | exact (tmpdir + Bun.spawn cleanup style) |
| `tests/integration/core/audit-concurrent.test.ts` (NEW) | test | concurrent integration | `tests/integration/recovery.test.ts` (subprocess spawn) + `tests/unit/core/schema-cache.test.ts` (Promise.all) | role-match (no existing multi-process file-lock test) |

---

## Pattern Assignments

### NEW: `src/core/audit/logger.ts` — `AuditLogger` (class, long-lived service)

**Role:** Stateful service. Long-lived per process. Public async `write(entry)` API. `getHealth()` introspection container.
**Closest analog:** `src/core/concurrent-lock.ts` (`ConcurrentLockManager` — class with state, lockfile interaction, exp backoff, `withLock` wrapper) and `src/core/schema-writer.ts` (`SchemaWriter` — class taking `dbcliPath` in constructor, async ops that write to layered files).

**Why:** `AuditLogger` is the **same shape** as `ConcurrentLockManager`: a class constructed once with a path + tunables, holding internal state (here: sessionId cache, sticky `lastError`, rotation counters, lock handle), exposing async methods. `SchemaWriter` shows how multiple file-system operations get composed inside one class method while staying short and pure.

#### Class skeleton excerpt (analog: `src/core/concurrent-lock.ts:16-25`)

```ts
export class ConcurrentLockManager {
  private lockPath: string
  private lockAcquiredAt: number | null = null
  private lockTimeoutMs: number

  constructor(dbcliPath: string, lockTimeoutMs: number = 30000) {
    this.lockPath = join(dbcliPath, 'schema.lock')
    this.lockTimeoutMs = lockTimeoutMs
  }
```

**Replicate as:**
```ts
export class AuditLogger {
  private readonly storagePath: string                        // resolved storage root
  private readonly auditDir: string                           // join(storagePath, 'audit')
  private readonly connectionName: string                     // D-14: 'default' for V1
  private readonly rotation: { maxBytes: number; maxEntries: number }
  private readonly enabled: boolean
  private sessionIdService: SessionIdService
  private lockManager: AuditLockManager
  private currentEntryCount: number = 0
  private currentSizeBytes: number = 0
  private lastWrite: { ts: string; success: boolean; error?: string } | null = null
  private lastError: { ts: string; message: string } | null = null   // sticky for D-16
  private warnedOnceThisProcess: boolean = false                     // D-16 cadence

  constructor(opts: {
    storagePath: string
    connectionName: string
    enabled: boolean
    rotation: { maxBytes: number; maxEntries: number }
    sessionIdService: SessionIdService
  }) { /* … */ }
```

#### withLock-style wrapper (analog: `src/core/concurrent-lock.ts:171-182`)

```ts
async withLock<T>(
  operation: () => Promise<T>,
  operationName: string = 'schema-update'
): Promise<T> {
  await this.acquireLock(operationName)
  try {
    return await operation()
  } finally {
    await this.releaseLock()
  }
}
```

**Replicate as:** `AuditLogger.write(entry)` internally calls `this.lockManager.withLock(async () => { ...rotation check + append... })` and returns success/warning irrespective of lock failure (D-07 fail-soft).

#### Composed file ops inside one method (analog: `src/core/schema-writer.ts:36-80`)

```ts
async save(schema: Record<string, TableSchema>, connectionName?: string): Promise<void> {
  const schemaRoot = resolveSchemaPath(this.dbcliPath, connectionName)

  // 1. Build Index using the existing builder
  const index = await SchemaIndexBuilder.buildIndex({ schema })

  // 2. Save Index file
  await SchemaIndexBuilder.saveIndex(this.dbcliPath, index, connectionName)

  // 3. Calculate file mapping
  const mapping = SchemaIndexBuilder.calculateFileMapping(index)

  // 4. Persist Hot Schemas
  // ...
}
```

**Replicate as:** `AuditLogger.write()` does (1) short-circuit if disabled → return `{ skipped: 'disabled' }`; (2) lazy-mkdir auditDir on first call (D-12); (3) resolve sessionId via injected `SessionIdService`; (4) acquire lock; (5) check rotation thresholds; (6) `O_APPEND` the line; (7) release lock; (8) update counters + `lastWrite`.

#### Error-handling pattern (analog: `src/core/recovery/last-envelope.ts:78-85`)

```ts
try {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, target)
} catch {
  // Best-effort: writes are warnings, not errors.
}
```

**Replicate exactly for D-06 / STORE-04 fail-soft.** All filesystem errors inside `AuditLogger.write()` are caught, recorded in `this.lastError`, surfaced **once** to stderr via `this.warnedOnceThisProcess`, and never thrown.

#### `getHealth()` introspection (no direct analog — fresh signature)

The `ConcurrentLockManager.isLockHeld()` / `getLockAge()` are the spiritual ancestor:

```ts
// src/core/concurrent-lock.ts:146-160
isLockHeld(): boolean {
  return this.lockAcquiredAt !== null
}
getLockAge(): number | null {
  if (!this.lockAcquiredAt) return null
  return Date.now() - this.lockAcquiredAt
}
```

**Replicate as one consolidated method** returning a `AuditHealthReport` object (see CONTEXT.md planner discretion for the field list). Phase 21 only exposes the API; Phase 24 wires `dbcli audit health` to print it.

**Test analog:** `tests/unit/core/concurrent-lock.test.ts` — see Concurrent-test analog section below.

---

### NEW: `src/core/audit/session-id.ts` — `SessionIdService`

**Role:** Class with state cache; reads / writes `.dbcli/last-session-id` JSON file atomically.
**Closest analog:** `src/core/recovery/last-envelope.ts` (`writeLastEnvelope` / `readLastEnvelope` — atomic tmp+rename of a small JSON state file with `savedAt`, `cwd`, payload).

**Why:** `.dbcli/last-session-id` is structurally identical to `.dbcli/last-recovery.json`: a small JSON blob with `{schemaVersion?, savedAt, pid?, ...}` written atomically and read tolerantly. Same lazy-mkdir, same swallow-errors-on-write semantics. The only twist for Phase 21: **read also performs PID comparison and may regenerate** (D-13).

#### Atomic write + lazy mkdir (analog: `src/core/recovery/last-envelope.ts:63-85`)

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

**Replicate exactly with these substitutions:**
- `LAST_ENVELOPE_PATH = '.dbcli/last-recovery.json'` → `LAST_SESSION_ID_PATH = '.dbcli/last-session-id'`
- payload shape from D-13: `{ sessionId: string; pid: number; createdAt: string }`
- writes are still best-effort (silent catch); next read regenerates on failure.

#### Tolerant read (analog: `src/core/recovery/last-envelope.ts:87-100`)

```ts
export async function readLastEnvelope(cwd: string): Promise<SavedRecoveryEnvelope | null> {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  try {
    await stat(target)
  } catch {
    return null
  }
  try {
    const raw = await readFile(target, 'utf8')
    return JSON.parse(raw) as SavedRecoveryEnvelope
  } catch {
    return null
  }
}
```

**Replicate as:** `readSessionIdFile(storagePath)` returns `{sessionId, pid, createdAt} | null`. Caller (`SessionIdService.resolve()`) then compares `pid !== process.pid` → regenerate; otherwise reuse cached id.

#### Class skeleton (combine with `ConcurrentLockManager` ctor pattern)

```ts
export class SessionIdService {
  private cached: string | null = null
  constructor(private readonly storagePath: string) {}

  async resolve(): Promise<string> {
    if (this.cached) return this.cached
    // 1. env
    const fromEnv = process.env.DBCLI_SESSION_ID
    if (fromEnv) { this.cached = fromEnv; return fromEnv }
    // 2. .dbcli/last-session-id (PID match)
    const saved = await readSessionIdFile(this.storagePath)
    if (saved && saved.pid === process.pid) { this.cached = saved.sessionId; return saved.sessionId }
    // 3. generate + write back
    const id = generate()        // `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`
    await writeSessionIdFile(this.storagePath, { sessionId: id, pid: process.pid, createdAt: new Date().toISOString() })
    this.cached = id
    return id
  }
}
```

**Generation spec (D-2, specifics):** `crypto.randomBytes(3).toString('hex')` — 6 hex chars, not cryptographic strength, just same-ms anti-collision.

**Test analog:** mirror `tests/unit/core/recovery/*.test.ts` style (no `recovery-last-envelope.test.ts` exists; create `tests/unit/core/audit/session-id.test.ts` using `tmpdir()` + `mkdtemp` pattern from `tests/integration/recovery.test.ts:48-58`).

---

### NEW: `src/core/audit/lock.ts` — `AuditLockManager`

**Role:** Lock manager with **short retry budget** (~200ms, D-07). Per-file lock at `.dbcli/audit/<conn>.jsonl.lock` (D-06).
**Closest analog:** `src/core/concurrent-lock.ts` — copy the **mechanism**, change **tunings**.

**Why:** D-05 explicitly says *"不直接 reuse `ConcurrentLockManager`（後者 30s timeout + 10–500ms backoff 為 schema write 設計，對高頻 audit 過重）"*. We copy the lockfile creation + stale-detect + exp-backoff mechanism but swap the constants.

#### Exp backoff loop (analog: `src/core/concurrent-lock.ts:37-61`)

```ts
async acquireLock(operationName: string = 'schema-update'): Promise<boolean> {
  const startTime = Date.now()
  let backoffMs = 10

  while (true) {
    const elapsed = Date.now() - startTime
    if (elapsed > this.lockTimeoutMs) {
      throw new Error(
        `Lock acquisition timeout after ${elapsed}ms for operation: ${operationName}`
      )
    }
    if (await this.tryAcquireLock(operationName)) {
      this.lockAcquiredAt = Date.now()
      return true
    }
    const waitTime = Math.min(backoffMs, 500)
    await new Promise((resolve) => setTimeout(resolve, waitTime))
    backoffMs = Math.min(backoffMs * 1.5, 500)
  }
}
```

**Replicate with these changes for Phase 21:**
1. **Total budget ~200ms** (CONTEXT planner-discretion suggests 200ms); make it a private const `LOCK_RETRY_BUDGET_MS = 200`. Not exposed via config.
2. **Backoff range 5ms → 50ms** (CONTEXT discretion). Replace `let backoffMs = 10` with `let backoffMs = 5` and ceilings 500 → 50.
3. **On budget exhaustion: DO NOT throw.** Return `false` so caller (`AuditLogger.write`) can fail-soft per D-07 (skip entry + sticky `lastError`).

#### Stale-lock detection (analog: `src/core/concurrent-lock.ts:100-138`)

```ts
private async tryAcquireLock(operationName: string): Promise<boolean> {
  try {
    const lockFile = Bun.file(this.lockPath)

    // If lock already exists, check if it's stale
    if (await lockFile.exists()) {
      const lockContent = await lockFile.json()
      const lockAge = Date.now() - lockContent.timestamp

      const staleLockThresholdMs = this.lockTimeoutMs * 3
      if (lockAge > staleLockThresholdMs) {
        await Bun.spawn(['rm', '-f', this.lockPath]).exited
      } else {
        return false
      }
    }

    const lockData = {
      pid: process.pid,
      operation: operationName,
      timestamp: Date.now(),
      hostname: require('os').hostname(),
    }
    const tempPath = `${this.lockPath}.${Date.now()}.tmp`
    const tempFile = Bun.file(tempPath)
    await Bun.write(tempFile, JSON.stringify(lockData))
    const moveResult = await Bun.spawn(['mv', tempPath, this.lockPath]).exited
    return moveResult === 0
  } catch {
    return false
  }
}
```

**Replicate exactly**, with stale threshold tuned to e.g. `LOCK_RETRY_BUDGET_MS * 10` (= ~2s) — short enough for a high-frequency writer, long enough to survive routine I/O hiccups. CONTEXT §specifics also notes the additional refinement: *"若拿到 lock 但 PID 已死則視為 stale 並 takeover"* — recommended but **optional** (D-13 says we don't `kill(pid, 0)` for sessionId; same pragmatic restraint applies here).

#### Release pattern (analog: `src/core/concurrent-lock.ts:70-89`)

```ts
async releaseLock(): Promise<boolean> {
  if (!this.lockAcquiredAt) return false
  try {
    const lockFile = Bun.file(this.lockPath)
    if (await lockFile.exists()) {
      await Bun.spawn(['rm', '-f', this.lockPath]).exited
    }
    this.lockAcquiredAt = null
    return true
  } catch (error) {
    throw new Error(
      `Lock release failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
```

**Replicate**, but for audit context the release-failure case should also be downgraded to fail-soft (caught + logged into sticky `lastError`, no throw) since we never want audit-internal errors to surface up the engine call chain.

**Test analog:** `tests/unit/core/concurrent-lock.test.ts` — see lines 10-31 (acquire/release roundtrip), 80-102 (timeout). Adapt for `AuditLockManager`: success should be `false` (not throw) when budget exhausted.

---

### NEW: `src/core/audit/rotation.ts` (planner discretion — may stay inline in `logger.ts`)

**Role:** Pure function `shouldRotate(stats, thresholds) → boolean` + `rotate(currentPath, previousPath)`.
**Closest analog:** None exact. Closest is `AtomicFileWriter.write()`'s rename step (`src/core/atomic-writer.ts:87`) which uses `Bun.spawn(['mv', ...]).exited`.

```ts
// src/core/atomic-writer.ts:86-90
const moveResult = await Bun.spawn(['mv', tempPath, filePath]).exited
if (moveResult !== 0) {
  throw new Error(`Atomic rename failed with exit code ${moveResult}`)
}
```

**Replicate as:**

```ts
// pseudo-shape
export async function rotateIfNeeded(opts: {
  currentPath: string          // .dbcli/audit/<conn>.jsonl
  previousPath: string         // .dbcli/audit/<conn>.jsonl.1
  currentSizeBytes: number
  currentEntryCount: number
  maxBytes: number             // 10485760 default
  maxEntries: number           // 1000 default
}): Promise<{ rotated: boolean; previousFile?: string; rotatedAt?: string }> {
  if (opts.currentSizeBytes < opts.maxBytes && opts.currentEntryCount < opts.maxEntries) {
    return { rotated: false }
  }
  // D-09: single rolling old segment; overwrite .1 if it exists.
  // fs.rename within same filesystem is atomic (CONTEXT discretion).
  await Bun.spawn(['mv', '-f', opts.currentPath, opts.previousPath]).exited
  return { rotated: true, previousFile: opts.previousPath, rotatedAt: new Date().toISOString() }
}
```

**Note on append vs Bun.file:** For the actual line-append, use `fs.appendFile` (which uses `O_APPEND` on POSIX) rather than `Bun.write` (which is replace-write). Quoting D-08: *"每筆 entry 寫入透過 `O_APPEND + write` 完整單行，避免行內中斷"*. Pattern:

```ts
import { appendFile } from 'node:fs/promises'
const line = JSON.stringify(entry) + '\n'
await appendFile(currentPath, line, { encoding: 'utf8' })   // O_APPEND under the hood
```

No `fsync` (D-08 explicit). No tmp+rename for entries (only for rotation rename).

**Test analog:** create `tests/unit/core/audit/rotation.test.ts`. Pattern: pre-seed a fixture file at the bytes/entry threshold, call `rotateIfNeeded`, assert `.jsonl.1` exists with old content + `.jsonl` rotated.

---

### MODIFIED: `src/utils/validation.ts` — extend `DbcliConfigV2Schema` with `audit.*`

**Role:** Zod schema extension. **No procedural migration** needed for CONFIG-03 — zod `.default(...)` absorbs missing fields automatically on parse, exactly like `blacklist` and `metadata` already do.
**Closest analog:** the same file. See how `BlacklistConfigSchema` and `MetadataSchema` are declared with `.optional().default(...)` and then dropped into `DbcliConfigV2Schema`.

#### Existing pattern (excerpt: `src/utils/validation.ts:113-144`)

```ts
export const MetadataSchema = z
  .object({
    createdAt: z.string().datetime().optional(),
    version: z.string().default('1.0'),
    schemaLastUpdated: z.string().datetime().optional(),
    schemaTableCount: z.number().int().nonnegative().optional(),
  })
  .optional()
  .default({})

export const BlacklistConfigSchema = z
  .object({
    tables: z.array(z.string()).default([]),
    columns: z.record(z.array(z.string())).default({}),
  })
  .optional()
  .default({ tables: [], columns: {} })
```

#### Existing V2 root (excerpt: `src/utils/validation.ts:186-202`)

```ts
export const DbcliConfigV2Schema = z
  .object({
    version: z.literal(2),
    default: z.string().min(1),
    connections: z.record(NamedConnectionSchema).refine((conns) => Object.keys(conns).length > 0, {
      message: 'At least one connection is required',
    }),
    schema: z.record(z.any()).optional().default({}),
    schemas: z.record(z.record(z.any())).optional().default({}),
    metadata: MetadataSchema,
    blacklist: BlacklistConfigSchema,
  })
  .refine((config) => config.default in config.connections, {
    message: 'Default connection must exist in connections',
    path: ['default'],
  })
```

**Replicate as:**

```ts
// New schema, declared above DbcliConfigV2Schema in src/utils/validation.ts
export const AuditRotationConfigSchema = z
  .object({
    max_bytes: z.number().int().positive().default(10_485_760),  // 10 MiB (D-11)
    max_entries: z.number().int().positive().default(1000),       // D-11
  })
  .optional()
  .default({ max_bytes: 10_485_760, max_entries: 1000 })

export const AuditConfigSchema = z
  .object({
    enabled: z.boolean().default(true),    // D-1: opt-out default ON
    rotation: AuditRotationConfigSchema,
  })
  .optional()
  .default({ enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } })

// Then extend DbcliConfigV2Schema:
export const DbcliConfigV2Schema = z
  .object({
    version: z.literal(2),
    default: z.string().min(1),
    connections: z.record(NamedConnectionSchema)/* ... */,
    schema: z.record(z.any()).optional().default({}),
    schemas: z.record(z.record(z.any())).optional().default({}),
    metadata: MetadataSchema,
    blacklist: BlacklistConfigSchema,
    audit: AuditConfigSchema,           // <-- NEW
  })
  .refine(/* ... */)
```

**Why this satisfies CONFIG-03 with zero procedural code:** When `config.ts` calls `DbcliConfigV2Schema.parse(raw)` against a pre-v1.20.0 `.dbcli` that lacks the `audit` key, zod fills it with `{ enabled: true, rotation: { max_bytes: 10485760, max_entries: 1000 } }`. No write-back required (CONFIG-02: `enabled = true` does NOT create the directory — directory creation is lazy in `AuditLogger.write` per D-12).

**Also extend `DbcliConfigSchema` (V1)** with the same `audit` block so V1 → V2 migration path continues to work and V1-only callers reading via `configModule.read()` see a consistent shape (see `src/core/config.ts:285-291` where v2 is mapped down to v1 shape).

**Test analog:** `tests/unit/core/config.test.ts` and `tests/unit/core/config-v2.test.ts` — add a case: feed a v1.19-style `.dbcli` JSON with no `audit` key, assert parsed result has `.audit.enabled === true` and rotation defaults populated.

---

### MODIFIED (likely no code change needed): `src/core/config.ts` — CONFIG-03 migration

**Closest analog:** the file itself. Look at how `metadata`, `schema`, `blacklist` are passed through with zod defaults (no procedural fill-in):

```ts
// src/core/config.ts:284-291
return DbcliConfigSchema.parse({
  connection: resolvedConnection,
  permission: resolved.permission,
  schema,
  metadata: v2Config.metadata,
  blacklist: v2Config.blacklist,
})
```

**Replicate as:** simply add `audit: v2Config.audit` to this returned object (and to the legacy-file branch at `:323-324`). All defaults flow from the zod schema. **No imperative migration block needed.**

If the planner decides to explicitly version-bump the config (e.g. `metadata.version = '1.20.0'`) on first audit-enabled read, that's a separate concern outside Phase 21 scope.

**Test analog:** `tests/unit/core/config.test.ts` — already exists; just add cases.

---

## Shared Patterns

### Lazy mkdir (apply to: `AuditLogger.write`, `SessionIdService.resolve`'s write-back)
**Source:** `src/core/recovery/last-envelope.ts:79` + `src/core/error-recovery.ts:63-74`

```ts
await mkdir(dirname(target), { recursive: true })       // last-envelope style
// or
if (!(await dir.exists())) {
  await Bun.spawn(['mkdir', '-p', this.recoveryDir]).exited   // error-recovery style
}
```

**Use the `mkdir(dirname, { recursive: true })` form** from `node:fs/promises` — matches `last-envelope.ts` and avoids spawning a subprocess on the hot path. D-12 says first **valid** write triggers mkdir; do not eager-create in constructor.

### Path resolution (apply to: `AuditLogger`, `SessionIdService` construction)
**Source:** `src/core/config-binding.ts:64-67`

```ts
export async function resolveConfigStoragePath(path: string): Promise<string> {
  const binding = await readProjectBinding(path)
  return binding?.binding.storagePath ?? path
}
```

**Apply as:** anything constructing an `AuditLogger` from a CLI command **must** first `await resolveConfigStoragePath(dbcliPath)`, then `join(storagePath, 'audit', '<conn>.jsonl')` for the audit file and `join(storagePath, 'last-session-id')` for the session-id state. D-15 explicit.

### Best-effort fail-soft writes (apply to: ALL audit filesystem ops + D-06 / STORE-04)
**Source:** `src/core/recovery/last-envelope.ts:78-85`

```ts
try {
  // ...filesystem ops...
} catch {
  // Best-effort: writes are warnings, not errors.
}
```

**Apply uniformly inside `AuditLogger.write()`** — any throw from lock, rotation, append, or rename is caught, stored in `this.lastError`, and (on first occurrence) printed once to `process.stderr` (D-16). The audit subsystem is **never** allowed to throw out of `write()`.

### Class constructor signature (apply to: `AuditLogger`, `AuditLockManager`, `SessionIdService`)
**Source:** `src/core/concurrent-lock.ts:21-24` and `src/core/schema-writer.ts:26-28`

Constructor takes `dbcliPath` (or resolved storagePath) + optional tunables. Internal state private. No factory functions, no DI container — plain `new` instantiation at the call site, matching `new ConcurrentLockManager(dbcliPath)` and `new SchemaWriter(dbcliPath)` exactly.

---

## Data-flow diagram

The audit write path for one engine command (Phase 23+ caller):

```
engine command (Phase 23+)
        │
        │  await auditLogger.write(entry)
        ▼
┌─────────────────────────────────────────────────────────┐
│ AuditLogger.write(entry)                                │
│                                                         │
│  ┌── if (!this.enabled) return { skipped: 'disabled' } │  ← CONFIG-02 short-circuit (D-1, D-12)
│  │                                                      │
│  ├── const sessionId = await sessionIdService.resolve()│  ← D-2/D-4 (env → file → generate)
│  │                                                      │
│  ├── await mkdir(this.auditDir, { recursive: true })   │  ← D-12 lazy mkdir
│  │                                                      │
│  ├── await this.lockManager.withLock(async () => {     │  ← D-5/D-6/D-7 (200ms budget)
│  │       ┌──────────────────────────────────────────┐  │
│  │       │  if (shouldRotate(stats, thresholds)) {  │  │  ← D-11 (10MB OR 1000 entries)
│  │       │    await mv(currentPath, previousPath)   │  │  ← D-9/D-10 (single rolling .1)
│  │       │    reset counters                         │  │
│  │       │  }                                        │  │
│  │       │  await appendFile(currentPath, line)      │  │  ← D-8 (O_APPEND, no fsync)
│  │       │  this.currentEntryCount++                 │  │
│  │       │  this.currentSizeBytes += line.length     │  │
│  │       │  this.lastWrite = { ts, success: true }   │  │
│  │       └──────────────────────────────────────────┘  │
│  │     })                                              │
│  │                                                      │
│  └── catch (err) {                                     │  ← D-6 fail-soft, D-16 cadence
│        this.lastError = { ts, message: err.message }   │
│        if (!this.warnedOnceThisProcess) {              │
│          process.stderr.write(`[dbcli audit] warning…`)│
│          this.warnedOnceThisProcess = true             │
│        }                                                │
│        // never re-throw                                │
│      }                                                  │
│                                                         │
│  return { success: true | false, ... }                  │
└─────────────────────────────────────────────────────────┘
        │
        ▼
engine continues with original DB result + exit code   ← D-6 / STORE-04 guarantee
```

Health introspection (read-only side path):
```
Phase 24 `dbcli audit health` ──► auditLogger.getHealth() ──► { enabled, currentFile,
                                                                currentSizeBytes, rotationUsage,
                                                                lock: {state}, lastWrite,
                                                                lastError, sessionId, rotation }
```

---

## Concurrent-test analog

**Goal:** satisfy STORE-03 success criterion 3 — *"兩個 dbcli 進程同時寫入同一連線時，產出的 JSONL 仍每行可解析"*.

**No exact analog exists** (the repo has no test that spawns two concurrent CLI processes against the same file lock). The closest patterns to compose:

### Pattern A: subprocess spawn with sanitized env (analog: `tests/integration/recovery.test.ts:30-45`)

```ts
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(args: string[], cwd = FIXTURE): Promise<{stdout: string; stderr: string; code: number}> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}
```

### Pattern B: tmpdir + mkdtemp fixture isolation (analog: `tests/integration/recovery.test.ts:47-58`)

```ts
import { mkdtemp, cp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

beforeAll(async () => {
  const work = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-audit-concurrent-')))
  // seed minimal .dbcli/config.json with audit.enabled = true
  // ...
})
```

### Pattern C: parallel awaits (analog: `tests/unit/core/schema-cache.test.ts:227-240`)

```ts
test('concurrent access: same table returns consistent schema', async () => {
  const manager = new SchemaCacheManager(testDbcliPath)
  await manager.initialize()

  const [schema1, schema2, schema3] = await Promise.all([
    manager.getTableSchema('users'),
    manager.getTableSchema('users'),
    manager.getTableSchema('users'),
  ])
  expect(schema1).toEqual(schema2)
})
```

### Composed for Phase 21: `tests/integration/core/audit-concurrent.test.ts`

```ts
import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// OPTION 1 — direct-API concurrent test (preferred for Phase 21, no engine yet)
test('STORE-03: two AuditLogger instances writing in parallel produce valid JSONL', async () => {
  const work = await mkdtemp(join(tmpdir(), 'dbcli-audit-conc-'))
  // construct two AuditLogger instances pointing at same auditDir
  const a = new AuditLogger({ storagePath: work, connectionName: 'default', enabled: true, /* … */ })
  const b = new AuditLogger({ storagePath: work, connectionName: 'default', enabled: true, /* … */ })

  // fire many writes in parallel from both
  const entries = Array.from({ length: 50 }, (_, i) => ({ ts: new Date().toISOString(), i }))
  await Promise.all([
    ...entries.map((e) => a.write({ ...e, src: 'a' })),
    ...entries.map((e) => b.write({ ...e, src: 'b' })),
  ])

  // assert every line parses (file lock serialized correctly)
  const content = await readFile(join(work, 'audit', 'default.jsonl'), 'utf8')
  const lines = content.split('\n').filter(Boolean)
  expect(lines.length).toBe(100)
  for (const line of lines) {
    expect(() => JSON.parse(line)).not.toThrow()
  }
})

// OPTION 2 — true multi-process test (closer to STORE-03 wording; uses Pattern A above).
// Defer until Phase 23 wires audit into a real CLI command. Phase 21 can stub via a
// tiny dev-only `bun run scripts/audit-write-stub.ts <storagePath> <conn> <n>` helper.
```

**Recommendation for Phase 21 plan:** Ship Option 1 (in-process two-instance concurrent test) as the STORE-03 evidence. Option 2 (true multi-process) is more faithful to *"兩個 dbcli 進程"* wording but Phase 21 has no CLI surface to spawn — the natural moment is Phase 23/24 once `dbcli audit` exists.

---

## Zod schema extension pattern (CONFIG-01 / CONFIG-03 reference)

Already shown in detail in the `src/utils/validation.ts` modification section above. Key takeaways:

1. **Mirror `BlacklistConfigSchema` exactly** — `.optional().default({...})` is the migration mechanism. No procedural code touches existing `.dbcli` files.
2. **D-11 thresholds become zod defaults**: `max_bytes: 10_485_760`, `max_entries: 1000`.
3. **D-1 default-on** is a one-line zod default: `enabled: z.boolean().default(true)`.
4. **Both `DbcliConfigSchema` (V1) and `DbcliConfigV2Schema` (V2) need the field** — V1 is still consumed by `configModule.read()` even when source is V2 (see `src/core/config.ts:285-291`).

---

## No-Analog Files

| File | Role | Reason |
|------|------|--------|
| `tests/integration/core/audit-concurrent.test.ts` | concurrent multi-instance test | No prior test in this repo exercises file-lock serialization across instances; composed from three partial analogs above. |
| `src/core/audit/rotation.ts` (optional split) | rotation logic | Project has never rotated a file before (`schema-writer` uses replace semantics, not rotation). Pure new code; only the `mv` + atomic-rename idiom is borrowed from `AtomicFileWriter`. |

---

## Metadata

**Analog search scope:** `src/core/`, `src/utils/`, `tests/unit/core/`, `tests/integration/`
**Files scanned:** ~30 (core), ~10 (tests)
**Files read in full:** `concurrent-lock.ts`, `last-envelope.ts`, `validation.ts`, `config-path.ts`, `config.ts`, `config-v2.ts`, `config-binding.ts`, `schema-writer.ts`, `atomic-writer.ts`, `error-recovery.ts` (partial), `concurrent-lock.test.ts`, `recovery.test.ts` (partial), `schema-system.integration.test.ts` (partial), `schema-cache.test.ts` (partial), `cli.test.ts`, `live-db.test.ts` (partial)
**Pattern extraction date:** 2026-05-14
