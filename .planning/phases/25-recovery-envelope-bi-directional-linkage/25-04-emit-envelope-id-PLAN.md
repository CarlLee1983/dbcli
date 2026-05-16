---
phase: 25
plan: 04
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/core/recovery/emit.ts
  - src/core/recovery/last-envelope.ts
  - tests/unit/core/recovery/emit.test.ts
autonomous: true
requirements: [INTEGRATE-02, INTEGRATE-03]
must_haves:
  truths:
    - "EmitOptions accepts optional envelopeId and auditRef strings"
    - "emitRecoveryEnvelope pre-generates an envelope id via crypto.randomUUID() when envelopeId is omitted"
    - "When envelopeId is supplied by the caller, that exact id is persisted onto disk under SavedRecoveryEnvelope.id"
    - "When auditRef is supplied by the caller, it is persisted under SavedRecoveryEnvelope.audit_ref"
    - "When auditRef is undefined, the on-disk JSON OMITS the audit_ref key entirely (not null, not empty string)"
    - "stdout JSON printed by emitRecoveryEnvelope still renders RecoveryEnvelope body shape unchanged (D-52)"
    - "writeLastEnvelope (async) defaults id to crypto.randomUUID() so test callers do not have to pre-generate"
    - "process.exit() behavior is preserved (sync write + sync exit per D-51)"
  artifacts:
    - path: "src/core/recovery/emit.ts"
      provides: "EmitOptions with envelopeId? + auditRef?; emitRecoveryEnvelope pre-generates UUID; writeLastEnvelopeSync persists both"
      contains: "envelopeId"
    - path: "src/core/recovery/last-envelope.ts"
      provides: "writeLastEnvelope async variant accepting id + auditRef and writing them onto disk"
      contains: "auditRef"
    - path: "tests/unit/core/recovery/emit.test.ts"
      provides: "Unit tests for envelopeId pre-gen, caller-supplied envelopeId persistence, auditRef persistence, omit-on-undefined"
      contains: "envelopeId"
  key_links:
    - from: "src/core/recovery/emit.ts"
      to: "src/core/recovery/apply-types.ts"
      via: "SavedRecoveryEnvelope wrapper carries the new id / audit_ref fields (Plan 01)"
      pattern: "schemaVersion: 1"
    - from: "src/core/recovery/last-envelope.ts"
      to: "src/core/recovery/apply-types.ts"
      via: "same SavedRecoveryEnvelope wrapper shape"
      pattern: "audit_ref"
---

<objective>
Plumb envelope-id pre-generation and audit-ref pass-through through both recovery-envelope writers:
- `emitRecoveryEnvelope()` (sync, exit-on-emit path) in `src/core/recovery/emit.ts`
- `writeLastEnvelope()` (async, test / non-emit path) in `src/core/recovery/last-envelope.ts`

When the catch block in Plan 05 calls `emitRecoveryEnvelope(err, ctx, { envelopeId, auditRef })`, the resulting `.dbcli/last-recovery.json` MUST carry `id === envelopeId` and (when `auditRef !== undefined`) `audit_ref === auditRef`. When `auditRef` is undefined, the on-disk file omits the `audit_ref` key entirely (D-53 best-effort semantics).

Purpose: D-51 / D-53 / I1 / K1. Wave 2 wiring that consumes the type shape from Plan 01 and is consumed by Plan 05's catch-block wiring.

Output: Two function signatures upgraded; one new unit test file (or extension of an existing recovery unit test) demonstrating id and audit_ref round-trip; one regression test confirming the stdout shape is untouched.
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
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-01-envelope-wrapper-schema-PLAN.md
@src/core/recovery/emit.ts
@src/core/recovery/last-envelope.ts
@src/core/recovery/apply-types.ts
@src/core/recovery/render-json.ts

<interfaces>
Current `emit.ts` (verbatim from src/core/recovery/emit.ts:9-58):
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

Current `last-envelope.ts:63-85` (async sibling):
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

