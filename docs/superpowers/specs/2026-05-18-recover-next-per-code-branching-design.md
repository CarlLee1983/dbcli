# `recover --next` Per-Code Branching — Connection Category MVP

**Date:** 2026-05-18
**Status:** spec (awaiting plan)
**Targets:** future minor release on top of v1.20.1
**Baseline:** v1.17.0 P2 shipped `recover --next` as a stateless linear cursor walker. `nextStepFromEnvelope(envelope, afterStep, _prevResult)` already reserves the `prevResult` parameter for future per-code branching but ignores it. v1.17.0 plan decision #4 explicitly deferred the stepper interface until the first branching code arrived; this spec is that arrival.

## Goal

Turn `dbcli recover --next` from a linear cursor walker into a category-aware stepper whose `next-step` decision can depend on the prior step's output. Land the **connection** category as the first cut: 5 codes (`CONN_REFUSED` / `CONN_AUTH_FAILED` / `CONN_TIMEOUT` / `CONN_HOST_NOT_FOUND` / `CONN_UNKNOWN`) share a single stepper that branches on `dbcli doctor --format json` output, replacing the linear tail with one of four branch-specific plans.

This closes the gap noted in the v1.17.0 spec ("plan is static; can't branch on what step N returned") for the highest-leverage category.

## Non-goals

- **No new declarative DSL.** Branch decisions live in TypeScript code (option 2 of the design discussion: semi-transparent labeled branches, conditions in code). The DSL upgrade path is documented in §10 but not implemented.
- **No `--apply` changes.** `--apply` continues to walk `envelope.recovery` linearly and ignores `envelope.branches`. Branch-aware `--apply` is future work (§7.1).
- **No branching for the other 9 codes** (blacklist / snippet / schema-cache / config / unknown). They keep their current linear envelopes byte-for-byte.
- **No persisted next-cursor state.** `--next` stays stateless; agents pass `--branch <id>` on each call after the fork.
- **No multi-fork plans.** v1 supports exactly one fork point per code (after step 1). Nested or late forks are out of scope.

## Strategic context

Three properties shape the design:

1. **Backward compat is automatic.** All schema additions are optional. v1 envelope consumers and `--apply` walk `recovery` as before; they cannot tell branching exists.
2. **Branches are visible to agents.** The envelope ships `branches: Record<BranchId, BranchPlan>` and `branchFork: { after, branchIds }` so a branch-aware agent can read the available paths before calling `--next`. Conditions are still in code, but their **destinations** are declarative.
3. **Failure modes are fail-safe.** The resolver returns `null` on any parse failure, missing field, or unmatched keyword; `--next` then falls through to `recovery` exactly as today. Branching can degrade gracefully to v1 behavior; it cannot break it.

---

## 1. Architecture

### 1.1 Flow

```
agent                              dbcli
  │ run failing CONN_* command      │
  │ ──────────────────────────────▶│
  │                              ┌──┴─────┐
  │                              │classify│ ← 5 connection codes share
  │                              │   +    │   stepsForCode('CONN_*')
  │                              │branches│   → emit recovery + branches +
  │                              │ resolve│     branchFork
  │  envelope                    └──┬─────┘
  │ ◀──────────────────────────────│
  │                                 │
  │ run step 1 (doctor --format json)
  │                                 │
  │ --next --after-step 1           │
  │   --result <doctor json>        │
  │ ──────────────────────────────▶│
  │                              ┌──┴───────────────────┐
  │                              │matchConnectionBranch │
  │                              │ ─ doctor-*           │
  │                              └──┬───────────────────┘
  │  NextResult                     │
  │   .branchId='doctor-auth-error' │
  │   .step=branches[id].steps[0]   │
  │ ◀──────────────────────────────│
  │                                 │
  │ run step 2                      │
  │                                 │
  │ --next --after-step 2           │
  │   --branch doctor-auth-error    │  ← agent echoes branchId
  │   --result <init json>          │
  │ ──────────────────────────────▶│
  │  NextResult                     │
  │   .branchId='doctor-auth-error' │
  │   .step=branches[id].steps[1]   │
  │ ◀──────────────────────────────│
  │  ... walks to 'done'            │
```

