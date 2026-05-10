# Recovery v2 — Guided Remediation Design (v1.17.0)

**Date:** 2026-05-10
**Milestone:** v1.17.0
**Status:** implemented (P2, P3, P4)
**Baseline:** v1.16.0 shipped (`--recovery` covers query / q / insert / update / delete / export / schema / inspect; `writeOperation` adds dry-run step branches; 14 recovery codes; 6-step cap).

## Goal

Move recovery from a **fire-and-forget envelope** to a **guided remediation workflow** where dbcli can execute its own recovery plan under explicit risk gates, mark which steps were skipped and why, and (next stage) verify that the original failure has actually been resolved.

The arc closes the loop between “dbcli told the agent what to try” (v1.15 / v1.16) and “dbcli ran what was safe and reported back” (v1.17).

## Strategic context

Three pain points from the v1.16 retro shape this milestone:

| Pain | Stage |
|------|-------|
| Agent has to shell out every recovery step itself; no risk gate | **P3 — `dbcli recover --apply`** |
| No way to verify "did the fix actually work?" after a plan runs | **P4 — verification step** |
| Plan is static; can't branch on what step N returned | **P2 — multi-turn `--next`** |

This spec covers all three but only **P3 is implementation-ready**. P4 and P2 are sketched for context (decisions that affect P3 schema are pinned; the rest is left to follow-on specs).

Order of delivery: **P3 → P4 → P2.** P4 leans on P3 (verification is the last entry of the plan that `--apply` runs). P2 leans on both (multi-turn protocol is `--apply` advanced one step at a time with a result payload).

---

## P3 — `dbcli recover --apply`

### Intent

Let dbcli execute the recovery plan it just emitted, instead of forcing the agent to shell out each step. Default behaviour is **safe-by-default**: only `risk=readonly` and `risk=dry-run` steps run; everything else is skipped with a structured reason.

Naming note: the existing `dbcli recovery` command remains the **lookup / synthesize** surface (`--code`, `--list`). The new `dbcli recover` command is the **saved-plan inspection / apply** surface. They intentionally coexist so existing `dbcli recovery` consumers do not change.

### Command surface

```bash
# Read the last failure's envelope (auto-saved on `--recovery` failures)
dbcli recover --apply
dbcli recover --apply --format markdown

# Read an envelope explicitly (overrides auto-saved file)
dbcli recover --apply --from .dbcli/last-recovery.json
dbcli recover --apply --from /tmp/envelope.json

# Open the gate one tier (run write steps that do NOT touch the database)
dbcli recover --apply --allow-write=readonly-cmd

# Open the gate fully (run write steps that DO touch the database)
dbcli recover --apply --allow-write=write-cmd
```

`--allow-write=readonly-cmd` and `--allow-write=write-cmd` are **mutually exclusive**. Passing the latter implies the former.

### Plan source resolution

1. If `--from <path>` is provided → read that file. Mandatory; must be either:
   - a raw `RecoveryEnvelope` JSON object, or
   - a `SavedRecoveryEnvelope` wrapper containing `{ savedAt, command, cwd, envelope }`.
2. Else → read `.dbcli/last-recovery.json` (workspace-relative). This file is always a `SavedRecoveryEnvelope` wrapper.
3. If neither exists → exit 2 with stderr message:
   `No recovery plan available. Run a command with --recovery to generate one, or pass --from <file>.`

The normalized apply input is:

```ts
export interface SavedRecoveryEnvelope {
  schemaVersion: 1
  savedAt: string
  /** Sanitized command summary, not a verbatim argv dump. */
  command: string
  /** Workspace cwd at failure time. */
  cwd: string
  envelope: RecoveryEnvelope
}
```

When a raw `RecoveryEnvelope` is supplied via `--from`, source metadata is synthesized from the current process: `cwd = process.cwd()` and `command = "external --from <path>"`.

#### Auto-write of `.dbcli/last-recovery.json`