The new `SavedRecoveryEnvelope` shape (after Plan 01) has optional `id?: string` + `audit_ref?: string` between `schemaVersion` and `savedAt`. The zod parser already accepts both. This plan is responsible for actually populating those fields at write time.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Upgrade emit.ts EmitOptions + emitRecoveryEnvelope + writeLastEnvelopeSync</name>
  <read_first>
    - src/core/recovery/emit.ts (full file, all 58 lines)
    - src/core/recovery/apply-types.ts (post Plan 01, lines around 94-101 with new id?/audit_ref? fields)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 3, target shape)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-51, D-52, I1, K1)
    - tests/unit/core/recovery/render-json.test.ts (existing recovery unit test - read for fixture patterns)
  </read_first>
  <files>
    src/core/recovery/emit.ts,
    tests/unit/core/recovery/emit.test.ts
  </files>
  <behavior>
    Test cases (RED first):
    - When `emitRecoveryEnvelope(err, ctx)` runs without an explicit envelopeId, the persisted `.dbcli/last-recovery.json` has `id` matching the UUID v4 pattern.
    - When called with `{ envelopeId: 'fixed-id-xyz' }`, the persisted file has `id === 'fixed-id-xyz'`.
    - When called with `{ envelopeId: 'X', auditRef: 'A' }`, the persisted file has `id === 'X'` AND `audit_ref === 'A'`.
    - When called with `{ envelopeId: 'X' }` (no auditRef), the persisted file has `id === 'X'` and NO `audit_ref` key at all (`'audit_ref' in parsed === false`).
    - The JSON written to stdout still has the RecoveryEnvelope body shape (no `id`, no `audit_ref` keys on stdout; those are wrapper-only - D-52).
    - The function still calls `process.exit()` (verify via spawn-subprocess pattern; this is the same pattern that `tests/integration/recovery.test.ts` already uses).
  </behavior>
  <action>
**Step A - modify `src/core/recovery/emit.ts`:**

Add `import { randomUUID } from 'node:crypto'` at the top of the file (after the existing `node:fs` import).

Replace the `EmitOptions` interface and the two functions with the upgraded versions per PATTERNS.md section 3:

```ts
import { writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'  // Phase 25 D-51
import { classifyError } from './classify'
import { renderJson } from './render-json'
import { LAST_ENVELOPE_PATH, sanitizeCommandSummary } from './last-envelope'
import type { RecoveryContext, RecoveryEnvelope, RecoveryRenderOptions } from './types'
import type { SavedRecoveryEnvelope } from './apply-types'

export interface EmitOptions extends RecoveryRenderOptions {
  /** Process exit code; defaults to 1. */
  exitCode?: number
  /** Override argv for the saved-command summary; defaults to derived `process.argv`. */
  argv?: string[]
  /** Override cwd for the saved file; defaults to `process.cwd()`. */
  cwd?: string
  /** Phase 25 D-51: pre-generated envelope id. Defaults to crypto.randomUUID() when omitted. */
  envelopeId?: string
  /** Phase 25 D-53: audit entry id captured by caller's writeAuditEntry. Undefined when audit disabled / failed. */
  auditRef?: string
}

/**
 * Print a RecoveryEnvelope to stdout as JSON, persist it to
 * `.dbcli/last-recovery.json` (best-effort, synchronous), and exit non-zero.
 */
export function emitRecoveryEnvelope(
  error: unknown,
  ctx: RecoveryContext,
  options: EmitOptions = {}
): never {
  const envelope = classifyError(error, ctx)
  const cwd = options.cwd ?? process.cwd()
  const argv = options.argv ?? buildArgvFromProcess()
  // Phase 25 D-51 / I1: pre-generate envelope id at entry; caller may also supply one.
  const envelopeId = options.envelopeId ?? randomUUID()
  writeLastEnvelopeSync(cwd, envelope, argv, envelopeId, options.auditRef)
  // D-52: stdout shape is RecoveryEnvelope body, NOT SavedRecoveryEnvelope wrapper. Unchanged.
  process.stdout.write(renderJson(envelope, { brief: options.brief === true }) + '\n')
  process.exit(options.exitCode ?? 1)
}

function buildArgvFromProcess(): string[] {
  const userArgs = process.argv.slice(2)
  return ['dbcli', ...userArgs]
}

function writeLastEnvelopeSync(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  id: string,                     // Phase 25 D-51
  auditRef: string | undefined    // Phase 25 D-53
): void {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    id,
    ...(auditRef !== undefined && { audit_ref: auditRef }),  // D-53: omit when undefined
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

Critical constraints:
- The stdout `renderJson(envelope, ...)` call is **unchanged** (it operates on `RecoveryEnvelope`, not `SavedRecoveryEnvelope`). D-52 forbids touching the body type, so the stdout JSON does NOT gain `id` / `audit_ref` keys.
- The conditional spread for `audit_ref` mirrors the existing `redacted_sql` pattern in `integration-helper.ts`: when undefined, the key is omitted entirely from the JSON (not set to `null`, not set to `""`).
- `process.exit()` is still called synchronously after the sync write - D-51 forbids restructuring this.

**Step B - create `tests/unit/core/recovery/emit.test.ts`:**

This file does NOT currently exist (`ls tests/unit/core/recovery/` shows no `emit.test.ts`). Because `emitRecoveryEnvelope` calls `process.exit()`, unit-test it via subprocess spawn (the same pattern as `tests/integration/recovery.test.ts`). Alternatively, refactor only the persistence step into a helper that can be tested without `process.exit()` - DO NOT do that refactor here (D-51 forbids restructuring the sync write).

Instead, test the persistence behavior via a small Bun spawn that runs an inline `bun -e '...'` script:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EMIT_SCRIPT = (workDir: string, opts: Record<string, unknown>) => `
import { emitRecoveryEnvelope } from '${resolve(import.meta.dir, '../../../../src/core/recovery/emit.ts')}'
try {
  emitRecoveryEnvelope(new Error('boom'), { operation: 'query' }, ${JSON.stringify({ cwd: workDir, argv: ['dbcli', 'query', 'select 1'], ...opts })})
} catch (e) {
  console.error(e)
  process.exit(99)
}
`

function runEmit(workDir: string, opts: Record<string, unknown> = {}): { code: number; stdout: string } {
  const r = spawnSync('bun', ['-e', EMIT_SCRIPT(workDir, opts)], { encoding: 'utf8' })
  return { code: r.status ?? -1, stdout: r.stdout }
}

describe('emitRecoveryEnvelope id + audit_ref (Phase 25 D-51 / D-53)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-04-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('pre-generates a UUID for id when envelopeId is omitted', async () => {
    const { code } = runEmit(workDir)
    expect(code).toBe(1)  // process.exit(1) is the default
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('persists the caller-supplied envelopeId verbatim', async () => {
    const FIXED_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    const { code } = runEmit(workDir, { envelopeId: FIXED_ID })
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string }
    expect(parsed.id).toBe(FIXED_ID)
  })

  test('persists audit_ref when supplied', async () => {
    const AUDIT_REF = '8b3c8f0c-1234-4abc-9def-0123456789ab'
    const { code } = runEmit(workDir, { envelopeId: 'X', auditRef: AUDIT_REF })
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toBe('X')
    expect(parsed.audit_ref).toBe(AUDIT_REF)
  })

  test('omits audit_ref key from JSON when auditRef is undefined (D-53)', async () => {
    const { code } = runEmit(workDir, { envelopeId: 'X' })
    expect(code).toBe(1)
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.id).toBe('X')
    expect('audit_ref' in parsed).toBe(false)
  })

  test('stdout JSON renders RecoveryEnvelope body shape unchanged (D-52)', async () => {
    const { code, stdout } = runEmit(workDir, { envelopeId: 'X', auditRef: 'A' })
    expect(code).toBe(1)
    const env = JSON.parse(stdout) as Record<string, unknown>
    // body shape: schemaVersion, generatedAt, ok, error, recovery (and optional verify)
    expect(env.schemaVersion).toBe(1)
    expect(env.ok).toBe(false)
    expect('error' in env).toBe(true)
    expect('recovery' in env).toBe(true)
    // D-52: stdout does NOT carry wrapper fields
    expect('id' in env).toBe(false)
    expect('audit_ref' in env).toBe(false)
  })
})
```