The fork happens **once**, immediately after step 1 (doctor). After the fork, `--next` is fully linear inside the chosen branch.

### 1.2 Module layout

| File | Status | Role |
|---|---|---|
| `src/core/recovery/types.ts` | edit | Add `BranchId`, `BranchPlan`, `BranchFork`; extend `RecoveryEnvelope` |
| `src/core/guide/types.ts` | edit | Add optional `branchId?: string` to `GuideStep` |
| `src/core/recovery/next-types.ts` | edit | Add optional `branchId?: BranchId` to `NextResult` |
| `src/core/recovery/next-step.ts` | edit | Branch dispatch logic in `nextStepFromEnvelope` |
| `src/core/recovery/connection-branches.ts` | **new** | `matchConnectionBranch(prev)`, `CONNECTION_BRANCH_IDS`, branch plan factories |
| `src/core/recovery/recovery-steps.ts` | edit | `stepsForCode` for connection codes additionally emits `branches` + `branchFork` |
| `src/commands/recover.ts` | edit | `--branch <id>` flag; error mapping |
| `src/core/recovery/next-render-json.ts` / `next-render-markdown.ts` | edit | Surface `branchId` + `branches[id].description` in output |
| `src/core/recovery/envelope-schema.ts` / `next-step-schema.ts` | edit | Zod additions for new optional fields |

No file is renamed. No existing public type loses a field.

---

## 2. Schema additions

All additions are optional; `RecoveryEnvelope.schemaVersion` and `NextResult.schemaVersion` stay at `1`.

```ts
// src/core/recovery/types.ts

export type BranchId = string  // constrained by zod: /^[a-z0-9-]+$/, length ≤ 64

export interface BranchPlan {
  /** Human-readable summary; agents can show this to the user. */
  description: string
  /** Steps inside the branch. `order` is 1-based WITHIN the branch. */
  steps: GuideStep[]
}

export interface BranchFork {
  /** 1-based step order in `recovery` after which a fork may happen. v1: always 1. */
  after: number
  /** Enumeration of possible branchIds; equals Object.keys(branches). */
  branchIds: BranchId[]
}

export interface RecoveryEnvelope {
  // existing fields unchanged
  branches?: Record<BranchId, BranchPlan>
  branchFork?: BranchFork  // present iff `branches` is present
}
```

```ts
// src/core/guide/types.ts
export interface GuideStep {
  // existing fields unchanged
  /** Set only on steps inside `branches[id].steps`. Agents may ignore. */
  branchId?: string
}
```

```ts
// src/core/recovery/next-types.ts
export interface NextResult {
  // existing fields unchanged
  /** Set iff agent is currently traversing a branch (fork has occurred). */
  branchId?: BranchId
  // When branchId is set, `cursor` and `totalSteps` refer to the branch's plan;
  // when absent, they refer to envelope.recovery as today.
}
```

### 2.1 Caps

| Constant | Value | Where |
|---|---|---|
| `MAX_RECOVERY_STEPS` | 6 (existing) | Cap on `recovery.length` |
| `MAX_BRANCH_STEPS` | 6 (new) | Cap on each `branches[id].steps.length` |
| `MAX_BRANCH_COUNT` | 8 (new) | Cap on `Object.keys(branches).length` |
| `BranchId` regex | `/^[a-z0-9-]+$/` length ≤ 64 | zod schema |

---

## 3. Resolver — `matchConnectionBranch`

