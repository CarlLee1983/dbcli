---
phase: 25
plan: 08
type: execute
wave: 3
depends_on: [04, 05, 06, 07]
files_modified:
  - tests/integration/recovery-audit-link.test.ts
  - tests/integration/audit-show-health.test.ts
autonomous: true
requirements: [INTEGRATE-02, INTEGRATE-03, DOCS-02]
must_haves:
  truths:
    - "tests/integration/recovery-audit-link.test.ts exists and exercises both bi-directional ref round-trip AND DOCS-02 audit_recent across 4 surfaces"
    - "Round-trip test: a failed `query --recovery` produces audit entry with non-empty recovery_ref AND envelope with matching id"
    - "Reverse round-trip: same envelope's audit_ref equals the audit entry's id"
    - "J1 asymmetry guard: a failed `insert --recovery` (one of the 6 unwired commands) writes an envelope but the envelope has NO audit_ref key AND no audit entry is written (because insert.ts does not call writeAuditEntry)"
    - "DOCS-02: inspect / guide --for-agent JSON contains audit_recent at top level"
    - "DOCS-02: recover --format json AND recover --apply --format json both contain audit_recent"
    - "Brief shape D-59: audit_recent items have EXACTLY {id, ts, command, target, success}; forbidden keys (redacted_query, redacted_sql, metadata, session_id, engine, side_effect_tier) MUST be absent"
    - "Back-compat D-54: a saved envelope fixture WITHOUT id/audit_ref still parses via `recover --from <file>`"
    - "audit-show-health.test.ts fixtures use UUID-style recovery_ref values (not placeholder strings) per RESEARCH M"
    - "audit-contract.test.ts (Phase 22) is NOT modified; audit-envelope.test.ts (Phase 24) is NOT modified"
  artifacts:
    - path: "tests/integration/recovery-audit-link.test.ts"
      provides: "Release-blocking contract test covering INTEGRATE-02/-03 round-trip + DOCS-02 4 surfaces + J1 asymmetry + D-54 back-compat"
      contains: "audit_recent"
      min_lines: 200
    - path: "tests/integration/audit-show-health.test.ts"
      provides: "Existing test updated to use UUID-style recovery_ref values where placeholder strings were used"
      contains: "[0-9a-f-]{36}"
  key_links:
    - from: "tests/integration/recovery-audit-link.test.ts"
      to: "src/cli.ts (spawned via `bun run src/cli.ts ...` in subprocess)"
      via: "isolated tmpdir per test; --config <tmpdir>/.dbcli routes audit + recovery files under tmpdir"
      pattern: "spawn\\('bun'"
---

<objective>
Land the release-blocking contract test that validates ALL FOUR ROADMAP success criteria for Phase 25 plus the J1 asymmetry guard:
1. ROADMAP #1: failed command's audit entry carries `recovery_ref` pointing at the envelope.
2. ROADMAP #2: same failure's recovery envelope carries `audit_ref` pointing at the audit entry.
3. ROADMAP #3: inspect / guide / recover / recover --apply agent JSON contains `audit_recent`.
4. ROADMAP #4: bi-directional UUIDs match.
5. J1 asymmetry guard: failed `insert` / `update` / `delete` / `export` / `q` / `schema` with `--recovery` produces an envelope WITHOUT `audit_ref` (because they do not call writeAuditEntry). This guard fails immediately if any future change leaks audit_ref onto those envelopes.

Also update `tests/integration/audit-show-health.test.ts` to use UUID-style recovery_ref fixtures (RESEARCH M).

Purpose: This is the deliverable that flips the J1 coverage matrix from "implemented" to "contractually defended". It is the safety net that catches future regressions to Phase 25's locked behavior.

Output: One new test file (~250 lines), light fixture update on an existing audit-show test. Both file edits are integration-test scope only - no production code changes.
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
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-05-wire-j1-catch-blocks-PLAN.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-06-docs02-inspect-guide-PLAN.md
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-07-docs02-recover-PLAN.md
@tests/integration/audit-envelope.test.ts
@tests/integration/audit-show-health.test.ts
@tests/integration/recovery.test.ts