Run `bun test tests/unit/core/recovery/emit.test.ts` and confirm all five cases pass.
  </action>
  <verify>
    <automated>bun test tests/unit/core/recovery/emit.test.ts 2>&1 | tee /tmp/test-25-04-t1.log; grep -E "(pass|fail|error)" /tmp/test-25-04-t1.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "import \\{ randomUUID \\} from 'node:crypto'" src/core/recovery/emit.ts` returns one line.
    - `grep -nE "envelopeId\\?: string" src/core/recovery/emit.ts` returns one line inside `EmitOptions`.
    - `grep -nE "auditRef\\?: string" src/core/recovery/emit.ts` returns one line inside `EmitOptions`.
    - `grep -nE "options\\.envelopeId \\?\\? randomUUID\\(\\)" src/core/recovery/emit.ts` returns one line.
    - `grep -nE "audit_ref: auditRef" src/core/recovery/emit.ts` returns a line inside the `payload` literal.
    - `grep -nE "auditRef !== undefined" src/core/recovery/emit.ts` returns one line (the conditional spread).
    - `grep -nE "process\\.exit\\(" src/core/recovery/emit.ts` still returns at least one line (D-51 preserved).
    - `grep -nE "renderJson\\(envelope" src/core/recovery/emit.ts` shows the stdout render call is still using `envelope` (NOT `payload`), preserving D-52.
    - `test -f tests/unit/core/recovery/emit.test.ts` returns true.
    - `bun test tests/unit/core/recovery/emit.test.ts` exits 0 with 5 tests passing.
    - `bun run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    emit.ts: EmitOptions exposes envelopeId? + auditRef?; emitRecoveryEnvelope pre-generates a UUID when envelopeId is absent and persists it as `id` on disk; writeLastEnvelopeSync omits `audit_ref` when undefined; stdout shape is unchanged (D-52). Unit tests cover all 5 invariants.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Upgrade writeLastEnvelope async sibling in last-envelope.ts</name>
  <read_first>
    - src/core/recovery/last-envelope.ts (full file)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 4, target shape)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (K1)
  </read_first>
  <files>
    src/core/recovery/last-envelope.ts,
    tests/unit/core/recovery/emit.test.ts
  </files>
  <behavior>
    Test cases (extend the file from Task 1):
    - `writeLastEnvelope(cwd, env, argv)` (no id, no auditRef) defaults id to a UUID v4 and OMITS audit_ref.
    - `writeLastEnvelope(cwd, env, argv, now, 'X', 'A')` writes `id === 'X'` and `audit_ref === 'A'`.
    - The existing `now()` parameter (4th positional) is preserved in shape and default.
  </behavior>
  <action>
**Step A - modify `src/core/recovery/last-envelope.ts`:**

Add `import { randomUUID } from 'node:crypto'` at the top.

Replace the `writeLastEnvelope` function (lines 63-85) with the upgraded variant per PATTERNS.md section 4:

```ts
import { writeFile, readFile, rename, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'  // Phase 25
import type { RecoveryEnvelope } from './types'
import type { SavedRecoveryEnvelope } from './apply-types'

// ... LAST_ENVELOPE_PATH and sanitizeCommandSummary unchanged ...

export async function writeLastEnvelope(
  cwd: string,
  envelope: RecoveryEnvelope,
  argv: string[],
  now: () => Date = () => new Date(),
  id: string = randomUUID(),     // Phase 25: default so test callers do not have to pre-gen
  auditRef?: string              // Phase 25 D-53
): Promise<void> {
  const target = join(cwd, LAST_ENVELOPE_PATH)
  const tmp = `${target}.tmp`
  const payload: SavedRecoveryEnvelope = {
    schemaVersion: 1,
    id,
    ...(auditRef !== undefined && { audit_ref: auditRef }),
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

Do NOT touch `readLastEnvelope`, `readLastEnvelopeRaw`, or `sanitizeCommandSummary` - they read existing files (the optional fields just flow through naturally via JSON.parse) and do not need changes.

**Step B - extend `tests/unit/core/recovery/emit.test.ts` with writeLastEnvelope cases:**

Add a new `describe('writeLastEnvelope id + audit_ref (Phase 25)', ...)` block at the end of the file:

```ts
import { writeLastEnvelope } from '@/core/recovery/last-envelope'
import type { RecoveryEnvelope } from '@/core/recovery/types'

function minimalEnvelope(): RecoveryEnvelope {
  return {
    schemaVersion: 1,
    generatedAt: '2026-05-15T10:00:00Z',
    ok: false,
    error: { code: 'UNKNOWN', category: 'unknown', message: 'test' },
    recovery: [],
  }
}