```ts
// src/core/recovery/connection-branches.ts

export const CONNECTION_BRANCH_IDS = [
  'doctor-clean',
  'doctor-config-missing',
  'doctor-auth-error',
  'doctor-network-error',
] as const
export type ConnectionBranchId = (typeof CONNECTION_BRANCH_IDS)[number]

const AUTH_KEYWORDS = [
  'auth', 'password', 'credentials', 'credential', 'permission denied', 'login',
] as const
const NETWORK_KEYWORDS = [
  'host', 'port', 'refused', 'timeout', 'unreachable', 'enotfound',
  'econnrefused', 'etimedout', 'eai_again', 'dns',
] as const

interface DoctorJson {
  results: { group: string; label: string; status: 'pass' | 'warn' | 'error'; message: string }[]
  hasError: boolean
}

/**
 * Pure deterministic resolver. Given stdout of `dbcli doctor --format json`,
 * pick one branchId or return null (fall back to recovery).
 *
 * Trigger order is fixed (must not change without a schemaVersion bump):
 *   1. doctor-clean           (no errors at all)
 *   2. doctor-config-missing  (config-shape check failed)
 *   3. doctor-auth-error      (Connection failed + auth keyword)
 *   4. doctor-network-error   (Connection failed + network keyword)
 * Any parse failure → null → safe fallback.
 */
export function matchConnectionBranch(
  prev: StepResultSummary
): ConnectionBranchId | null { /* implementation per §3.1 */ }
```

### 3.1 Trigger order (locked)

1. `doctor-clean` — `results.every(r => r.status !== 'error')`
2. `doctor-config-missing` — any error whose `label ∈ { 'Config exists', 'Default connection', 'V2 config validation', 'Config valid' }`
3. `doctor-auth-error` — any `label === 'Connection'` error whose lowercase `message` contains any `AUTH_KEYWORDS`
4. `doctor-network-error` — any `label === 'Connection'` error whose lowercase `message` contains any `NETWORK_KEYWORDS`
5. otherwise — `null` (fallback to `recovery`)

Over-trigger is preferred to under-trigger: `'authority'` matches `'auth'` deliberately, because a false `doctor-auth-error` plan still safely lands the user at `dbcli init --force` rather than guessing.

### 3.2 Keyword lists

The lists above are the v1 contract. Adding a keyword is **additive** (no schema bump); removing one is a **behavior change** (release-notes entry required). The contract test in §11.4 prevents silent drift between doctor messages and these lists.

---

## 4. Branch plans

Each connection code emits the **same** `branches` map and `branchFork`. The difference between codes is purely in `error.message`; the recovery surface is unified.

### 4.1 `recovery` (inconclusive fallback)

Step 1 is shared with all branches as "the question whose answer drives the fork":

```ts
recovery: [
  { order: 1, command: 'dbcli doctor --format json',
    rationale: 'Run the doctor health check to identify config / network / driver issues.',
    risk: 'readonly',
    expects: 'JSON {results, hasError}.' },
  { order: 2, command: 'dbcli inspect --no-connect --format json',
    rationale: 'Compare expected vs actual host/port without a live probe.',
    risk: 'readonly',
    expects: 'JSON snapshot with connection.name/database.' },
  // optional step 3 when ctx.connectionName (v2 multi-connection):
  { order: 3, command: `dbcli use ${shellQuote(ctx.connectionName)}`,
    rationale: 'Re-select the failing named connection.',
    risk: 'write', dbWrite: false,
    expects: 'Confirmation the active connection switched.' },
]
```

### 4.2 `branches['doctor-clean']`

```ts
{
  description:
    'Doctor reports no errors. Likely a transient failure — verify baseline state, then retry the original command.',
  steps: [
    { order: 1, branchId: 'doctor-clean',
      command: 'dbcli inspect --for-agent',
      rationale:
        'Re-anchor in the current context and confirm schemaCache.available; if stale, schema --refresh before retry.',
      risk: 'readonly',
      expects: 'JSON snapshot; check connection.online=true, schemaCache.available.' },
  ],
}
```

