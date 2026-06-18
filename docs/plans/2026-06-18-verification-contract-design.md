# Verification Contract Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a v1.34-ready verification contract with stable outcome vocabulary, artifact schema, and compatibility adapters for existing recovery verification.

**Architecture:** Keep this milestone contract-first and non-executing. Add a small `src/core/verification/` module that owns shared verification types, status guards, artifact shape, and recovery-status mapping. Document the schema in `docs/specs/`, route agents to the vocabulary from the skill, and preserve all existing recovery `verifyStatus` fields for backward compatibility.

**Tech Stack:** Bun, TypeScript, `bun:test`, existing recovery verification (`src/core/recovery/apply-verify.ts`), existing task-pack planner (`src/core/agent-tasks/`), skill sync/parity scripts.

---

## Source Of Truth

Use [docs/specs/2026-06-18-agent-database-verification-workflow.md](../specs/2026-06-18-agent-database-verification-workflow.md) as the strategy source.

This plan implements **Milestone 2 - Verification Contract Design** only:

- Define stable statuses: `verified`, `not_verified`, `indeterminate`, `blocked`.
- Define a versioned JSON artifact contract, but do not write artifacts yet.
- Add pure TypeScript helpers that existing recovery verification can map into.
- Document how verification relates to recovery envelopes, audit entries, task packs, `assert`, and `snapshot`.
- Keep `dbcli verify` out of scope.

## Current Evidence

- The strategy note says verification should standardize `verified`, `not_verified`, `indeterminate`, and `blocked`, and should eventually store bounded JSON evidence under `.dbcli/` ([docs/specs/2026-06-18-agent-database-verification-workflow.md](/Users/carl/Dev/CMG/Dbcli/docs/specs/2026-06-18-agent-database-verification-workflow.md:101)).
- Existing recovery verification uses `VerifyStatus = 'passed' | 'failed' | 'indeterminate'` in [src/core/recovery/apply-types.ts](/Users/carl/Dev/CMG/Dbcli/src/core/recovery/apply-types.ts:51).
- Recovery verifier gate skips currently surface as `indeterminate` from [src/core/recovery/apply-verify.ts](/Users/carl/Dev/CMG/Dbcli/src/core/recovery/apply-verify.ts:47); the new contract should map those skip cases to `blocked`.
- Task packs are currently plan-only command lists with `risk` but no verification artifact semantics in [src/core/agent-tasks/types.ts](/Users/carl/Dev/CMG/Dbcli/src/core/agent-tasks/types.ts:24).
- `assert` already provides read-only invariant verdicts and exit-code semantics in [src/commands/assert.ts](/Users/carl/Dev/CMG/Dbcli/src/commands/assert.ts:39), making it the natural first evidence source for later Safe Backfill Verify MVP work.

## Non-Goals

- Do not add `dbcli verify`.
- Do not execute task-pack steps automatically.
- Do not change recovery output fields or remove `verifyStatus: passed|failed|indeterminate`.
- Do not write `.dbcli/verification/*.json` artifacts yet.
- Do not change database behavior, permissions, blacklist behavior, or `assert` command behavior.
- Do not edit `docs/user/**` unless implementation changes user-facing command behavior. This milestone defines internal/agent contract language only.

## Contract Decisions

### Status Vocabulary

Use this shared vocabulary for all new verification artifacts:

| Status | Meaning | Existing source mapping |
| --- | --- | --- |
| `verified` | Required verification evidence matched. | recovery `passed`, assert JSON `pass: true`, future snapshot compare pass |
| `not_verified` | Verification ran and evidence contradicted the expected state. | recovery `failed`, assert JSON `pass: false`, command exit non-zero after running |
| `indeterminate` | Verification ran but evidence was insufficient or ambiguous. | recovery `indeterminate` with an executed `ok` step but inconclusive stdout |
| `blocked` | Verification could not run. | recovery `skipped:*`, missing config/schema/permission/placeholder, unsupported engine |