describe('writeLastEnvelope id + audit_ref (Phase 25 K1)', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-04b-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('defaults id to UUID v4 when id arg is omitted', async () => {
    await writeLastEnvelope(workDir, minimalEnvelope(), ['dbcli', 'query', 'select 1'])
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/)
    expect('audit_ref' in parsed).toBe(false)
  })

  test('persists explicit id and audit_ref', async () => {
    await writeLastEnvelope(
      workDir,
      minimalEnvelope(),
      ['dbcli', 'query', 'select 1'],
      () => new Date('2026-05-15T10:00:00Z'),
      'fixed-id-X',
      'fixed-audit-A'
    )
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as { id?: string; audit_ref?: string }
    expect(parsed.id).toBe('fixed-id-X')
    expect(parsed.audit_ref).toBe('fixed-audit-A')
  })

  test('omits audit_ref when 6th arg is undefined', async () => {
    await writeLastEnvelope(
      workDir,
      minimalEnvelope(),
      ['dbcli', 'query', 'select 1'],
      () => new Date('2026-05-15T10:00:00Z'),
      'fixed-id-X',
      undefined
    )
    const raw = await readFile(join(workDir, '.dbcli/last-recovery.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed.id).toBe('fixed-id-X')
    expect('audit_ref' in parsed).toBe(false)
  })
})
```

Run `bun test tests/unit/core/recovery/emit.test.ts` and confirm Task 1 + Task 2 cases all pass.
  </action>
  <verify>
    <automated>bun test tests/unit/core/recovery/emit.test.ts 2>&1 | tee /tmp/test-25-04-t2.log; grep -E "(pass|fail|error)" /tmp/test-25-04-t2.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "import \\{ randomUUID \\} from 'node:crypto'" src/core/recovery/last-envelope.ts` returns one line.
    - `grep -nE "id: string = randomUUID\\(\\)" src/core/recovery/last-envelope.ts` returns one line (default value uses crypto).
    - `grep -nE "auditRef\\?: string" src/core/recovery/last-envelope.ts` returns one line in writeLastEnvelope's signature.
    - `grep -nE "auditRef !== undefined" src/core/recovery/last-envelope.ts` returns one line.
    - `bun test tests/unit/core/recovery/emit.test.ts` exits 0 with at least 8 tests passing (5 from Task 1 + 3 from Task 2).
    - `bun test tests/unit/core/recovery/` exits 0 - no regressions to apply / classify / next-render / next-step etc.
    - `bun run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    writeLastEnvelope accepts optional id (defaulting to randomUUID()) and auditRef. The async path mirrors the sync path. All existing recovery unit tests still pass.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0.
2. `bun test tests/unit/core/recovery/` exits 0 (all recovery unit tests including the new emit.test.ts).
3. `bun test tests/integration/recovery.test.ts` exits 0 (the integration recovery tests must not regress - they exercise the legacy parameter ordering).
4. `bun test tests/unit/core/recovery/render-json.test.ts` exits 0 (stdout body shape is unchanged per D-52).
5. The persisted `.dbcli/last-recovery.json` shape is verifiable via the unit tests: id is always present (defaults to UUID), audit_ref is present iff supplied.
</verification>

<success_criteria>
- `EmitOptions` exposes `envelopeId?: string` and `auditRef?: string`.
- `emitRecoveryEnvelope` pre-generates an envelope id when the caller omits it, and persists caller-supplied ids verbatim.
- Both `writeLastEnvelopeSync` (private in emit.ts) and `writeLastEnvelope` (exported from last-envelope.ts) persist the new wrapper fields.
- `audit_ref` is omitted from on-disk JSON when undefined (NOT null, NOT empty string).
- stdout JSON shape is unchanged - D-52 boundary preserved.
- 8+ new unit tests pass; full recovery unit suite + integration recovery test pass.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-04-SUMMARY.md` documenting:
- The two function signatures after upgrade (with diff-style before/after if useful)
- How `audit_ref` is omitted (conditional spread) vs how `id` is always present (default + caller-override)
- Confirmation that the stdout shape is unchanged (renderJson still operates on RecoveryEnvelope body)
- Forward pointer: Plan 05 catch blocks now call `emitRecoveryEnvelope(err, ctx, { envelopeId, auditRef: auditId ?? undefined })`
</output>