Single-step branch. "Retry the original command" is **agent responsibility** (dbcli cannot reconstruct it); `description` carries that instruction.

### 4.3 `branches['doctor-config-missing']`

```ts
{
  description:
    'Doctor flagged a config-level failure. Rebuild config before reattempting connection.',
  steps: [
    { order: 1, branchId: 'doctor-config-missing',
      command: 'dbcli init',
      rationale: 'No usable config; run init to create it.',
      risk: 'write', interactive: true,
      expects: 'Init wizard prompts; new .dbcli written.' },
    { order: 2, branchId: 'doctor-config-missing',
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Verify config shape after init.',
      risk: 'readonly',
      expects: 'JSON snapshot with system/permission/blacklist sections populated.' },
  ],
}
```

### 4.4 `branches['doctor-auth-error']`

```ts
{
  description:
    'Doctor confirms credentials were rejected. Re-init with --force to overwrite the credential fields.',
  steps: [
    { order: 1, branchId: 'doctor-auth-error',
      command: 'dbcli init --force',
      rationale: 'Re-run init focused on credentials; --force overwrites the existing config in place.',
      risk: 'write', interactive: true,
      expects: 'Init wizard accepts new user/password; config rewritten.' },
    { order: 2, branchId: 'doctor-auth-error',
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Confirm config now resolves credentials.',
      risk: 'readonly',
      expects: 'JSON snapshot reflecting updated credentials.' },
  ],
}
```

### 4.5 `branches['doctor-network-error']`

```ts
{
  description:
    'Doctor confirms a network-level failure (host / port / DNS / timeout). Inspect expected vs actual addressing, optionally re-select named connection, then re-init host/port.',
  steps: [
    { order: 1, branchId: 'doctor-network-error',
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Compare expected vs actual host/port without a live probe.',
      risk: 'readonly',
      expects: 'JSON snapshot with connection.name/host/port.' },
    // conditionally appended when ctx.connectionName (v2):
    { order: 2, branchId: 'doctor-network-error',
      command: `dbcli use ${shellQuote(ctx.connectionName)}`,
      rationale: 'Re-select the failing named connection so subsequent commands target it explicitly.',
      risk: 'write', dbWrite: false,
      expects: 'Active connection switched.' },
    { order: 3, branchId: 'doctor-network-error',
      command: 'dbcli init --force',
      rationale: 'If addressing is wrong, rewrite host/port via init.',
      risk: 'write', interactive: true,
      expects: 'Init wizard accepts new host/port; config rewritten.' },
  ],
}
```

When `ctx.connectionName` is absent (v1 single connection), the `use` step is omitted and `init --force` becomes step 2. Steps within a branch are always renumbered 1-based after omission.

### 4.6 `branchFork`

```ts
branchFork: {
  after: 1,
  branchIds: ['doctor-clean', 'doctor-config-missing', 'doctor-auth-error', 'doctor-network-error'],
}
```

---

## 5. CLI surface

### 5.1 `dbcli recover --next` flags

| Flag | Required | Behavior |
|---|---|---|
| `--next` | yes | Enables stateless next-step lookup (existing) |
| `--after-step <N>` | yes | 1-based step ordinal in the current plan (recovery or branch) |
| `--result <json\|@file>` | yes | `StepResultSummary` JSON; `@path` reads file (64 KB cap) |
| `--branch <id>` | **new — required after fork** | Names the branch being traversed; omit = walking `recovery` |
| `--from <path>` | optional | Read envelope from file (existing) |
| `--format <json\|markdown>` | optional | Default `json` (existing) |

### 5.2 Dispatch logic in `nextStepFromEnvelope`

