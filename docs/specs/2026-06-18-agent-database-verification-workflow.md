# Agent Database Verification Workflow - Strategy Note

**Date:** 2026-06-18
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.32.0

## Purpose

This note captures the recommended next direction after the v1.32.0 skill,
plugin, task-pack, and parity work.

The core recommendation is: do not continue by only making `SKILL.md` larger.
The skill surface is now strong enough that the next high-leverage step is to
turn dbcli into an agent database verification layer: a repeatable protocol for
safe database context, planned operation, recovery, verification, and audit
evidence.

Recommended product framing:

> Safe, auditable, verifiable database operations for AI agents.

## Current Position

dbcli already has most of the required primitives:

| Area | Current strength | Notes |
| --- | --- | --- |
| Agent safety | High | permission tiers, blacklist, dry-run, recovery, audit |
| Agent context | High | `inspect`, `report`, `guide`, `skill context` |
| Skill/plugin distribution | High | Codex, Claude, Cursor, Copilot, Windsurf, Gemini/Antigravity surfaces |
| Task packs | Medium | v1.32.0 ships useful plan-only packs, but the workflow catalog is still small |
| Verification | Medium-high | `snapshot`, `assert`, recovery verification, audit traces exist but are not yet one product loop |
| Performance evidence | Medium-high | `proxy analyze`, `explain`, `guide missing-index-for`, report snippets |
| Embedded engine/API | Medium | `@carllee1983/dbcli/core` is emerging, useful for GUI/sidecar later |

The main gap is not missing individual commands. The gap is a clear, reusable
agent loop:

```text
inspect context
-> plan safe workflow
-> execute bounded command
-> recover if failed
-> verify outcome
-> keep audit trace
```

## Strategic Options

### Option A - Keep Optimizing Skill Text

Improve `assets/SKILL.md`, `assets/SKILL.zh-TW.md`, and generated plugin copies
with more scenarios and examples.

Pros:
- Low implementation cost.
- Good for quickly improving agent behavior.
- Fits the existing v1.32.0 release surface.

Cons:
- Diminishing returns: long skills become harder for agents to prioritize.
- Mostly guidance, not capability.
- More text increases parity and maintenance burden.

Use this only for concise routing instructions and command anchors. Avoid
turning the skill into a full playbook.

### Option B - Expand Agent Workflow Packs

Treat task packs as the main next skill-adjacent growth path. The skill should
route agents into `dbcli skill tasks plan ...` instead of carrying every workflow
inline.

Candidate packs:

| Pack | Purpose | Initial mode |
| --- | --- | --- |
| `pr-database-review` | Review changed persistence paths, queries, migrations, exports, fixtures, and blacklist risk | `plan-only` |
| `migration-review` | Check schema evidence, DDL preview, rollback/verification plan | `plan-only` |
| `orm-sync-review` | Compare live schema JSON against ORM/model files | `plan-only` |
| `slow-endpoint-investigation` | Connect proxy/report/explain/missing-index evidence for endpoint slowness | `plan-only` |
| `safe-backfill-verify` | Extend current backfill planning with explicit post-write verification steps | `plan-only` first |
| `incident-db-triage` | First-touch health, recent audit, slow operations, locks, capacity | `plan-only` |
| `staging-readiness-check` | Validate config, connectivity, permissions, blacklist, schema-cache freshness | `plan-only` |
| `data-bug-root-cause` | Separate DB facts from application-code inference for data correctness bugs | `plan-only` |

Pros:
- High leverage because packs are executable plans, not prose.
- Keeps `SKILL.md` compact.
- Easy to test with parser/planner unit tests.
- Fits v1.32.0 architecture.

Cons:
- Plan-only packs are useful but may feel incomplete without verification
  execution semantics.
- Needs careful naming and stable parameters so agents can discover packs
  reliably.

### Option C - Build the Verification Layer

Make verification a first-class product concept. Use existing `snapshot`,
`assert`, `audit`, recovery verification, and task packs to prove database
operations rather than only executing them.

Potential capabilities:

| Capability | Description |
| --- | --- |
| Task-pack verification steps | Allow packs to include explicit verification commands after planned operations |
| Backfill verification workflow | Require scope count, dry-run, execution command, and read-back/assertion plan |
| Migration verification workflow | Capture pre-change schema/snapshot, preview DDL, compare post-change schema/diff/assertions |
| Agent verification summary | Standardize output categories: `verified`, `not_verified`, `indeterminate`, `blocked` |
| Verification artifacts | Store bounded JSON evidence under `.dbcli/` for handoff and audit traceability |
| `verify` command or submode | Optional later command that runs a declared scenario of assertions/snapshots |

Pros:
- Strongest differentiation.
- Aligns with the central risk of AI agents touching databases.
- Builds on shipped primitives instead of adding a separate product.
- Creates a clear story for demos and adoption.

Cons:
- Requires careful design of artifact schemas and command contracts.
- Verification can become engine-specific if not scoped.
- Needs strong tests because agents will treat verification output as authority.

### Option D - Performance Evidence Loop

Connect `proxy analyze`, `report --section perf`, `explain`, and
`guide missing-index-for` into one clearer workflow.

Target loop:

```text
proxy analyze
-> identify hot query/table
-> explain
-> guide missing-index-for
-> propose migration
-> verify before/after with assert/snapshot or report deltas
```

Pros:
- Strong demo value.
- Developers understand slow endpoint pain immediately.
- Uses existing features that are currently somewhat separate.

Cons:
- Higher engine-specific complexity.
- Requires real or fixture-backed examples to demonstrate well.
- Index advice must remain advisory; dbcli should not directly create indexes
  from performance suggestions without migration review.