Whenever any command emits a `RecoveryEnvelope` (i.e. fails with `--recovery` enabled or as the default behaviour wherever `--recovery` is implicit), dbcli atomically writes the envelope to `.dbcli/last-recovery.json`:

- Write to `.dbcli/last-recovery.json.tmp`, then `rename(2)` over `.dbcli/last-recovery.json` (atomic on POSIX).
- File contents = the full envelope plus a small wrapper:

  ```json
  {
    "schemaVersion": 1,
    "savedAt": "2026-05-10T11:23:45.000Z",
    "command": "dbcli q @missing --recovery",
    "cwd": "/Users/carl/Dev/example",
    "envelope": { /* RecoveryEnvelope verbatim */ }
  }
  ```

- `command` is a sanitized summary, not a raw shell string. Do not persist SQL text, `--param` values, passwords, URLs with credentials, or token-like values. If redaction is required, replace the value with `<redacted>`.
- Concurrency: last writer wins. Agents that need determinism under parallelism should capture envelope output and pass `--from`.
- The file is **gitignored** (already covered by `.dbcli/` rule, but verify in plan).

### Risk gating

Each step is classified into exactly one execution outcome:

| Step trait | Default | `--allow-write=readonly-cmd` | `--allow-write=write-cmd` |
|---|---|---|---|
| `risk=readonly` | run | run | run |
| `risk=dry-run` | run | run | run |
| `risk=write`, `dbWrite=false` (or absent) | `skipped:risk` | run | run |
| `risk=write`, `dbWrite=true` | `skipped:risk` | `skipped:risk` | run |
| `interactive=true` (any risk) | `skipped:interactive` | `skipped:interactive` | `skipped:interactive` |
| unresolved placeholder in `command` | `skipped:placeholder` | `skipped:placeholder` | `skipped:placeholder` |
| command fails validation / allowlist | `skipped:unsafe-command` | `skipped:unsafe-command` | `skipped:unsafe-command` |

Outcome precedence:

1. `interactive` always wins over `risk` (interactive prompts can't be auto-driven by `--apply` regardless of permission tier).
2. Unresolved placeholders win over `risk`; a step with `<table>`, `<hint>`, `<snippet>`, `<name>`, `<value>`, or any declared unresolved placeholder is not executable.
3. Command validation / allowlist failure wins over `risk`; `--apply` does not execute arbitrary shell from an envelope, even if the envelope labels it `readonly`.
4. Remaining steps are gated by `risk` + `dbWrite`.

The trust boundary is important: `--from` can point at user-provided JSON, so `risk`, `interactive`, and `dbWrite` are **hints**, not sufficient authorization. Before execution, dbcli must validate that a step command matches the deterministic dbcli command grammar it knows how to run for the envelope's `error.code`.

### Schema impact

Three new optional fields on `GuideStep` (`src/core/guide/types.ts`). All are additive — no schemaVersion bump required for `GuideSnapshot` or `RecoveryEnvelope`.

```ts
export interface GuideStep {
  // ...existing fields
  /** Step requires interactive TTY (e.g. `dbcli init`). `--apply` skips these. */
  interactive?: boolean
  /** True when the step mutates the connected database. Gates `--apply --allow-write`. */
  dbWrite?: boolean
  /** Placeholder tokens that must be resolved before `--apply` can execute this step. */
  placeholders?: string[]
}
```

Population rules (in `src/core/recovery/recovery-steps.ts`):

- `interactive: true` → currently only `dbcli init` and `dbcli init --force`.
- `dbWrite: true` → no current recovery step sets this. Reserved for future write-side recovery (e.g. retry failed insert with adjusted columns).
- All existing `risk: 'write'` steps (`blacklist remove`, `init --force`, etc.) are **local-side** writes → `dbWrite` stays `false`.
- `placeholders` → set when a command still contains agent-fillable tokens such as `<table>`, `<hint>`, `<snippet>`, `<name>`, or `<value>`. `--apply` skips these steps with `skipped:placeholder`.

### Execution semantics

- Each executable step runs as a **child process** of dbcli, not in-process. This isolates side effects, lets us cap stdout/stderr, and matches what the agent would have done manually.
- Do **not** execute `step.command` through `sh -c`. Parse the command into argv with the same restricted shell-word parser used by recovery-step tests (quotes are allowed; shell operators, redirection, command substitution, glob expansion, pipes, and control operators are not).
- Executable commands must pass both checks:
  1. argv starts with `dbcli`;
  2. argv matches the per-`error.code` allowlist grammar for recovery commands (for example, `BLACKLIST_TABLE` may allow `blacklist list`, `inspect --for-agent`, and `blacklist remove <table>`, while `SNIPPET_NOT_FOUND` may allow `queries list`, `queries search <term>`, and `queries suggest perf`). The allowlist is code-owned; it is not inferred from the untrusted envelope's risk labels.
- Spawn shape: `Bun.spawn(argvForStep, { cwd, env, stdin: "ignore" })`.
- `cwd` resolution:
  - auto source (`.dbcli/last-recovery.json`) uses the wrapper `cwd`;
  - `--from` with `SavedRecoveryEnvelope` uses the wrapper `cwd`;
  - `--from` with raw `RecoveryEnvelope` uses `process.cwd()`;
  - if the resolved cwd no longer exists, exit 2 with a malformed/unusable-source error.
- `env` inherits `process.env` unchanged. No secrets are added to the child environment by the recovery layer.
- Per-step caps: 64 KB stdout, 64 KB stderr (truncate, mark `truncated: true`), 60 s wall-clock timeout (configurable later, hard-coded for MVP).
- **Fail-fast.** First step with `status === "failed"` stops the run. Skipped steps do not count as failures.
- Steps run sequentially in the order emitted by the envelope; no parallelism.

### Output contract

Default `--format json` (aggregated, single object at end of run):

```json
{
  "schemaVersion": 1,
  "startedAt": "2026-05-10T11:30:00.000Z",
  "finishedAt": "2026-05-10T11:30:04.213Z",
  "source": { "kind": "auto" | "from", "path": ".dbcli/last-recovery.json" },
  "envelope": { /* the input RecoveryEnvelope, echoed for context */ },
  "results": [
    {
      "order": 1,
      "command": "dbcli inspect --for-agent",
      "status": "ok",
      "exitCode": 0,
      "durationMs": 312,
      "stdout": "...",
      "stderr": "",
      "truncated": false
    },
    {
      "order": 2,
      "command": "dbcli init --force",
      "status": "skipped:interactive",
      "reason": "Step requires interactive TTY; rerun manually."
    },
    {
      "order": 3,
      "command": "dbcli schema <table> --format json",
      "status": "skipped:placeholder",
      "reason": "Step contains unresolved placeholders: <table>."
    }
  ],
  "finalStatus": "ok" | "failed" | "skipped-only",
  "stoppedAt": null
}
```

`finalStatus` is:

- `"ok"` — at least one step ran successfully and no step failed.
- `"failed"` — a step exited non-zero (fail-fast); `stoppedAt` = that step's `order`.
- `"skipped-only"` — every step was skipped (no execution occurred); useful signal that risk gate is too tight.

`--format markdown` produces a per-step section + final summary suitable for human inspection. Schema is informal; JSON is the contract.

### Process exit codes

| Exit code | Condition |
|---|---|
| 0 | `finalStatus = ok` |
| 1 | `finalStatus = failed` |
| 2 | No envelope available, or envelope is malformed |
| 3 | `finalStatus = skipped-only` (every step blocked by risk gate or interactive) |

Exit 3 is distinct so agents can detect "you need to pass `--allow-write`" vs "the fix actually failed".

### Architecture

```text
src/core/recovery/
  apply.ts             # plan source resolution, risk gate, child-process orchestration
  apply-types.ts       # ApplyResult / StepResult / ApplyOutcome types
  apply-render-json.ts
  apply-render-markdown.ts
  last-envelope.ts     # atomic read/write of .dbcli/last-recovery.json
src/commands/recover.ts  # NEW (parses --apply / --from / --allow-write / --format)
```

Wiring:

- Every `emitRecoveryEnvelope()` call also invokes `last-envelope.ts:write()`. Failures to write are warnings, not errors.
- `dbcli recover` is a new top-level command. Without `--apply` it prints last envelope (Markdown by default, JSON with `--format json`); with `--apply` it executes.

### Boundaries (P3)

**In scope:**

- New `dbcli recover` command (with `--apply`, `--from`, `--allow-write`, `--format`).
- Auto-write `.dbcli/last-recovery.json` on every recovery envelope emission.
- `GuideStep.interactive`, `GuideStep.dbWrite`, and `GuideStep.placeholders` optional fields.
- Mark existing `dbcli init` / `dbcli init --force` steps with `interactive: true`.
- Mark existing placeholder-bearing steps with `placeholders`.
- Risk gate skipping with structured per-step reason.
- Command validation / allowlisting before child-process execution.
- Aggregated JSON output and Markdown rendering.
- Tests: unit (gating logic, placeholder detection, unsafe command rejection, plan source resolution), integration (full --apply on each recovery code).

**Out of scope (deferred to P4):**

- Verification step that re-runs the original failing operation.
- Re-running the original command before `--apply` to confirm the error still applies (`--verify-applies`).

**Out of scope (deferred to P2):**

- Multi-turn `--next --after-step N --result <json>` protocol.
- Branching plans based on prior step output.
- Session-level memory (P6).

**Out of scope (this milestone, no plans):**

- Adding new recovery codes / classifying more driver errors (P5 — tracked separately).
- Recovery telemetry to `.dbcli/recovery-events.jsonl` (P7).
- Adaptive steps that read env / file context to filter (P1).

### Acceptance criteria (P3)

- `dbcli recover --apply` runs every executable `risk=readonly` and `risk=dry-run` step on each of the 14 recovery codes without `--allow-write`, skips unresolved placeholder steps, and exits 0 when at least one step ran successfully and no genuine failure occurred.
- Each existing `risk=write` step is `skipped:risk` by default; same step runs under appropriate `--allow-write` tier.
- `dbcli init` and `dbcli init --force` steps are marked `interactive: true` and skipped with `skipped:interactive` regardless of `--allow-write`.
- Steps containing `<table>`, `<hint>`, `<snippet>`, `<name>`, `<value>`, or declared placeholders are skipped with `skipped:placeholder`.
- A malicious or hand-authored `--from` envelope cannot execute non-dbcli commands, shell metacharacters, redirection, pipes, command substitution, or dbcli commands outside the code-owned allowlist; such steps are skipped with `skipped:unsafe-command`.
- `.dbcli/last-recovery.json` is atomically written on every recovery envelope emission across query / q / insert / update / delete / export / schema / inspect.
- `--from <file>` overrides the auto-saved file and accepts either raw `RecoveryEnvelope` or `SavedRecoveryEnvelope`.
- Exit codes match the table above (0 / 1 / 2 / 3).
- New schema fields (`interactive`, `dbWrite`, `placeholders`) are documented in SKILL.md and reference.md.

---

## P4 — Verification step (sketch)

### Intent

After `--apply` finishes, run **one extra step** that proves whether the original failure is gone. Keep it cheap and read-only.

### Schema sketch

Add a `verify?: GuideStep` to `RecoveryEnvelope`:

```ts
export interface RecoveryEnvelope {
  // ...existing
  verify?: GuideStep
}
```

`verify` is **always `risk: 'readonly'`** and is appended automatically by `stepsForCode()` per recovery code. Examples:

| Code | Verification command |
|---|---|
| `BLACKLIST_TABLE` | `dbcli inspect --for-agent` (confirm permission/blacklist context) |
| `SCHEMA_CACHE_MISSING` | `dbcli schema <table> --format json` |
| `CONN_REFUSED` / `CONN_AUTH_FAILED` / etc. | `dbcli doctor --format json` |
| `SNIPPET_NOT_FOUND` | `dbcli queries list --format json` |

### Apply behaviour

- `--apply` runs `verify` after the main plan **only if `finalStatus = ok`**. (`failed` / `skipped-only` mean no point.)
- Verification result attached to output as `verifyResult: StepResult`.
- A new `verifyStatus: "passed" | "failed" | "indeterminate"` is computed by inspecting the verifier's stdout against the original error context. Heuristic-only for v1; agents should also do their own check.

Decisions left for P4 spec: the heuristic for `verifyStatus`, whether `--apply --no-verify` is supported, and whether to expose `dbcli recover --verify` as a standalone subcommand.

---

## P2 — Multi-turn protocol (sketch)

### Intent

Allow plans to branch based on the result of a prior step, instead of running the whole pre-baked list. Without this, a doctor command's output can't redirect the next step.

### Command sketch

```bash
dbcli recover --next --after-step 1 --result '<json>' --from .dbcli/last-recovery.json
```

Returns a single next-step `GuideStep` (not the full plan), or `done` when the plan is exhausted.

Hard requirement: branching is **deterministic** — same input → same next step. No LLM or non-deterministic logic.

### Likely refactors

- `stepsForCode(code, ctx)` becomes a **stepper** with a hidden state machine per code. The "list of 6" current shape is the trivial linear case.
- A new `RecoveryStepper` interface in `recovery-steps.ts`: `{ first(ctx) -> GuideStep, next(state, prevResult) -> GuideStep | "done" }`.
- Backwards-compat: `stepsForCode()` keeps producing the linear list by walking the stepper to exhaustion.

Decisions left for P2 spec: result-payload shape, state encoding (cursor vs reified state), and whether `--next` is its own command or a flag on `recover`.

---

## Schema impact summary (whole milestone)

| Change | Stage | Breaking? | Schema bump? |
|---|---|---|---|
| `GuideStep.interactive?: boolean` | P3 | no (additive) | no |
| `GuideStep.dbWrite?: boolean` | P3 | no (additive) | no |
| `RecoveryEnvelope.verify?: GuideStep` | P4 | no (additive) | no |
| Multi-turn stepper internals | P2 | no (call site stays linear) | no |

Whole milestone is forward-compatible with existing v1.16 envelope consumers.

---

## Open questions

These are explicit unknowns the plan phase needs to settle before writing code.

1. **`--allow-write` flag syntax.** Single flag with values (`--allow-write=readonly-cmd`) vs two booleans (`--allow-local-writes` + `--allow-db-writes`)? Spec uses the former; planning may revisit if commander.js / yargs ergonomics push back.
2. **stdout/stderr capture limits.** Spec says 64 KB. Confirm against largest realistic recovery step output (`dbcli queries list --format json` on a workspace with hundreds of snippets — current size?).
3. **Where does `--apply` get invoked from?** Same shell binary as the agent's session, or a separate `dbcli` lookup? Affects how `cwd` and `PATH` are resolved.
4. **Does `--apply` cleanup `.dbcli/last-recovery.json` on success?** Spec leaves it in place (lets agents inspect afterward). Could be revisited if it surprises users.
5. **`dbcli recover` without flags.** Default behaviour: print last envelope as Markdown, exit 0. Confirm during plan whether this matches what `agent task` / SKILL.md expect.

## Out of scope for v1.17.0 entirely

- New recovery codes / driver-specific classification (P5)
- Telemetry log (P7)
- Adaptive context-aware step filtering (P1)
- Session-level "you already tried this" memory (P6)
- Cross-session recovery history (no requirement yet)