```
--next entry
  parse --result → StepResultSummary
  parse --after-step N
  load envelope (auto from .dbcli/last-recovery.json or --from)

  IF --branch given:
    IF envelope.branches?[id] missing → throw RangeError → exit 2
    IF N > branches[id].steps.length → throw RangeError → exit 2
    IF N === branches[id].steps.length → NextResult { kind:'done', branchId:id, cursor:N, totalSteps:N }
    ELSE → NextResult { kind:'step', branchId:id, cursor:N+1,
                        totalSteps:branches[id].steps.length,
                        step:branches[id].steps[N] }
  ELSE:
    IF N > recovery.length → throw RangeError → exit 2
    IF envelope.branchFork?.after === N:
      branchId = resolverFor(envelope.error.code)(prevResult)
      IF branchId !== null AND envelope.branches?.[branchId]?.steps.length >= 1:
        NextResult { kind:'step', branchId, cursor:1,
                     totalSteps:branches[branchId].steps.length,
                     step:branches[branchId].steps[0] }
        return
      // fall through to recovery walk
    IF N === recovery.length → NextResult { kind:'done', cursor:N, totalSteps:N }
    ELSE → NextResult { kind:'step', cursor:N+1, totalSteps:recovery.length,
                        step:recovery[N] }
```

### 5.3 Resolver registry

Only one entry in v1:

```ts
// src/core/recovery/next-step.ts (internal)
function resolverFor(code: RecoveryCode): ((prev: StepResultSummary) => string | null) | null {
  switch (code) {
    case 'CONN_REFUSED':
    case 'CONN_AUTH_FAILED':
    case 'CONN_TIMEOUT':
    case 'CONN_HOST_NOT_FOUND':
    case 'CONN_UNKNOWN':
      return matchConnectionBranch
    default:
      return null
  }
}
```

Adding a category in the future = adding a case here + writing the resolver. No structural change needed.

### 5.4 Exit codes (extends existing table)

| Exit | Condition |
|---|---|
| 0 | Returned a step or `done` (including successful fork) |
| 2 | envelope missing/malformed; `--result` missing/malformed; `--after-step` out-of-range; `--next` combined with `--apply`; **new:** `--branch` provided without envelope.branches; unknown branchId; `--after-step` out of branch range |

No `1` or `3` for `--next` (no execution).

### 5.5 Markdown rendering

When `branchId` is set, the renderer adds under the step header:

```markdown
**Branch:** `doctor-auth-error`
**Branch description:** Doctor confirms credentials were rejected. Re-init with `--force` to overwrite the credential fields.
```

JSON output adds top-level `branchId` and `branchDescription` (derived from `branches[id].description`).

---

## 6. Edge cases & error handling

### 6.1 Edge case matrix

| Scenario | Behavior |
|---|---|
| Envelope without `branches`, no `--branch` | Walks `recovery` linearly = v1 behavior |
| Envelope without `branches`, `--branch` given | exit 2: `Branch '<id>' requested but envelope has no branches.` |
| Envelope with `branches`, no `--branch`, `--after-step === branchFork.after` | Attempts fork; on no match falls through to `recovery` |
| `--branch <unknown>` | exit 2 listing valid ids |
| `--after-step 1` with empty `prevResult.stdoutSummary` | Resolver returns null → fallback to `recovery` |
| `--after-step 1` with doctor JSON truncated to 4 KB | `JSON.parse` fails → null → fallback (recommend `--result @path`) |
| `--branch doctor-network-error --after-step 2` on v1 connection (no `use` step) | branches.steps[1] is `init --force`; cursor matches actual step count |
| Branch walked to end, envelope has `verify` step | NextResult.kind=`done`; verify is run only by `--apply`, not `--next` (current behavior unchanged) |
| Concurrent `--apply` and `--next` | exit 2 (existing mutex) |
| `--branch <id>` with `branches[id].steps.length === 0` | Factory enforces ≥1 at envelope generation; if a malformed external envelope is loaded via `--from`, the dispatcher's `steps.length >= 1` guard (§5.2) falls through to `recovery`, never crashes |