### Artifact Shape

Use this shape as the v1 schema. It is defined in TypeScript now and persisted later.

```typescript
export const VERIFICATION_ARTIFACT_SCHEMA_VERSION = 1 as const

export type VerificationStatus = 'verified' | 'not_verified' | 'indeterminate' | 'blocked'

export type VerificationEvidenceKind =
  | 'assert'
  | 'snapshot'
  | 'recovery-verify'
  | 'task-pack-plan'
  | 'manual'

export interface VerificationEvidenceRef {
  kind: VerificationEvidenceKind
  command?: string
  exitCode?: number
  auditRef?: string
  recoveryRef?: string
  snapshotPath?: string
  taskName?: string
  step?: number
  note?: string
}

export interface VerificationArtifact {
  schemaVersion: typeof VERIFICATION_ARTIFACT_SCHEMA_VERSION
  id: string
  createdAt: string
  status: VerificationStatus
  subject: {
    kind: 'recovery' | 'task-pack' | 'assertion' | 'migration' | 'backfill' | 'manual'
    name?: string
    command?: string
  }
  summary: string
  evidence: VerificationEvidenceRef[]
  blockedReason?: string
}
```

### Artifact Path Policy

Document the future storage path now, but do not implement writes in this milestone:

```text
.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json
```

Reasoning:

- Keeps evidence separate from `.dbcli/last-recovery.json`.
- Allows later multiple verification artifacts per operation.
- Avoids changing recovery file lifecycle in a contract-only milestone.

## File Structure

Create:

- `docs/specs/2026-06-18-verification-contract.md` - canonical contract spec.
- `src/core/verification/types.ts` - status, evidence, artifact types.
- `src/core/verification/status.ts` - guards and mapping helpers.
- `src/core/verification/index.ts` - barrel export.
- `tests/unit/core/verification/status.test.ts` - pure status/mapping tests.
- `tests/unit/core/verification/types-contract.test.ts` - artifact shape compile/runtime guard tests.

Modify:

- `src/core/index.ts` - export the new verification module for `@carllee1983/dbcli/core`.
- `src/core/recovery/apply-types.ts` - import and expose a compatibility alias or field type without changing the existing `VerifyStatus`.
- `src/core/recovery/apply-verify.ts` - attach a contract status to the returned internal outcome while preserving existing `status`.
- `tests/unit/core/recovery/apply-verify.test.ts` - prove skipped verifiers map to `blocked` and existing statuses remain unchanged.
- `assets/SKILL.md` - add one compact verification vocabulary paragraph.
- `assets/SKILL.zh-TW.md` - add mirrored compact paragraph.

Generated by sync script only:

- `plugins/dbcli-agent/skills/dbcli/SKILL.md`
- `skills/dbcli/SKILL.md`
- `.cursor/rules/dbcli.mdc`
- `.github/skills/dbcli/SKILL.md`
- `.windsurfrules`

## Task 1: Add Contract Spec

**Purpose:** Record the product and engineering contract before code depends on it.

**Files:**

- Create: `docs/specs/2026-06-18-verification-contract.md`

- [ ] **Step 1: Create the spec**

Create `docs/specs/2026-06-18-verification-contract.md` with this content:

````markdown
# Verification Contract

**Date:** 2026-06-18
**Status:** Contract for implementation
**Baseline:** dbcli v1.33.0

## Purpose

Verification is the evidence layer for agent database work. It answers whether
a required check proved the intended state, contradicted it, could not decide,
or could not run.

## Statuses

| Status | Meaning |
| --- | --- |
| `verified` | Required verification evidence matched. |
| `not_verified` | Verification ran and evidence contradicted the expected state. |
| `indeterminate` | Verification ran but evidence was insufficient or ambiguous. |
| `blocked` | Verification could not run because of permission, missing config/schema, unsupported engine, placeholder, unsafe command, or another gate. |

## Compatibility

Existing recovery `verifyStatus` values remain unchanged:

| Recovery `verifyStatus` | Contract status |
| --- | --- |
| `passed` | `verified` |
| `failed` | `not_verified` |
| `indeterminate` with executed verifier | `indeterminate` |
| `indeterminate` with `skipped:*` verifier result | `blocked` |

## Artifact Schema

Artifacts use schema version `1`. This milestone defines the schema but does not
write artifacts to disk.

```json
{
  "schemaVersion": 1,
  "id": "ver_...",
  "createdAt": "2026-06-18T00:00:00.000Z",
  "status": "verified",
  "subject": {
    "kind": "backfill",
    "name": "safe-backfill-verify",
    "command": "dbcli assert \"SELECT count(*) FROM orders WHERE status IS NULL\" --expect \"rows == 0\""
  },
  "summary": "Read-back assertion passed.",
  "evidence": [
    {
      "kind": "assert",
      "command": "dbcli assert \"SELECT count(*) FROM orders WHERE status IS NULL\" --expect \"rows == 0\"",
      "exitCode": 0,
      "auditRef": "optional-audit-id"
    }
  ]
}
```

## Future Storage Path

When artifact writing is implemented, write bounded JSON evidence under:

```text
.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json
```

## Relationship To Existing Commands

- `assert`: primary read-back invariant evidence.
- `snapshot`: baseline and drift evidence.
- `recover --apply`: existing verifier source; keeps `verifyStatus` but can expose contract status internally.
- task packs: plan verification commands and later reference produced artifacts.
- audit: evidence references may include `auditRef` but artifacts are not replacements for audit logs.

## First Implementation Target

The first workflow to consume this contract should be `safe-backfill-verify`.
````

- [ ] **Step 2: Verify spec has required statuses**

Run:

```bash
rg -n "`verified`|`not_verified`|`indeterminate`|`blocked`" docs/specs/2026-06-18-verification-contract.md
```

Expected: all four statuses are present.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-06-18-verification-contract.md
git commit -m "Define the verification contract before execution support" \
  -m "Constraint: Milestone 2 is contract-only and must not add dbcli verify or artifact writes." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: rg -n \"verified|not_verified|indeterminate|blocked\" docs/specs/2026-06-18-verification-contract.md"
```

## Task 2: Add Core Verification Types

**Purpose:** Make the contract importable by future recovery, task-pack, and artifact code.

**Files:**

- Create: `src/core/verification/types.ts`
- Create: `src/core/verification/status.ts`
- Create: `src/core/verification/index.ts`
- Create: `tests/unit/core/verification/status.test.ts`
- Create: `tests/unit/core/verification/types-contract.test.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: Write failing status tests**

Create `tests/unit/core/verification/status.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  isVerificationStatus,
  recoveryVerifyToVerificationStatus,
  stepResultToBlockedReason,
} from '@/core/verification'
import type { StepResult, VerifyStatus } from '@/core/recovery/apply-types'

const skipped = (status: StepResult['status'], reason?: string): StepResult => ({
  order: 0,
  command: 'dbcli schema <table> --format json',
  status,
  reason,
})

describe('verification status contract', () => {
  test('guards stable status vocabulary', () => {
    expect(isVerificationStatus('verified')).toBe(true)
    expect(isVerificationStatus('not_verified')).toBe(true)
    expect(isVerificationStatus('indeterminate')).toBe(true)
    expect(isVerificationStatus('blocked')).toBe(true)
    expect(isVerificationStatus('passed')).toBe(false)
  })

  test.each([
    ['passed', 'verified'],
    ['failed', 'not_verified'],
    ['indeterminate', 'indeterminate'],
  ] as Array<[VerifyStatus, string]>)('maps recovery %s to %s', (input, expected) => {
    expect(recoveryVerifyToVerificationStatus(input)).toBe(expected)
  })

  test('maps skipped recovery verifier to blocked', () => {
    expect(
      recoveryVerifyToVerificationStatus('indeterminate', skipped('skipped:placeholder', 'missing table'))
    ).toBe('blocked')
  })

  test('derives blocked reason from skipped step', () => {
    expect(stepResultToBlockedReason(skipped('skipped:unsafe-command', 'not allowlisted'))).toBe(
      'not allowlisted'
    )
  })
})
```