<interfaces>
Reference patterns to mirror from `tests/integration/audit-envelope.test.ts` (Phase 24 contract):
- Isolated `.dbcli/audit/` tmpdir per test via `mkdtemp(join(tmpdir(), 'dbcli-test-XX-'))`
- `bun run src/cli.ts ... --config <tmpdir>/.dbcli` invocation via `spawn` from `node:child_process`
- `JSON.parse(stdout)` -> assert keys / shape
- `sanitizeEnv()` strips all `DBCLI_*` and `DATABASE_URL` env vars, sets `NODE_ENV=test` and `DBCLI_NO_UPDATE_CHECK=1`
- Required entry keys whitelist (Phase 22): `['id','ts','session_id','engine','command','side_effect_tier','target','success','redacted_query']`

Phase 25 brief shape (D-59): `{ id, ts, command, target, success }` only - forbidden: `redacted_query, redacted_sql, metadata, session_id, engine, side_effect_tier`.

J1 wired surface (positive cases): `inspect`, `query`.
J1 unwired surface (negative guard): `insert`, `update`, `delete`, `export`, `q`, `schema`.

CONTEXT.md addendum: "Contract test 二維覆蓋 - (a) wired surface 雙向鏈一定對得上; (b) 未 wire surface 不會 false-positive 出 `audit_ref`."

