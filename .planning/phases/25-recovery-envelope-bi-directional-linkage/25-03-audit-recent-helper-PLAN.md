---
phase: 25
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/audit/types.ts
  - src/core/audit/recent.ts
  - tests/unit/core/audit/recent.test.ts
autonomous: true
requirements: [DOCS-02]
must_haves:
  truths:
    - "AuditEntryBrief is exported from src/core/audit/types.ts with exactly {id, ts, command, target, success}"
    - "loadRecentAudit returns the last N (default 5) entries from the current connection in time-ascending order"
    - "loadRecentAudit returns [] when audit.enabled === false (D-60)"
    - "loadRecentAudit returns [] when the audit file is missing (ENOENT)"
    - "loadRecentAudit NEVER throws (any internal error collapses to [])"
    - "shouldEmbedRecent returns true when forAgent === true OR format === 'json'"
    - "loadRecentAudit uses include_rotated: true so rotated segment entries are visible"
    - "Returned brief items MUST NOT contain redacted_query, redacted_sql, metadata, session_id, engine, side_effect_tier (D-59 forbidden keys)"
  artifacts:
    - path: "src/core/audit/types.ts"
      provides: "AuditEntryBrief type with exactly 5 keys"
      contains: "AuditEntryBrief"
    - path: "src/core/audit/recent.ts"
      provides: "shouldEmbedRecent + loadRecentAudit + RECENT_AUDIT_DEFAULT_N exports"
      contains: "loadRecentAudit"
    - path: "tests/unit/core/audit/recent.test.ts"
      provides: "Unit tests for default N, disabled/empty/missing fall-through, brief shape, rotation"
      contains: "loadRecentAudit"
  key_links:
    - from: "src/core/audit/recent.ts"
      to: "src/core/audit/reader.ts"
      via: "readEntries({ include_rotated: true }) + tailEntries"
      pattern: "readEntries\\(.*include_rotated"
    - from: "src/core/audit/recent.ts"
      to: "src/core/audit/integration-helper.ts"
      via: "getAuditLogger then logger.getHealth().currentFile to resolve audit file path"
      pattern: "getAuditLogger"
---

<objective>
Create the single source of truth for DOCS-02's `audit_recent` embedding:
1. A new exported type `AuditEntryBrief` in `src/core/audit/types.ts` capturing exactly the 5 keys agents need to join (`id`, `ts`, `command`, `target`, `success`).
2. A new module `src/core/audit/recent.ts` with `shouldEmbedRecent` (trigger predicate) + `loadRecentAudit` (last-N reader with fall-through to `[]`).
3. A unit test that locks the contract: brief shape, default N, fall-through semantics, rotation inclusion.

Purpose: D-56 / D-57 / D-58 / D-59 / D-60 collected in one helper so Plans 06 (inspect/guide) and 07 (recover) just call it instead of re-implementing the read path four times.

Output: One new type, one new module (~50 lines), and a unit test suite that the contract test in Plan 08 will lean on.
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
@src/core/audit/types.ts
@src/core/audit/reader.ts
@src/core/audit/integration-helper.ts
@src/core/audit/logger.ts

<interfaces>
Current AuditEntry shape (src/core/audit/types.ts:4-31):
```ts
export interface AuditEntry {
  id: string
  ts: string
  session_id: string
  engine: DatabaseSystem
  command: string
  side_effect_tier: SideEffectTier
  target: string
  success: boolean
  error?: string
  recovery_ref?: string
  redacted_query: string
  redacted_sql?: string
  metadata?: Record<string, unknown>
}
```

Reader API to compose (src/core/audit/reader.ts:55-65, 98-104):
```ts
export async function readEntries(
  auditFilePath: string,
  opts?: { include_rotated?: boolean }
): Promise<AuditEntry[]>

export function tailEntries(entries: AuditEntry[], n: number): AuditEntry[]
// returns ASCending by ts, slice(-n), so latest LAST (matches D-58)
```

Logger health surface for resolving the current audit file (src/core/audit/logger.ts:48-63 AuditHealthReport, currentFile field):
```ts
const logger = await getAuditLogger(config, configPath)
const auditFile = logger.getHealth().currentFile
```