Run:

```bash
bun test tests/unit/core/verification/status.test.ts
```

Expected: FAIL because `@/core/verification` does not exist yet.

- [ ] **Step 2: Write failing artifact shape test**

Create `tests/unit/core/verification/types-contract.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  VERIFICATION_ARTIFACT_SCHEMA_VERSION,
  type VerificationArtifact,
} from '@/core/verification'

describe('verification artifact contract', () => {
  test('constructs the v1 artifact shape', () => {
    const artifact: VerificationArtifact = {
      schemaVersion: VERIFICATION_ARTIFACT_SCHEMA_VERSION,
      id: 'ver_test_123',
      createdAt: '2026-06-18T00:00:00.000Z',
      status: 'verified',
      subject: {
        kind: 'backfill',
        name: 'safe-backfill-verify',
      },
      summary: 'Read-back assertion passed.',
      evidence: [
        {
          kind: 'assert',
          command: 'dbcli assert "SELECT count(*) FROM orders" --expect "rows > 0"',
          exitCode: 0,
          auditRef: 'audit_123',
        },
      ],
    }

    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.status).toBe('verified')
    expect(artifact.evidence[0]?.kind).toBe('assert')
  })
})
```

Run:

```bash
bun test tests/unit/core/verification/types-contract.test.ts
```

Expected: FAIL because `@/core/verification` does not exist yet.

- [ ] **Step 3: Add verification types**

Create `src/core/verification/types.ts`:

```typescript
export const VERIFICATION_ARTIFACT_SCHEMA_VERSION = 1 as const

export type VerificationStatus = 'verified' | 'not_verified' | 'indeterminate' | 'blocked'

export type VerificationEvidenceKind =
  | 'assert'
  | 'snapshot'
  | 'recovery-verify'
  | 'task-pack-plan'
  | 'manual'

export type VerificationSubjectKind =
  | 'recovery'
  | 'task-pack'
  | 'assertion'
  | 'migration'
  | 'backfill'
  | 'manual'

export interface VerificationEvidenceRef {
  kind: VerificationEvidenceKind
  command?: string
  exitCode?: number
  auditRef?: string
  recoveryRef?: string
  snapshotPath?: string
  taskName?: string
  step?: number
  note?: string
}

export interface VerificationSubject {
  kind: VerificationSubjectKind
  name?: string
  command?: string
}

export interface VerificationArtifact {
  schemaVersion: typeof VERIFICATION_ARTIFACT_SCHEMA_VERSION
  id: string
  createdAt: string
  status: VerificationStatus
  subject: VerificationSubject
  summary: string
  evidence: VerificationEvidenceRef[]
  blockedReason?: string
}
```

- [ ] **Step 4: Add status helpers**

Create `src/core/verification/status.ts`:

```typescript
import type { StepResult, VerifyStatus } from '@/core/recovery/apply-types'
import type { VerificationStatus } from './types'

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'verified',
  'not_verified',
  'indeterminate',
  'blocked',
] as const

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return typeof value === 'string' && VERIFICATION_STATUSES.includes(value as VerificationStatus)
}

export function isSkippedStep(status: StepResult['status']): boolean {
  return status.startsWith('skipped:')
}

export function stepResultToBlockedReason(result: StepResult | undefined): string | undefined {
  if (!result || !isSkippedStep(result.status)) return undefined
  return result.reason ?? result.status
}

export function recoveryVerifyToVerificationStatus(
  status: VerifyStatus,
  result?: StepResult
): VerificationStatus {
  if (status === 'passed') return 'verified'
  if (status === 'failed') return 'not_verified'
  if (result && isSkippedStep(result.status)) return 'blocked'
  return 'indeterminate'
}
```