### Option E - Embedded Engine / GUI / SDK

Continue opening `@carllee1983/dbcli/core` for dbcli-gui, sidecars, or other
products.

Pros:
- Long-term platform value.
- Lets other tools reuse the safety model.
- Good fit after protocol/artifact contracts stabilize.

Cons:
- Higher product and API design cost.
- Can distract from the CLI's core agent workflow if started too early.
- Public API stability burden is larger than task-pack or verification work.

## Recommendation

Recommended sequence:

1. Expand task packs as the next skill-adjacent surface.
2. Use those packs to define an agent database verification workflow.
3. Promote verification as the product narrative.
4. Defer GUI/SDK expansion until the verification protocol is clearer.

Do not frame the next milestone as "skill optimization". Frame it as:

> Agent Database Verification Workflow

The skill remains the router. Task packs become the workflow catalog.
Verification artifacts become the evidence that the workflow succeeded.

## Proposed Milestone Shape

### Milestone 1 - Workflow Pack Expansion

Goal: add a small set of high-value task packs that cover developer and agent
workflows without changing runtime behavior.

Candidate scope:

- Add 3-4 packs only:
  - `pr-database-review`
  - `migration-review`
  - `safe-backfill-verify`
  - `slow-endpoint-investigation`
- Keep all packs `plan-only`.
- Add unit tests for parser/planner output.
- Update `assets/SKILL.md` and `assets/SKILL.zh-TW.md` only with compact routing
  guidance.
- Run `skill:check`, `plugin:check`, `platform:check`, `docs:check`.

Success criteria:

- Agents can discover the new packs with `dbcli skill tasks list`.
- Each pack has clear params, risk labels, and safe command order.
- Skill text points agents to packs instead of duplicating every step.

### Milestone 2 - Verification Contract Design

Goal: define the minimal schema and language for verification outcomes.

Questions to answer:

- Is verification represented only as task-pack steps, or as a new command?
- Where are verification artifacts stored?
- What are the stable statuses?
- How does verification relate to audit entries and recovery envelopes?
- Which engines are supported in the first pass?

Suggested status vocabulary:

| Status | Meaning |
| --- | --- |
| `verified` | Required verification command succeeded and expected evidence matched |
| `not_verified` | Verification was required but failed |
| `indeterminate` | Command ran but evidence was insufficient or ambiguous |
| `blocked` | Verification could not run due to permission, missing schema, missing config, or placeholder |

### Milestone 3 - Verification Implementation

Goal: make one workflow end-to-end verifiable.

Recommended first workflow: `safe-backfill-verify`.

Why:
- It is high-risk enough to justify verification.
- It has a simple required shape: scope count, dry-run, write command, read-back.
- Existing safety primitives already support it.

Potential implementation paths:

1. Task-pack-only: generate a plan that includes verification commands but does
   not execute them.
2. New command: add `dbcli verify <scenario>` later if the task-pack-only model
   proves too limited.

Prefer path 1 first unless the design shows strong need for a new command.

## Skill Guidance Policy

Keep `SKILL.md` short and high-signal.

Good additions:

- When to use task packs.
- Which pack to choose for common situations.
- Non-negotiable safety rules.
- Copy-paste command anchors.

Avoid:

- Full command reference duplication.
- Long examples for every engine.
- Repeating `reference.md`.
- Embedding full recovery walkthroughs.

The skill should answer:

1. Should dbcli be used here?
2. What is the safest first command?
3. Which task pack or guide should the agent call?
4. What must be verified before claiming success?

## Open Decisions

Before implementation, decide:

1. Should the next release be pack-focused only, or include verification schema
   design in the same milestone?
2. Which 3-4 task packs are most valuable for the next release?
3. Should task packs remain `plan-only` for now?
4. Should verification artifacts be introduced before a `verify` command exists?
5. Should performance workflow be a separate milestone or bundled with
   verification?

## Suggested Next Planning Prompt

Use this prompt to continue:

```text
Use docs/specs/2026-06-18-agent-database-verification-workflow.md as the source
of truth. Create a concrete implementation plan for Milestone 1: Workflow Pack
Expansion. Keep it plan-only, add 3-4 task packs, update compact skill routing,
and add tests/parity checks. Do not add a new CLI command yet.
```

## Lifecycle closeout

### Current implementation

The strategy is now represented by the shipped task packs under `assets/tasks/`,
the verification contract and artifact lifecycle under `src/core/verification/`,
and the scenario runner under `src/core/verify/` and `src/commands/verify.ts`.
The loop is exposed through synchronized skill/user documentation and remains
plan-only for task packs; verification scenarios never execute the requested
backfill write.

### Completion evidence

- Workflow-pack implementation: `2eda0cf`, `ae24f62`, `f3abdc0`, `22d14ba`,
  and `43deea6`.
- Verification implementation: `ef89a6b`, `4524d1a`, `fc3fb48`, `44827b5`,
  `3ac63bc`, `a0d7395`, `3e30bb0`, and the subsequent scenario hardening
  commits.
- Verification: the focused verification/core and workflow-pack suites passed
  111 and 13 tests respectively during this audit.
- Documentation and distribution: `bun run skill:check`,
  `bun run platform:check`, and `bun run docs:check` passed.

### Deferred decisions

The public scenario contract remains intentionally deferred. Reopen this
decision when at least three built-in scenarios have stable production evidence
for one release and their lifecycle/exit semantics remain compatible. Engine
coverage and performance-evidence expansion remain follow-up work rather than
claims of universal support.

The planning prompt above is retained as historical context; it is not a
current instruction or source-of-truth claim.