Phase 24 brief comparison (src/commands/audit.ts:88):
```ts
type BriefEntry = Pick<AuditEntry, 'ts' | 'command' | 'target' | 'success'>
// NOTE: Phase 24's tail --brief OMITS id (intentional; matches Phase 24 D-33).
// Phase 25's AuditEntryBrief ADDS id so agents can client-side join entry.id === envelope.audit_ref.
// Do NOT change Phase 24's BriefEntry type; create a parallel one.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add AuditEntryBrief type to src/core/audit/types.ts</name>
  <read_first>
    - src/core/audit/types.ts (lines 4-31, current AuditEntry interface)
    - src/commands/audit.ts (lines 85-100, Phase 24 inline `BriefEntry` - do NOT modify; only reference)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 6, exact target shape)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-59 - forbidden keys list)
  </read_first>
  <files>src/core/audit/types.ts</files>
  <behavior>
    - `AuditEntryBrief` is a `Pick` over `AuditEntry` with EXACTLY the keys: `id`, `ts`, `command`, `target`, `success`.
    - The type is exported (so Plans 06/07 and the unit test can import it).
    - The existing `AuditEntry` interface is NOT modified - only a new sibling type is added at the end of the file.
    - Phase 24's `BriefEntry` (in `src/commands/audit.ts`) is intentionally distinct (it lacks `id`); this task does NOT touch that file.
  </behavior>
  <action>
Open `src/core/audit/types.ts`. After the closing brace of `AuditEntry` (line 31), append the new exported type:

```ts
/**
 * Phase 25 D-59: brief audit entry for DOCS-02 `audit_recent` embeds.
 * Reuses Phase 24 `tail --brief` shape PLUS `id` so agents can client-side
 * join `entry.id === envelope.audit_ref`.
 *
 * PROHIBITED keys (must not be present in serialized output): redacted_query,
 * redacted_sql, metadata, session_id, engine, side_effect_tier (D-59).
 */
export type AuditEntryBrief = Pick<
  AuditEntry,
  'id' | 'ts' | 'command' | 'target' | 'success'