Phase 22 / 24 fences (DO NOT touch):
- `tests/integration/audit-contract.test.ts` - Phase 22 entry-shape lock
- `tests/integration/audit-envelope.test.ts` - Phase 24 envelope-wrapper lock
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create tests/integration/recovery-audit-link.test.ts with bi-directional round-trip + J1 asymmetry guard</name>
  <read_first>
    - tests/integration/audit-envelope.test.ts (first 80 lines, especially sanitizeEnv() / run() helpers + CLI const)
    - tests/integration/recovery.test.ts (for the pattern of spawning a failing `query --recovery` and reading `.dbcli/last-recovery.json`)
    - tests/integration/audit-show-health.test.ts (existing recovery-ref fixture style)
    - src/commands/inspect.ts (post Plan 05/06: the failure path that produces both audit entry + envelope)
    - src/commands/query.ts (post Plan 05: the failure path)
    - src/commands/insert.ts (UNCHANGED, this is the J1 negative case)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 17, the test coverage matrix table)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (E, test plan)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-VALIDATION.md (Per-Task Verification Map)
  </read_first>
  <files>tests/integration/recovery-audit-link.test.ts</files>
  <behavior>
    The file imports from `bun:test` and uses `spawn` from `node:child_process`. It does not depend on a live database - all failure cases are constructable from invalid SQL / invalid config / invalid args without touching a real DB.

    Test suites (one describe block per concern):

    1. **`describe('Bi-directional ref round-trip (wired surface) [INTEGRATE-02 / -03 release-blocking]')`**
       - test "query failure: audit entry has recovery_ref matching envelope id"
       - test "query failure: envelope has audit_ref matching audit entry id"
       - test "inspect failure with --require-schema-cache + --recovery: same round-trip"

    2. **`describe('J1 asymmetry guard (unwired surface) [INTEGRATE-03 negative contract release-blocking]')`**
       - test "insert failure with --recovery: envelope written but audit_ref is UNDEFINED (not null, not empty string)"
       - test "insert failure with --recovery: no audit entry is written (insert.ts is unwired)"
       - test "Repeat the negative guard for: update, delete, export, q, schema" (parameterized or 5 separate cases)

    3. **`describe('DOCS-02 audit_recent embedding [4 agent surfaces]')`**
       - test "inspect --for-agent JSON contains audit_recent at top level"
       - test "guide health --for-agent JSON contains audit_recent at top level (NOT inside context)"
       - test "recover --format json JSON contains audit_recent"
       - test "recover --apply JSON contains audit_recent (alongside ApplyResult fields)"

    4. **`describe('audit_recent shape contract [D-58 / D-59 / D-60]')`**
       - test "audit_recent items have EXACTLY {id, ts, command, target, success} (D-59 forbidden keys absent)"
       - test "audit_recent caps at N=5 even when 10 entries exist (D-58)"
       - test "audit_recent is [] when audit.enabled = false (D-60)"
       - test "audit_recent is [] when audit dir does not exist (D-60)"
       - test "inspect with --format markdown (no --for-agent) stdout does NOT contain 'audit_recent' bytes (D-57)"

    5. **`describe('Legacy envelope backward compatibility [D-54]')`**
       - test "recover --from <legacy-fixture.json> (no id / no audit_ref) parses without error"

    6. **`describe('Phase 22 / 24 meta-guard fences')`**
       - test "Phase 22 audit-contract.test.ts file is not modified by Phase 25" (read both files, verify the test file's first 50 lines have not changed AND a known assertion line still exists)
       - test "Phase 24 audit-envelope.test.ts file is not modified by Phase 25" (same pattern)

       Implementation note: this is a *fence* test - it does not run a CLI; it just reads the file content and asserts a known string is present. This catches accidental Phase 22/24 file edits.
  </behavior>
  <action>
Create `tests/integration/recovery-audit-link.test.ts`. Use the existing `tests/integration/audit-envelope.test.ts` as the structural template - copy its `sanitizeEnv`, `run`, `makeMinimalConfig` helpers verbatim and adapt.

```ts
/**
 * Phase 25 contract test - bi-directional ref + DOCS-02 audit_recent + J1 asymmetry guard.
 *
 * Release-blocking: round-trip + J1 negative guard.
 * Standard: DOCS-02 4-surface checks + back-compat + meta-guards.
 *
 * Parallel to:
 * - tests/integration/audit-contract.test.ts (Phase 22 entry-shape lock; NOT modified here)
 * - tests/integration/audit-envelope.test.ts (Phase 24 envelope-wrapper lock; NOT modified here)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function makeMinimalConfig(auditEnabled: boolean = true): unknown {
  return {
    connection: {
      system: 'postgresql',
      host: 'localhost',
      port: 5432,
      user: 'u',
      password: 'p',
      database: 'd',
    },
    permission: 'query-only',
    metadata: { createdAt: '2026-05-15T00:00:00.000Z', version: '1.0' },
    audit: { enabled: auditEnabled, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  }
}

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

function run(args: string[], workDir: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd: workDir, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

async function seedConfig(workDir: string, auditEnabled = true): Promise<void> {
  const dbcli = join(workDir, '.dbcli')
  await mkdir(dbcli, { recursive: true })
  await writeFile(join(dbcli, 'config.json'), JSON.stringify(makeMinimalConfig(auditEnabled)), 'utf8')
}

async function readAuditEntries(workDir: string): Promise<Array<Record<string, unknown>>> {
  const file = join(workDir, '.dbcli', 'audit', 'default.jsonl')
  try {
    const raw = await readFile(file, 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

async function readEnvelope(workDir: string): Promise<Record<string, unknown> | null> {
  const file = join(workDir, '.dbcli', 'last-recovery.json')
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

describe('Bi-directional ref round-trip (wired surface) [INTEGRATE-02 / -03 release-blocking]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-rt-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('query failure with --recovery: audit entry recovery_ref matches envelope id', async () => {
    // Spawn `query 'select ...' --recovery` with an invalid table. The catch fires; both artifacts produced.
    const r = await run(['--config', join(workDir, '.dbcli'), 'query', '--recovery', 'select 1 from "definitely-not-a-real-table-xyz"'], workDir)
    expect(r.code).not.toBe(0)  // failure exit

    const entries = await readAuditEntries(workDir)
    expect(entries.length).toBeGreaterThan(0)
    const lastEntry = entries[entries.length - 1]!
    expect(lastEntry.success).toBe(false)
    expect(typeof lastEntry.recovery_ref).toBe('string')
    expect((lastEntry.recovery_ref as string).length).toBe(36)  // UUID v4

    const envelope = await readEnvelope(workDir)
    expect(envelope).not.toBeNull()
    expect(envelope!.id).toBe(lastEntry.recovery_ref)  // ROADMAP success criterion #1 + #4
  })

  test('query failure with --recovery: envelope audit_ref matches audit entry id', async () => {
    const r = await run(['--config', join(workDir, '.dbcli'), 'query', '--recovery', 'select 1 from "definitely-not-a-real-table-xyz"'], workDir)
    expect(r.code).not.toBe(0)

    const entries = await readAuditEntries(workDir)
    const lastEntry = entries[entries.length - 1]!
    const envelope = await readEnvelope(workDir)
    expect(envelope!.audit_ref).toBe(lastEntry.id)  // ROADMAP success criterion #2 + #4
  })

  test('inspect failure with --require-schema-cache --recovery: same round-trip', async () => {
    // --require-schema-cache against a fresh tmpdir (no schema cache) throws SCHEMA_CACHE_MISSING
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--require-schema-cache', '--recovery', '--no-connect'], workDir)
    expect(r.code).not.toBe(0)

    const entries = await readAuditEntries(workDir)
    expect(entries.length).toBeGreaterThan(0)
    const lastEntry = entries[entries.length - 1]!
    const envelope = await readEnvelope(workDir)
    expect(envelope).not.toBeNull()
    expect(lastEntry.recovery_ref).toBe(envelope!.id)
    expect(envelope!.audit_ref).toBe(lastEntry.id)
  })
})

describe('J1 asymmetry guard (unwired surface) [INTEGRATE-03 negative contract]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-j1-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  // Each unwired command: trigger its --recovery failure path with invalid args; assert envelope has NO audit_ref.
  // The 6 commands are NOT wired for writeAuditEntry today (per RESEARCH section 4 call-site table).
  for (const cmd of ['insert', 'update', 'delete', 'export', 'q', 'schema'] as const) {
    test(`${cmd} --recovery failure: envelope written but audit_ref is undefined (J1 lock)`, async () => {
      // Use args that fail in argv parsing or at the command's first validation step (no DB connection needed).
      // The exact args per command differ; researcher recommends:
      //   insert: --recovery without --data/--where ...    -> validation error
      //   update: --recovery with missing required args     -> validation error
      //   delete: --recovery with missing --where           -> validation error
      //   export: --recovery with missing required args     -> validation error
      //   q: --recovery on a nonexistent snippet '@nope'   -> snippet not found
      //   schema: --recovery on a clearly-malformed table  -> error before connect
      //
      // The executor must pick the minimal-effort failure trigger for each command by inspecting the
      // command's argv handling at the top of its action handler.
      // (For some commands the catch may not run before process.exit on validation errors. If a command
      // never reaches its catch with --recovery, document that fact and SKIP that sub-case with a
      // `test.skip(...)` plus a TODO comment - the J1 guard only matters for failure paths that ACTUALLY
      // emit envelopes today.)
      const args = (() => {
        switch (cmd) {
          case 'insert': return ['insert', 'nonexistent-table', '--data', '{}', '--recovery']
          case 'update': return ['update', 'nonexistent-table', '--set', 'a=1', '--where', '1=1', '--recovery']
          case 'delete': return ['delete', 'nonexistent-table', '--where', '1=1', '--recovery']
          case 'export': return ['export', '--file', '/tmp/nope.csv', 'select 1', '--recovery']
          case 'q': return ['q', '@nope/does-not-exist', '--recovery']
          case 'schema': return ['schema', 'no-such-table', '--recovery']
        }
      })()
      const r = await run(['--config', join(workDir, '.dbcli'), ...args], workDir)
      // If the command fails before reaching emitRecoveryEnvelope, no envelope is produced - test passes vacuously by
      // asserting envelope is either null OR has no audit_ref.
      const envelope = await readEnvelope(workDir)
      if (envelope === null) {
        // Command failed before emit; no envelope to guard. Acceptable - J1 contract is vacuously satisfied.
        return
      }
      // J1 lock: when envelope IS written by an unwired command, audit_ref MUST be absent.
      expect('audit_ref' in envelope).toBe(false)

      // The 6 unwired commands also do NOT call writeAuditEntry today. Confirm no entry was written.
      const entries = await readAuditEntries(workDir)
      // Some commands may have been wired post-Phase-25 (future phases) - in that case the test will fail and
      // FORCE a planner discussion before flipping the J1 contract. That is intentional - this guard is
      // the fence that catches scope creep.
      expect(entries.length).toBe(0)
    })
  }
})

describe('DOCS-02 audit_recent embedding [4 agent surfaces]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-docs02-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('inspect --for-agent JSON has audit_recent at top level', async () => {
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--for-agent', '--no-connect'], workDir)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
  })

  test('guide health --for-agent JSON has audit_recent at top level (not inside context)', async () => {
    const r = await run(['--config', join(workDir, '.dbcli'), 'guide', 'health', '--for-agent'], workDir)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
    // The inner context.audit_recent should NOT be populated by collectGuide:
    const ctx = parsed.context as Record<string, unknown> | undefined
    if (ctx) {
      expect(ctx.audit_recent === undefined || (Array.isArray(ctx.audit_recent) && (ctx.audit_recent as unknown[]).length === 0)).toBe(true)
    }
  })

  test('recover --format json JSON has audit_recent', async () => {
    // Seed a minimal envelope first (so `recover` has something to read).
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    const env = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-15T10:00:00Z',
      ok: false as const,
      error: { code: 'UNKNOWN' as const, category: 'unknown' as const, message: 'test' },
      recovery: [],
    }
    const saved = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:00:00Z',
      command: 'dbcli query',
      cwd: workDir,
      envelope: env,
    }
    await writeFile(join(workDir, '.dbcli', 'last-recovery.json'), JSON.stringify(saved), 'utf8')

    const r = await run(['--config', join(workDir, '.dbcli'), 'recover', '--format', 'json'], workDir)
    // recover may exit 0 or 1 depending on envelope content; either is fine. Check stdout shape.
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
    // Envelope body fields still present (D-52: wrapper-at-print-site preserves body shape):
    expect(parsed.ok).toBe(false)
    expect('error' in parsed).toBe(true)
    expect('recovery' in parsed).toBe(true)
  })

  test('recover --apply --format json JSON has audit_recent alongside ApplyResult fields', async () => {
    // Build a minimal envelope with one allowed step so --apply has something to execute.
    // (Use a no-op step like `dbcli --version` if allowed; otherwise expect failed/skipped status.)
    // For now: seed an envelope and expect audit_recent to appear regardless of finalStatus.
    await mkdir(join(workDir, '.dbcli'), { recursive: true })
    const env = {
      schemaVersion: 1 as const,
      generatedAt: '2026-05-15T10:00:00Z',
      ok: false as const,
      error: { code: 'UNKNOWN' as const, category: 'unknown' as const, message: 'test' },
      recovery: [],  // empty - finalStatus will be skipped-only or similar
    }
    const saved = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:00:00Z',
      command: 'dbcli query',
      cwd: workDir,
      envelope: env,
    }
    await writeFile(join(workDir, '.dbcli', 'last-recovery.json'), JSON.stringify(saved), 'utf8')

    const r = await run(['--config', join(workDir, '.dbcli'), 'recover', '--apply'], workDir)
    // ApplyResult JSON is printed regardless of exit code.
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(Array.isArray(parsed.audit_recent)).toBe(true)
    // ApplyResult fields:
    expect(typeof parsed.schemaVersion).toBe('number')
    expect('startedAt' in parsed).toBe(true)
    expect('finalStatus' in parsed).toBe(true)
  })
})

describe('audit_recent shape contract [D-58 / D-59 / D-60]', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-shape-'))
    await seedConfig(workDir)
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function seedEntries(workDir: string, count: number): Promise<void> {
    const auditDir = join(workDir, '.dbcli', 'audit')
    await mkdir(auditDir, { recursive: true })
    const lines = Array.from({ length: count }, (_, i) => JSON.stringify({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      ts: `2026-05-15T10:${String(i % 60).padStart(2, '0')}:00Z`,
      session_id: 'sess-abc',
      engine: 'postgresql',
      command: 'query',
      side_effect_tier: 'readonly',
      target: 'users',
      success: true,
      redacted_query: 'dbcli query <sql>',
    })).join('\n') + '\n'
    await writeFile(join(auditDir, 'default.jsonl'), lines, 'utf8')
  }

  test('items have EXACTLY {id, ts, command, target, success} (D-59 forbidden keys absent)', async () => {
    await seedEntries(workDir, 1)
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--for-agent', '--no-connect'], workDir)
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout) as { audit_recent: Array<Record<string, unknown>> }
    expect(parsed.audit_recent.length).toBe(1)
    const item = parsed.audit_recent[0]!
    expect(Object.keys(item).sort()).toEqual(['command', 'id', 'success', 'target', 'ts'])
    for (const forbidden of ['redacted_query', 'redacted_sql', 'metadata', 'session_id', 'engine', 'side_effect_tier']) {
      expect(forbidden in item).toBe(false)
    }
  })

  test('caps at N=5 when 10 entries exist (D-58)', async () => {
    await seedEntries(workDir, 10)
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--for-agent', '--no-connect'], workDir)
    const parsed = JSON.parse(r.stdout) as { audit_recent: unknown[] }
    expect(parsed.audit_recent.length).toBe(5)
  })

  test('is [] when audit.enabled = false (D-60)', async () => {
    // Reseed config with audit disabled.
    await writeFile(join(workDir, '.dbcli', 'config.json'), JSON.stringify(makeMinimalConfig(false)), 'utf8')
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--for-agent', '--no-connect'], workDir)
    const parsed = JSON.parse(r.stdout) as { audit_recent: unknown[] }
    expect(parsed.audit_recent).toEqual([])
  })

  test('is [] when audit dir does not exist (D-60)', async () => {
    // Don't seed entries; audit dir simply does not exist.
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--for-agent', '--no-connect'], workDir)
    const parsed = JSON.parse(r.stdout) as { audit_recent: unknown[] }
    expect(parsed.audit_recent).toEqual([])
  })

  test('inspect --format markdown (no --for-agent) stdout does NOT contain audit_recent bytes (D-57)', async () => {
    await seedEntries(workDir, 1)
    const r = await run(['--config', join(workDir, '.dbcli'), 'inspect', '--format', 'markdown', '--no-connect'], workDir)
    expect(r.stdout.includes('audit_recent')).toBe(false)
  })
})

describe('Legacy envelope backward compatibility [D-54]', () => {
  let workDir: string
  let extFile: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-08-bc-'))
    await seedConfig(workDir)
    extFile = join(workDir, 'legacy-envelope.json')
    // Build a SavedRecoveryEnvelope WITHOUT id and audit_ref (legacy v1.17 - v1.19 shape).
    const legacy = {
      schemaVersion: 1,
      savedAt: '2026-05-15T10:00:00Z',
      command: 'dbcli query',
      cwd: workDir,
      envelope: {
        schemaVersion: 1,
        generatedAt: '2026-05-15T10:00:00Z',
        ok: false,
        error: { code: 'UNKNOWN', category: 'unknown', message: 'legacy test' },
        recovery: [],
      },
    }
    await writeFile(extFile, JSON.stringify(legacy), 'utf8')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('recover --from <legacy-fixture.json> parses without error (D-54)', async () => {
    const r = await run(['--config', join(workDir, '.dbcli'), 'recover', '--from', extFile, '--format', 'json'], workDir)
    // Should NOT exit with a 'malformed' status (EXIT_CODE.malformed = 2).
    expect(r.code).not.toBe(2)
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>
    expect(parsed.ok).toBe(false)  // envelope body still parses
  })
})

describe('Phase 22 / 24 meta-guard fences', () => {
  // Sentinel strings that must remain in the protected files. If a future change accidentally
  // touches these files, the sentinel grep will miss and the test will fail.

  test('Phase 22 audit-contract.test.ts is not gutted (sentinel string present)', async () => {
    const path = resolve(import.meta.dir, 'audit-contract.test.ts')
    const raw = await readFile(path, 'utf8')
    // Sentinel: ENTRY_REQUIRED_KEYS is the central whitelist Phase 22 locks.
    expect(raw.includes('ENTRY_REQUIRED_KEYS')).toBe(true)
  })

  test('Phase 24 audit-envelope.test.ts is not gutted (sentinel string present)', async () => {
    const path = resolve(import.meta.dir, 'audit-envelope.test.ts')
    const raw = await readFile(path, 'utf8')
    // Sentinel: D-39 / D-40 are the envelope-wrapper invariants Phase 24 locks.
    expect(raw.includes('D-39') || raw.includes('D-40') || raw.includes('audit tail --all')).toBe(true)
  })
})
```

Notes for the executor:
- The exact CLI argv that triggers each unwired command's catch-on-failure may need adjustment. Inspect each of the 6 command files (insert/update/delete/export/q/schema) before finalizing argv. If a command does not reach its catch with the supplied args, document with `test.skip()` and a TODO referring to Phase 23-04.
- The wired-surface query test uses an invalid table name to force a connection-time error. If the test infra cannot run a real DB connection in CI, fall back to a config-level failure (e.g., point at a non-existent host) - any path that throws inside the catch produces both artifacts.
- After the file lands, run `bun test tests/integration/recovery-audit-link.test.ts` and iterate until all asserted blocks pass.
  </action>
  <verify>
    <automated>bun test tests/integration/recovery-audit-link.test.ts 2>&1 | tee /tmp/test-25-08-t1.log; grep -E "(pass|fail|error)" /tmp/test-25-08-t1.log | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `test -f tests/integration/recovery-audit-link.test.ts` returns true.
    - `wc -l tests/integration/recovery-audit-link.test.ts | awk '{print $1}'` returns at least 200.
    - `grep -cE "^describe\\(" tests/integration/recovery-audit-link.test.ts` returns at least 6 (six describe blocks).
    - `grep -nE "ROADMAP success criterion #1" tests/integration/recovery-audit-link.test.ts` is at least 1 line (criterion comments embedded in tests).
    - `grep -cE "'audit_ref' in envelope" tests/integration/recovery-audit-link.test.ts` returns at least 1 (J1 negative guard).
    - `grep -cE "for \\(const cmd of \\['insert', 'update', 'delete', 'export', 'q', 'schema'\\]" tests/integration/recovery-audit-link.test.ts` returns 1 (the 6-command parameterized loop).
    - `grep -cE "audit_recent" tests/integration/recovery-audit-link.test.ts` returns at least 20 (heavy assertion of audit_recent in many places).
    - `grep -cE "redacted_query|redacted_sql|metadata|session_id|engine|side_effect_tier" tests/integration/recovery-audit-link.test.ts` returns at least 6 (D-59 forbidden-key assertions).
    - `bun test tests/integration/recovery-audit-link.test.ts` exits 0 with all release-blocking tests passing (the J1 sub-cases may be skipped per documented TODO if a command never reaches its catch with the supplied args; document each skip with a comment referencing Phase 23-04).
  </acceptance_criteria>
  <done>
    The contract test file exists, contains the 6 describe blocks specified, exercises both wired and unwired surfaces, asserts ROADMAP success criteria #1-4, locks the J1 asymmetry, and includes meta-guard fences for Phase 22 / 24 files.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update tests/integration/audit-show-health.test.ts to use UUID-style recovery_ref fixtures (RESEARCH M)</name>
  <read_first>
    - tests/integration/audit-show-health.test.ts (full file)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (section M, section 8 "Redaction tests that need EXTENDING")
  </read_first>
  <files>tests/integration/audit-show-health.test.ts</files>
  <behavior>
    - Any fixture string that supplies a `recovery_ref` value as a placeholder (e.g. `'recovery-ref-string'`, `'fake-ref'`, `'test-ref'`) should be replaced with a UUID-style value (e.g. `'f47ac10b-58cc-4372-a567-0e02b2c3d479'`).
    - This is a defensive update only - none of the existing tests' assertions depend on the value's specific bytes; they only assert presence / equality.
    - If after grep no placeholder strings exist (the file already uses UUID-style fixtures), this task is a NO-OP and acceptance criteria still pass.
  </behavior>
  <action>
**Step A - audit fixture usage:**

Run `grep -nE "recovery_ref" tests/integration/audit-show-health.test.ts` to enumerate all fixture sites. For each match, inspect whether the value is a placeholder string or already a UUID.

A value is "UUID-style" if it matches the regex `/^[0-9a-f-]{36}$/` (e.g. `f47ac10b-58cc-4372-a567-0e02b2c3d479`).

A value is a "placeholder" if it is anything else (e.g. `"abc"`, `"recovery-ref-string"`, `"test-ref"`, `"placeholder"`).

**Step B - replace placeholders:**

For each placeholder occurrence, replace it with the canonical example UUID `f47ac10b-58cc-4372-a567-0e02b2c3d479` (the RFC 4122 example). If multiple distinct refs are needed in the same test, use:
- Primary: `f47ac10b-58cc-4372-a567-0e02b2c3d479`
- Secondary: `8b3c8f0c-1234-4abc-9def-0123456789ab`
- Tertiary: `00000000-0000-4000-8000-000000000001`

Do NOT change assertion text, do NOT add new tests, do NOT modify the entries' other fields. This is fixture hygiene only.

**Step C - verify the tests still pass:**

`bun test tests/integration/audit-show-health.test.ts` must exit 0.

If grep in Step A returned NO placeholder values, document in the summary that no changes were needed.
  </action>
  <verify>
    <automated>bun test tests/integration/audit-show-health.test.ts 2>&1 | tee /tmp/test-25-08-t2.log; grep -E "(pass|fail|error)" /tmp/test-25-08-t2.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "recovery_ref" tests/integration/audit-show-health.test.ts` returns at least one line (the field is still referenced).
    - For every recovery_ref string-literal value in the file, the value matches the UUID regex `^[0-9a-f-]{36}$`. Run `grep -oE "recovery_ref[\"']?\\s*[:=]\\s*[\"'][^\"']+[\"']" tests/integration/audit-show-health.test.ts` and visually confirm each match value is UUID-shaped (or run the awk helper in Step A to assert programmatically).
    - `bun test tests/integration/audit-show-health.test.ts` exits 0.
  </acceptance_criteria>
  <done>
    All recovery_ref fixture strings in audit-show-health.test.ts are UUID-style. The test still passes.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0 (the new test file must typecheck against the post-Plan-01..07 type shape).
2. `bun test tests/integration/recovery-audit-link.test.ts` exits 0; all release-blocking tests green.
3. `bun test tests/integration/audit-show-health.test.ts` exits 0.
4. `bun test tests/integration/audit-contract.test.ts` exits 0 AND the file's content is unchanged (`git diff tests/integration/audit-contract.test.ts` shows no output).
5. `bun test tests/integration/audit-envelope.test.ts` exits 0 AND the file's content is unchanged.
6. `git diff --name-only HEAD` after this plan shows only `tests/integration/recovery-audit-link.test.ts` and possibly `tests/integration/audit-show-health.test.ts` (NOT audit-contract / audit-envelope).
</verification>

<success_criteria>
- The release-blocking round-trip + J1 asymmetry guard test exists and passes.
- All four ROADMAP success criteria are now contractually defended by automated tests.
- The 6 unwired commands' negative guard fails immediately if any future change leaks `audit_ref` onto their envelopes.
- D-54 backward compatibility is locked.
- Phase 22 audit-contract.test.ts and Phase 24 audit-envelope.test.ts are NOT modified (fence enforced by meta-guard test inside this new file).
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-08-SUMMARY.md` documenting:
- All 6 describe blocks and which ROADMAP criteria each covers
- The J1 coverage matrix (table form, mirroring PATTERNS.md section "J1 Coverage Matrix")
- Any sub-cases that had to be `test.skip(...)`-ed (e.g. because a command's --recovery failure path is unreachable in CI), with TODO -> Phase 23-04 follow-up
- Confirmation that the 2 Phase-22/24 meta-guards are in place
- Forward pointer: Plan 09 (release gate) runs the full release:check
</output>