### 6.2 Fail-safe principle

Branching logic **never causes `--next` to exit non-zero**. Any resolver path that fails (JSON parse error, unexpected shape, missing field, no keyword match) returns `null` and falls back to `recovery`. Exit 2 is reserved for agent-side CLI argument errors (`--branch` misuse), never for resolver internals.

### 6.3 Verbose trace

In `-v` mode, the resolver emits one stderr line per `--next` invocation that hits the fork point:

```
(verbose) connection-branches: matched 'doctor-auth-error' from doctor JSON
(verbose) connection-branches: no match; falling back to recovery
(verbose) connection-branches: doctor JSON parse failed (...); falling back to recovery
```

Not emitted at default verbosity. Useful for debugging and for the resolver/doctor contract test.

---

## 7. Interactions with adjacent surfaces

### 7.1 `--apply`

**No change.** `--apply` walks `envelope.recovery` linearly, ignoring `envelope.branches` entirely. Spec commits to this explicitly:

> Branch-aware `--apply` is **out of scope for v1 branching**. A future `--apply --follow-branches` flag (or equivalent) may be added after the `--next` contract is validated in production.

Rationale: branches' high-risk steps (`init [--force]`, `dbcli use`) would mostly be skipped by `--apply`'s gates anyway, so branch-aware `--apply` is low-value until the `--next` contract is proven. Also, `--apply` currently breaks the loop on the first non-zero exit (`src/core/recovery/apply.ts:68-72`); branching requires "failure is a signal, not a stop" which is its own refactor.

### 7.2 `verify` step

`envelope.verify` is code-level (set by `classifyError` based on `error.code`), not branch-level. `--apply` runs it after a successful recovery walk (existing behavior). Branches do not introduce branch-specific verify steps in v1.

### 7.3 `.dbcli/last-recovery.json` auto-save

The atomic-write wrapper persists the full envelope including `branches` and `branchFork`. Older dbcli versions reading this file silently ignore the new optional fields (forward-compat by additive design).

### 7.4 Audit logging

`--next` does **not** write audit entries (current behavior). Branch resolution does not change this. Rationale:

- `--next` is a pure stateless lookup; an audit entry per `--next` would violate the design
- Branch decisions are deterministic + replayable; an agent that needs an audit trail can log `prevResult` + `NextResult` itself
- envelope generation (by `query` / `q` / etc. with `--recovery`) already writes audit entries that inline the whole envelope, so `branches` are captured at that point

`--apply` audit behavior is unchanged.

---

## 8. Security analysis

| Attack surface | Risk | Mitigation |
|---|---|---|
| **branchId injection** (e.g. `--branch '$(rm -rf /)'`) | Shell injection | branchId is only used as object key lookup and rendered output, never spliced into shell. zod regex `^[a-z0-9-]+$`, length ≤ 64. |
| **Malicious doctor JSON triggering wrong branch** | Misdirection | Doctor JSON is data, not code. Keyword match is a `String#includes` over lowercase. Worst case: agent receives a plan for a different branch — all plans are dbcli-generated safe steps. No RCE path. |
| **Agent-forged `prevResult`** | Self-misdirection | Already permitted by v1 `--next` (the contract has always been "agent supplies prevResult"). NextResult is **advisory**, not binding. |
| **Concurrent envelope writes to `.dbcli/last-recovery.json`** | Last-writer-wins | Existing atomic rename. Branches are part of the same JSON write; no new race. |

**Conclusion:** branching introduces no new attack surface. Doctor output is a trusted same-host source (dbcli runs it itself); agent-forged `prevResult` was always self-harming at the v1 trust level.

---

## 9. Backward compatibility