>
```

Do NOT touch `AuditEntry`.
Do NOT touch `src/commands/audit.ts` (Phase 24's `BriefEntry` stays as-is per RESEARCH Assumption A3 - it omits `id` intentionally for `audit tail --brief`).

Run `bun run typecheck` to confirm no regression.
  </action>
  <verify>
    <automated>bun run typecheck 2>&1 | tee /tmp/typecheck-25-03-t1.log; grep -E "(error TS|Found 0 errors)" /tmp/typecheck-25-03-t1.log | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "export type AuditEntryBrief" src/core/audit/types.ts` returns exactly one line.
    - `grep -nE "Pick<\\s*AuditEntry," src/core/audit/types.ts` returns a line referencing AuditEntry.
    - `grep -E "'id' \\| 'ts' \\| 'command' \\| 'target' \\| 'success'" src/core/audit/types.ts` returns one line containing all 5 keys.
    - `bun run typecheck` exits 0.
    - `grep -nE "^export interface AuditEntry " src/core/audit/types.ts | head -1` shows AuditEntry interface declaration is still on its original line (unchanged).
  </acceptance_criteria>
  <done>
    AuditEntryBrief is exported from src/core/audit/types.ts as a Pick with exactly 5 keys (id, ts, command, target, success). AuditEntry is untouched. Forbidden D-59 keys (redacted_query, redacted_sql, metadata, session_id, engine, side_effect_tier) do not appear in the brief type.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create src/core/audit/recent.ts with shouldEmbedRecent + loadRecentAudit and a unit test suite</name>
  <read_first>
    - src/core/audit/types.ts (post Task 1, AuditEntry + AuditEntryBrief)
    - src/core/audit/reader.ts (full file, especially readEntries + tailEntries)
    - src/core/audit/integration-helper.ts (lines 20-50, getAuditLogger)
    - src/core/audit/logger.ts (lines 48-63 AuditHealthReport, plus the getHealth() method - search for "getHealth(" in the file to confirm its signature)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-PATTERNS.md (section 7, the new file's full content + section "Shared Patterns - D-60 fall-through")
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-CONTEXT.md (D-56 to D-60, especially D-60)
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-RESEARCH.md (sections 6 + 7 - reader API, rotation)
  </read_first>
  <files>
    src/core/audit/recent.ts,
    tests/unit/core/audit/recent.test.ts
  </files>
  <behavior>
    Module exports (new file):
    - `RECENT_AUDIT_DEFAULT_N = 5` (hard-coded constant, D-58)
    - `shouldEmbedRecent(opts: { forAgent?: boolean; format: string }): boolean` returns `opts.forAgent === true || opts.format === 'json'`
    - `loadRecentAudit(config, configPath, n?: number): Promise<AuditEntryBrief[]>` returns the last N entries from the current connection's audit file in ascending time order (latest LAST), brief-tailored.

    Test cases (RED first):
    - Empty audit dir (ENOENT) -> `[]`.
    - `audit.enabled === false` -> `[]` without touching disk.
    - File with 3 entries, `n=5` -> returns all 3 in ASCending order (latest LAST).
    - File with 10 entries, default `n=5` -> returns exactly 5 (the most recent 5, latest LAST).
    - Returned items have EXACTLY 5 keys (`id`, `ts`, `command`, `target`, `success`); no forbidden keys present.
    - `shouldEmbedRecent({ forAgent: true, format: 'markdown' })` -> true.
    - `shouldEmbedRecent({ forAgent: false, format: 'json' })` -> true.
    - `shouldEmbedRecent({ forAgent: false, format: 'markdown' })` -> false.
    - Rotation: write 1010 entries to force one rotation; the latest 5 returned by `loadRecentAudit` include entries that may span the rotated segment because `include_rotated: true` is used. (Implementation-level: rotation cap is 1000 entries by default; entry 1001 forces rotation. Latest 5 = entries 1006-1010, all in the current segment, but the helper still passes `include_rotated: true` so older lookups would also work.)
  </behavior>
  <action>
**Step A - create `src/core/audit/recent.ts`:**

Use the exact module body from PATTERNS.md section 7. The full content is:

```ts
/**
 * Phase 25 DOCS-02 / D-56..D-61: load recent audit entries for embed in
 * inspect / guide / recover / recover --apply JSON output.
 *
 * Single source of truth for the trigger condition and brief tailoring.
 * Read-only; never throws (errors -> []).
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

Implementation notes:
- The `import type { AuditEntry, ... }` and `import type { DbcliConfig }` keep the new module type-only-aware where possible.
- If `logger.getHealth()` is synchronous it returns `AuditHealthReport` directly; if it's a method returning a promise, await it. Check the actual signature in `src/core/audit/logger.ts` before writing the call - the source of truth is the file, NOT this excerpt.
- Do NOT use `discoverConnections` or `mergeByTimestamp` - those are `audit tail --all` territory, outside DOCS-02 scope (CONTEXT.md H).
- Do NOT add a stderr warning when fall-through happens - the read path may already emit a `[dbcli audit] skipping truncated last line` warning (reader.ts:44); that is acceptable per RESEARCH section 6 note 4.

**Step B - create `tests/unit/core/audit/recent.test.ts`:**

Mirror the fixture pattern from `tests/unit/core/audit/reader.test.ts`. Test cases:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRecentAudit, shouldEmbedRecent, RECENT_AUDIT_DEFAULT_N } from '@/core/audit/recent'
import type { DbcliConfig } from '@/utils/validation'
import type { AuditEntry } from '@/core/audit/types'

function makeConfig(enabled: boolean): DbcliConfig {
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
    audit: { enabled, rotation: { max_bytes: 10_485_760, max_entries: 1000 } },
  } as DbcliConfig
}

function makeEntry(i: number, ts: string): AuditEntry {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ts,
    session_id: 'sess-abc',
    engine: 'postgresql',
    command: 'query',
    side_effect_tier: 'readonly',
    target: 'users',
    success: true,
    redacted_query: 'dbcli query <sql>',
  }
}

describe('shouldEmbedRecent (Phase 25 D-57)', () => {
  test('returns true when forAgent is true (markdown format)', () => {
    expect(shouldEmbedRecent({ forAgent: true, format: 'markdown' })).toBe(true)
  })

  test('returns true when format is json (forAgent false)', () => {
    expect(shouldEmbedRecent({ forAgent: false, format: 'json' })).toBe(true)
  })

  test('returns false for human markdown without forAgent', () => {
    expect(shouldEmbedRecent({ forAgent: false, format: 'markdown' })).toBe(false)
  })

  test('returns false when both fields are undefined-ish (format defaulted)', () => {
    expect(shouldEmbedRecent({ format: 'markdown' })).toBe(false)
  })
})

describe('RECENT_AUDIT_DEFAULT_N (Phase 25 D-58)', () => {
  test('is exactly 5 (hard-coded; no --audit-n flag)', () => {
    expect(RECENT_AUDIT_DEFAULT_N).toBe(5)
  })
})

describe('loadRecentAudit (Phase 25 D-58 / D-60)', () => {
  let workDir: string
  let configPath: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-25-03-'))
    configPath = join(workDir, '.dbcli')
    await mkdir(configPath, { recursive: true })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('returns [] when audit.enabled === false (D-60)', async () => {
    const config = makeConfig(false)
    const r = await loadRecentAudit(config, configPath)
    expect(r).toEqual([])
  })

  test('returns [] when audit dir does not exist (ENOENT fall-through)', async () => {
    const config = makeConfig(true)
    const r = await loadRecentAudit(config, configPath)
    expect(r).toEqual([])
  })

  test('returns all entries (ASCending) when count <= N', async () => {
    const config = makeConfig(true)
    const auditDir = join(configPath, 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    const lines = [
      JSON.stringify(makeEntry(1, '2026-05-15T10:00:00Z')),
      JSON.stringify(makeEntry(2, '2026-05-15T10:01:00Z')),
      JSON.stringify(makeEntry(3, '2026-05-15T10:02:00Z')),
    ].join('\n') + '\n'
    await writeFile(auditFile, lines, 'utf8')

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(3)
    // latest LAST per D-58
    expect(r[0]!.ts).toBe('2026-05-15T10:00:00Z')
    expect(r[2]!.ts).toBe('2026-05-15T10:02:00Z')
  })

  test('caps at default N=5 when more entries exist', async () => {
    const config = makeConfig(true)
    const auditDir = join(configPath, 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify(makeEntry(i + 1, `2026-05-15T10:0${i}:00Z`))
    ).join('\n') + '\n'
    await writeFile(auditFile, lines, 'utf8')

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(5)
    // latest LAST: entries 6..10 with ts 10:05..10:09
    expect(r[0]!.ts).toBe('2026-05-15T10:05:00Z')
    expect(r[4]!.ts).toBe('2026-05-15T10:09:00Z')
  })

  test('returned items have EXACTLY 5 keys; D-59 forbidden keys absent', async () => {
    const config = makeConfig(true)
    const auditDir = join(configPath, 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    await writeFile(
      auditFile,
      JSON.stringify(makeEntry(1, '2026-05-15T10:00:00Z')) + '\n',
      'utf8'
    )

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(1)
    const keys = Object.keys(r[0]!).sort()
    expect(keys).toEqual(['command', 'id', 'success', 'target', 'ts'])
    // D-59 forbidden keys absent
    expect('redacted_query' in r[0]!).toBe(false)
    expect('redacted_sql' in r[0]!).toBe(false)
    expect('metadata' in r[0]!).toBe(false)
    expect('session_id' in r[0]!).toBe(false)
    expect('engine' in r[0]!).toBe(false)
    expect('side_effect_tier' in r[0]!).toBe(false)
  })

  test('reads rotated segment too (include_rotated: true)', async () => {
    const config = makeConfig(true)
    const auditDir = join(configPath, 'audit')
    await mkdir(auditDir, { recursive: true })
    const currentFile = join(auditDir, 'default.jsonl')
    const rotatedFile = join(auditDir, 'default.jsonl.1')
    // rotated segment has older entries; current has the latest.
    await writeFile(
      rotatedFile,
      [
        JSON.stringify(makeEntry(1, '2026-05-15T09:00:00Z')),
        JSON.stringify(makeEntry(2, '2026-05-15T09:01:00Z')),
      ].join('\n') + '\n',
      'utf8'
    )
    await writeFile(
      currentFile,
      JSON.stringify(makeEntry(3, '2026-05-15T10:00:00Z')) + '\n',
      'utf8'
    )

    const r = await loadRecentAudit(config, configPath)
    expect(r).toHaveLength(3)  // rotated (2) + current (1)
    expect(r.map(e => e.ts)).toEqual([
      '2026-05-15T09:00:00Z',
      '2026-05-15T09:01:00Z',
      '2026-05-15T10:00:00Z',
    ])
  })

  test('never throws on corrupted file - returns [] instead', async () => {
    const config = makeConfig(true)
    const auditDir = join(configPath, 'audit')
    await mkdir(auditDir, { recursive: true })
    const auditFile = join(auditDir, 'default.jsonl')
    // Middle-line corruption (NOT truncated last line). Reader throws; loadRecentAudit must swallow.
    await writeFile(
      auditFile,
      [
        JSON.stringify(makeEntry(1, '2026-05-15T10:00:00Z')),
        'this-is-not-json',
        JSON.stringify(makeEntry(3, '2026-05-15T10:02:00Z')),
      ].join('\n') + '\n',
      'utf8'
    )
    const r = await loadRecentAudit(config, configPath)
    expect(r).toEqual([])  // D-60 fall-through
  })
})
```

Run `bun test tests/unit/core/audit/recent.test.ts` and confirm all cases pass.
  </action>
  <verify>
    <automated>bun test tests/unit/core/audit/recent.test.ts 2>&1 | tee /tmp/test-25-03-t2.log; grep -E "(pass|fail|error)" /tmp/test-25-03-t2.log | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/core/audit/recent.ts` returns true.
    - `grep -nE "export const RECENT_AUDIT_DEFAULT_N = 5" src/core/audit/recent.ts` returns one line.
    - `grep -nE "export function shouldEmbedRecent" src/core/audit/recent.ts` returns one line.
    - `grep -nE "export async function loadRecentAudit" src/core/audit/recent.ts` returns one line.
    - `grep -nE "include_rotated: true" src/core/audit/recent.ts` returns one line (RESEARCH section 7).
    - `grep -nE "config\\.audit\\?\\.enabled === false" src/core/audit/recent.ts` returns one line (D-60 short-circuit).
    - `grep -nE "} catch" src/core/audit/recent.ts | head -1` shows a try/catch that swallows errors and returns `[]`.
    - `bun test tests/unit/core/audit/recent.test.ts` exits 0 with all listed tests passing (>= 11 tests: 4 shouldEmbedRecent + 1 constant + 7 loadRecentAudit).
    - `bun run typecheck` exits 0.
  </acceptance_criteria>
  <done>
    `src/core/audit/recent.ts` exists with the three exports. `loadRecentAudit` reads the current connection's audit file (including rotated segment), tail-caps to N (default 5), brief-tailors via briefifyForRecent, and never throws. All unit tests pass.
  </done>
</task>

</tasks>

<verification>
1. `bun run typecheck` exits 0.
2. `bun test tests/unit/core/audit/recent.test.ts` exits 0 with all new tests green.
3. `bun test tests/unit/core/audit/` (whole audit unit dir) exits 0 (logger / reader / lock / rotation / session-id tests still pass; no regression to integration-helper).
4. `grep -nE "redacted_query|redacted_sql|metadata|session_id|engine|side_effect_tier" src/core/audit/recent.ts` returns NOTHING (the briefifyForRecent function does not reference any forbidden field).
</verification>

<success_criteria>
- `AuditEntryBrief` is exported from `src/core/audit/types.ts` with exactly {id, ts, command, target, success}.
- `src/core/audit/recent.ts` exports `RECENT_AUDIT_DEFAULT_N`, `shouldEmbedRecent`, and `loadRecentAudit`.
- `loadRecentAudit` returns brief entries (5 keys exactly) in ascending time order, capped at N=5, including rotated segment, and falls through to `[]` for all error conditions.
- Plans 06 (inspect/guide) and 07 (recover) can now do `if (shouldEmbedRecent({ forAgent, format })) audit_recent = await loadRecentAudit(config, configPath)` without re-implementing anything.
</success_criteria>

<output>
After completion, create `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-03-SUMMARY.md` documenting:
- The 3 exports and what each is responsible for
- D-57 / D-58 / D-59 / D-60 mapping to test names
- Confirmation that the brief shape EXACTLY matches D-59 (5 keys, no forbidden keys)
- Forward pointer: Plans 06 and 07 import `shouldEmbedRecent` + `loadRecentAudit`; Plan 08 contract test uses the brief shape to assert agent-facing JSON.
</output>