- [ ] **Step 5: Add barrel export**

Create `src/core/verification/index.ts`:

```typescript
export * from './types'
export * from './status'
```

- [ ] **Step 6: Export from public core barrel**

Modify `src/core/index.ts` by adding this near the other phase exports:

```typescript
// Verification contract
export * from './verification'
```

- [ ] **Step 7: Verify focused tests**

Run:

```bash
bun test tests/unit/core/verification/status.test.ts tests/unit/core/verification/types-contract.test.ts
```

Expected: PASS.

- [ ] **Step 8: Verify public export compiles**

Run:

```bash
bun run tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/verification src/core/index.ts tests/unit/core/verification
git commit -m "Expose the shared verification contract in core" \
  -m "Constraint: Status mapping must preserve recovery verifyStatus compatibility while introducing verified/not_verified/indeterminate/blocked for new artifacts." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: bun test tests/unit/core/verification/status.test.ts tests/unit/core/verification/types-contract.test.ts; bun run tsc --noEmit --pretty false"
```

## Task 3: Bridge Recovery Verification To The Contract

**Purpose:** Let existing recovery verification produce the new contract status internally without breaking existing outputs.

**Files:**

- Modify: `src/core/recovery/apply-verify.ts`
- Modify: `src/core/recovery/apply-types.ts`
- Modify: `tests/unit/core/recovery/apply-verify.test.ts`

- [ ] **Step 1: Write failing recovery bridge tests**

Append these tests to `tests/unit/core/recovery/apply-verify.test.ts`:

```typescript
describe('runVerifyStep — verification contract bridge', () => {
  test('skipped verifier exposes contractStatus blocked while preserving legacy status', async () => {
    const step: GuideStep = { ...validVerifyStep, command: 'dbcli schema <table> --format json' }
    const r = await runVerifyStep(step, {
      code: 'SCHEMA_CACHE_MISSING',
      cwd: '/tmp',
      env: process.env,
    })

    expect(r.status).toBe('indeterminate')
    expect(r.contractStatus).toBe('blocked')
    expect(r.blockedReason).toBeTruthy()
  })

  test('passed verifier exposes contractStatus verified', async () => {
    __setVerifyExecutorForTests(async () => ({
      exitCode: 0,
      stdout: '{}',
      stderr: '',
      durationMs: 5,
      truncated: false,
      timedOut: false,
    }))

    const r = await runVerifyStep(validVerifyStep, {
      code: 'BLACKLIST_TABLE',
      cwd: '/tmp',
      env: process.env,
    })

    expect(r.status).toBe('passed')
    expect(r.contractStatus).toBe('verified')
  })
})
```

Run:

```bash
bun test tests/unit/core/recovery/apply-verify.test.ts
```

Expected: FAIL because `contractStatus` and `blockedReason` do not exist yet.

- [ ] **Step 2: Add compatibility fields**

Modify `src/core/recovery/apply-types.ts`:

```typescript
import type { VerificationStatus } from '@/core/verification'
```

Then add optional fields to `ApplyResult` without changing existing fields:

```typescript
  /** Contract-compatible verification status. Present iff verify ran. */
  verificationStatus?: VerificationStatus
  /** Present when verificationStatus === 'blocked'. */
  verificationBlockedReason?: string
```

Do not remove:

```typescript
  verifyStatus?: VerifyStatus
```

- [ ] **Step 3: Add bridge fields to `VerifyOutcome`**

Modify `src/core/recovery/apply-verify.ts` imports:

```typescript
import {
  recoveryVerifyToVerificationStatus,
  stepResultToBlockedReason,
  type VerificationStatus,
} from '@/core/verification'
```

Change `VerifyOutcome`:

```typescript
export interface VerifyOutcome {
  result: StepResult
  status: VerifyStatus
  contractStatus: VerificationStatus
  blockedReason?: string
}
```

In the gate-skip branch, return:

```typescript
const result: StepResult = {
  order: VERIFY_ORDER_SENTINEL,
  command: step.command,
  status: decision.kind,
  reason: decision.reason,
}
return {
  result,
  status: 'indeterminate',
  contractStatus: recoveryVerifyToVerificationStatus('indeterminate', result),
  blockedReason: stepResultToBlockedReason(result),
}
```

At the end of the executed branch, return:

```typescript
const status = evaluateVerify(ctx.code, outcome)
return {
  result,
  status,
  contractStatus: recoveryVerifyToVerificationStatus(status, result),
  blockedReason: stepResultToBlockedReason(result),
}
```

- [ ] **Step 4: Attach bridge fields in apply result**

Modify `src/core/recovery/apply.ts` where `runVerifyStep` result is handled. Preserve existing `verifyStatus` and add:

```typescript
verificationStatus = v.contractStatus
verificationBlockedReason = v.blockedReason
```

Then include them in the returned object only when present:

```typescript
...(verificationStatus ? { verificationStatus } : {}),
...(verificationBlockedReason ? { verificationBlockedReason } : {}),
```

Add local variables near the existing `verifyStatus` variable:

```typescript
let verificationStatus: VerificationStatus | undefined
let verificationBlockedReason: string | undefined
```

- [ ] **Step 5: Verify recovery focused tests**

Run:

```bash
bun test tests/unit/core/recovery/apply-verify.test.ts tests/unit/core/recovery/apply.test.ts tests/unit/core/recovery/render-json.test.ts tests/unit/core/recovery/render-markdown.test.ts
```

Expected: PASS. Existing assertions around `verifyStatus` must remain valid.

- [ ] **Step 6: Commit**

```bash
git add src/core/recovery/apply-types.ts src/core/recovery/apply-verify.ts src/core/recovery/apply.ts tests/unit/core/recovery/apply-verify.test.ts
git commit -m "Bridge recovery verification to the shared contract" \
  -m "Constraint: Existing recover --apply verifyStatus values remain stable; contractStatus is additive." \
  -m "Rejected: Replacing passed/failed with verified/not_verified in recovery output | would break existing consumers." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: bun test tests/unit/core/recovery/apply-verify.test.ts tests/unit/core/recovery/apply.test.ts tests/unit/core/recovery/render-json.test.ts tests/unit/core/recovery/render-markdown.test.ts"
```

## Task 4: Add Compact Skill Routing For Verification Outcomes

**Purpose:** Teach agents the new status language without turning `SKILL.md` into a playbook.

**Files:**

- Modify: `assets/SKILL.md`
- Modify: `assets/SKILL.zh-TW.md`
- Generated by sync only:
  - `plugins/dbcli-agent/skills/dbcli/SKILL.md`
  - `skills/dbcli/SKILL.md`
  - `.cursor/rules/dbcli.mdc`
  - `.github/skills/dbcli/SKILL.md`
  - `.windsurfrules`

- [ ] **Step 1: Update English skill prose**

In `assets/SKILL.md`, near the existing verification/recovery guidance, add:

```markdown
Verification outcome vocabulary: use `verified` only when required evidence matched;
use `not_verified` when the check ran and contradicted the expected state; use
`indeterminate` when the check ran but evidence was ambiguous; use `blocked` when
verification could not run because of config, permission, schema, placeholder, or
safety gates.
```

- [ ] **Step 2: Update Traditional Chinese skill prose**

In `assets/SKILL.zh-TW.md`, add the mirrored paragraph:

```markdown
驗證結果詞彙:只有在必要證據符合預期時才使用 `verified`;檢查已執行但結果違反預期時使用
`not_verified`;檢查已執行但證據不足或模糊時使用 `indeterminate`;因 config、權限、schema、
placeholder 或安全閘門導致驗證無法執行時使用 `blocked`。
```

- [ ] **Step 3: Check skill parity**

Run:

```bash
bun run scripts/check-skill-parity.ts
```

Expected: PASS.