| Concern | Mitigation |
|---|---|
| v1 envelope consumers | Cannot see `branches`/`branchFork`; walk `recovery` exactly as today |
| `--apply` v1 callers | Unchanged; still walks `recovery` linearly |
| `--next` v1 callers (no `--branch`) | Walk `recovery` linearly; only difference is that on connection codes the fork point may divert them — but the diverted plan is also recovery-like (each branch ends in dbcli's own safe commands), so behavior is at worst "you got a more specific plan than before" |
| `RecoveryEnvelope.schemaVersion` | Stays `1` (all additions optional) |
| `NextResult.schemaVersion` | Stays `1` (all additions optional) |
| Existing 9 non-connection codes | Emit `recovery` only; no `branches` / `branchFork`; envelopes byte-for-byte identical to today |

A v1.0 agent reading a v1.21-generated envelope: works (ignores new fields). A v1.21 agent reading a v1.0 envelope: works (no branches → linear walk).

---

## 10. Upgrade path to declarative DSL (option 3)

**Commitment:** the spec preserves the ability to migrate branch conditions from TS code into envelope JSON without bumping `schemaVersion`. This is the principal reason the user chose option 2 over option 1 in the design discussion.

Future `BranchPlan` augmentation (illustrative, not in v1 scope):

```ts
export interface BranchPlan {
  description: string
  steps: GuideStep[]
  /** v2+: declarative trigger. If absent, resolver falls back to code dispatch. */
  when?: BranchPredicate
}

export type BranchPredicate =
  | { kind: 'doctor-results'
      requireError: { label: string; messageContainsAny?: string[] }[]
      requireNoErrors?: boolean }
  | { kind: 'and'; all: BranchPredicate[] }
  | { kind: 'or'; any: BranchPredicate[] }
  | { kind: 'not'; not: BranchPredicate }
```

Resolver becomes:

```
for [id, plan] in envelope.branches:
  if plan.when AND evaluate(plan.when, prevResult): return id
return codeDispatch(envelope.error.code, prevResult)  // v1 fallback
```

**Trigger to begin DSL work:** the second category lands (e.g. `snippet`), and its resolver shares 80%+ of its dispatch shape with `connection`. Until then, code-dispatch is simpler.

---

## 11. Testing strategy

Six layers, each with a distinct guarantee.

### 11.1 Resolver pure-function unit tests
`tests/unit/core/recovery/connection-branches.test.ts` — ~25-30 cases:
- happy path × 4 branches (typical + edge keyword)
- trigger order (config-missing wins over auth)
- fallback paths (empty stdout, non-JSON, malformed shape, no keyword match)
- keyword boundaries (case-insensitive, substring match, `'authority'` triggers `'auth'`)
- truncation handling
- determinism (100 invocations same result)

### 11.2 `nextStepFromEnvelope` branch-aware unit tests
`tests/unit/core/recovery/next-step.test.ts` (extends existing) — ~15-20 cases:
- fork at `branchFork.after` for each branchId
- no fork (no branches → existing linear path, regression)
- continue inside branch
- done inside branch
- `--branch` with no branches → RangeError
- unknown branchId → RangeError
- `--after-step` over branch range → RangeError
- synthetic `branchFork.after = 2` envelope still forks correctly
- resolver returns null → fall-through to recovery

### 11.3 Schema tests
`tests/unit/core/recovery/envelope-schema.test.ts` + `next-step-schema.test.ts` — ~10-12 cases:
- `branches` is optional
- `branchFork.branchIds` must be a subset of `Object.keys(branches)`
- branchId regex enforcement
- step's `branchId` matches enclosing key (internal consistency)
- `schemaVersion` stays `1`

### 11.4 Contract test (release gate)
`tests/contract/doctor-resolver-coupling.test.ts` — ~10 cases:
- For each engine (postgres / mysql / mongodb / redis / elasticsearch) × each error class (auth / network), invoke the doctor connection check with a synthetic failing connector and assert the produced message hits the correct keyword set.
- **Failure blocks release.** Documented in §13.

### 11.5 End-to-end CLI integration tests
`tests/integration/recover-next-branching.test.ts` — ~8-10 cases:
- `--next --after-step 1 --result @fixture-doctor-*.json` returns expected branchId
- post-fork `--next --after-step 2 --branch <id> --result @ok.json` returns step 2
- `--branch <unknown>` exits 2 with valid-id list
- `--branch` on non-connection envelope exits 2
- `--apply` on connection envelope behaves identically to v1 (no branch use)
- `--format markdown` includes `**Branch:**`

### 11.6 Snapshot tests for envelope generation
`tests/snapshots/connection-envelopes/*.snap.json` — 6 snapshots:
- `conn-refused-v1.snap.json` (v1 connection, no name)
- `conn-refused-v2-named.snap.json`
- `conn-auth-failed.snap.json`
- `conn-timeout.snap.json`
- `conn-host-not-found.snap.json`
- `conn-unknown.snap.json`

Each snapshot covers `recovery`, `branches` (full 4-branch map), `branchFork`. Snapshot updates require `bun test --update-snapshots`; reviewers see envelope deltas explicitly.

### 11.7 Coverage targets
- `src/core/recovery/connection-branches.ts` ≥ 95% (pure functions)
- `src/core/recovery/next-step.ts` ≥ 90% after edits
- Recovery module overall ≥ 80% (existing baseline)

### 11.8 Effort estimate

| Layer | Cases | Effort |
|---|---|---|
| 1 Resolver | 25-30 | 0.5d |
| 2 next-step | 15-20 | 0.3d |
| 3 Schema | 10-12 | 0.2d |
| 4 Contract | ~10 | 0.5d |
| 5 E2E | 8-10 | 0.5d |
| 6 Snapshot | 6 | 0.2d |
| **Subtotal** | **~75** | **~2.2d** |
| Implementation | — | ~1.5d |
| **Total (excl. PR review)** | | **~3.7d** |

---

## 12. Decisions pinned (no re-litigation in plan phase)

Settled during the brainstorming discussion:

1. **First category:** connection only (5 codes share a stepper).
2. **Branch count:** 4 (`doctor-clean` / `doctor-config-missing` / `doctor-auth-error` / `doctor-network-error`) + inconclusive fallback via `recovery`.
3. **Decision input:** doctor's `--format json` stdout; label exact match + message keyword set; no regex or JSONPath DSL.
4. **Branch semantics:** override (once a branch is chosen, it replaces the tail of the plan).
5. **`--apply`:** stays linear in v1.
6. **State encoding:** stateless; agent passes `--branch <id>` after fork.
7. **Branch step ordering:** 1-based within branch.
8. **`BranchFork.after`:** explicit field (not implicit "always 1") so envelope is self-describing.
9. **Audit:** `--next` does not write audit entries.
10. **Doctor/resolver coupling:** CI contract test only, no runtime warning.
11. **Declarative DSL:** documented as future upgrade path (§10), not implemented in v1.

---

## 13. Release gate

Cannot ship without:

1. All 6 test layers green
2. Contract test (§11.4) green — explicit gate, **release blocker**
3. Snapshot review by maintainer (no accidental envelope churn for non-connection codes)
4. `docs/user/en/index.{md,html}` and `docs/user/zh-TW/index.{md,html}` updated for the new `--branch` flag and branching behavior (per AGENTS.md Documentation Mandate)
5. `assets/SKILL.md` and `assets/reference.md` updated to describe `--branch` and `branchId` in NextResult

---

## 14. Out of scope (deferred to later milestones)

- Branch-aware `--apply` (`--follow-branches` or equivalent)
- Branching for the 9 non-connection codes (blacklist, snippet, schema-cache, config, unknown)
- Declarative `when:` predicates in `BranchPlan`
- Nested branches (branch within a branch)
- Multi-fork plans (more than one `branchFork.after` point)
- Persistent next-cursor state file
- Telemetry on branch hit rates