- [ ] **Step 4: Sync generated copies**

Run:

```bash
bun run scripts/sync-plugin-assets.ts --write
bun run scripts/sync-plugin-assets.ts
```

Expected: all generated mappings report `ok` in the second command.

- [ ] **Step 5: Commit**

```bash
git add assets/SKILL.md assets/SKILL.zh-TW.md plugins/dbcli-agent/skills/dbcli/SKILL.md skills/dbcli/SKILL.md .cursor/rules/dbcli.mdc .github/skills/dbcli/SKILL.md .windsurfrules
git commit -m "Teach agents the verification outcome vocabulary" \
  -m "Constraint: Keep skill text compact and route detailed behavior to the verification contract spec." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: bun run scripts/check-skill-parity.ts; bun run scripts/sync-plugin-assets.ts"
```

## Task 5: Final Verification

**Purpose:** Prove the contract is stable and no existing recovery/task-pack behavior regressed.

- [ ] **Step 1: Run focused verification contract tests**

```bash
bun test tests/unit/core/verification/status.test.ts tests/unit/core/verification/types-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run recovery bridge tests**

```bash
bun test tests/unit/core/recovery/apply-verify.test.ts tests/unit/core/recovery/apply.test.ts tests/unit/core/recovery/render-json.test.ts tests/unit/core/recovery/render-markdown.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run task-pack regression tests**

```bash
bun test tests/unit/agent-tasks/pack-pr-database-review.test.ts tests/unit/agent-tasks/pack-migration-review.test.ts tests/unit/agent-tasks/pack-safe-backfill-verify.test.ts tests/unit/agent-tasks/pack-slow-endpoint-investigation.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run parity and docs checks**

```bash
bun run scripts/check-skill-parity.ts
bun run scripts/check-platform-parity.ts
bun run scripts/sync-plugin-assets.ts
bun run scripts/check-user-docs.ts
```

Expected:

- Skill parity passes.
- Platform parity passes.
- Plugin sync reports only `ok`.
- User docs parity passes.

- [ ] **Step 5: Run typecheck and full test suite**

```bash
bun run tsc --noEmit --pretty false
bun test
```

Expected:

- Typecheck exits 0.
- Full test suite exits 0.
- Elasticsearch/live database tests may skip when local services are unavailable; skip count is acceptable when exit code is 0.

## Acceptance Criteria

- `docs/specs/2026-06-18-verification-contract.md` defines statuses, artifact shape, storage path policy, compatibility mapping, and first workflow target.
- `src/core/verification/` exports `VerificationStatus`, `VerificationArtifact`, status guard helpers, and recovery mapping helpers.
- Recovery verification remains backward-compatible: `verifyStatus` still uses `passed|failed|indeterminate`.
- Recovery verification also exposes additive contract status internally or in apply results as `verificationStatus`.
- Gate-skipped recovery verifiers map to contract `blocked`.
- Executed inconclusive recovery verifiers map to contract `indeterminate`.
- No `dbcli verify` command is introduced.
- No `.dbcli/verification/*.json` artifact writer is introduced.
- Skill text includes only compact vocabulary guidance and generated copies are synced.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Breaking consumers of `recover --apply` JSON | Add fields only; do not rename or remove `verifyStatus`. |
| Status vocabulary drift between docs and code | Unit tests assert exact status literals and mapping helpers. |
| Treating blocked verification as ambiguous | Map `skipped:*` verifier results to `blocked`, not `indeterminate`, in the new contract layer. |
| Premature storage design | Document future `.dbcli/verification/` path but defer writing until Milestone 3. |
| Skill bloat | Add one compact paragraph only, then run parity/sync checks. |

## Follow-Up Milestone

After this lands, plan **Safe Backfill Verify MVP**:

- Use `safe-backfill-verify` as the first workflow.
- Generate or consume verification artifacts for read-back `assert` evidence.
- Decide whether task-pack-only execution is enough or whether a narrow `dbcli verify <scenario>` command is justified.
