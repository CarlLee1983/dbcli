# Verify Scenario Contract — Publish Evaluation

**Date:** 2026-06-24
**Status:** Decision — **Defer** (do not publish a public scenario contract yet)
**Baseline:** dbcli v1.38.1; four built-in verify scenarios
(`safe-backfill`, `migration`, `rollback`, `constraint`)

> **Decision summary:** The literal deferral trigger ("at least three built-in
> scenarios share the same stable lifecycle") has fired — four scenarios now drive
> the generic `executeScenario` lifecycle. But that trigger is **necessary, not
> sufficient**. The binding condition is "stable lifecycle **in production**"
> (`2026-06-22-verify-rollback-scenario.md:293`), which is **not** met. We defer
> again and replace the now-satisfied-but-insufficient count trigger with three
> sharper, measurable re-gates (§5). No code, no `docs/user/` change results from
> this decision.

## 1. Question

Should the internal `VerifyScenarioDefinition` seam be promoted to a **public /
external** scenario contract, allowing scenarios to be defined outside the
built-in set (third-party or user-defined verify scenarios / a scenario DSL)?

This is the deferred follow-up raised, in consistent terms, across three specs:

| Source | Wording |
|---|---|
| `2026-06-22-verify-scenario-registry.md:190` | "Reconsider a **public scenario/plugin contract** only after at least three built-in scenarios share the same stable lifecycle." |
| `2026-06-20-verification-workflow-suite-follow-up.md:404` | "It should not become an **external scenario DSL** until the CLI contracts are stable across at least three scenarios." |
| `2026-06-22-verify-rollback-scenario.md:293` | "Revisit a **public scenario contract** only after the three built-ins share the stable lifecycle **in production**." |

## 2. What "publishing" would mean

Today `VerifyScenarioDefinition` (`src/core/verify/registry.ts:35`) is an
**internal** seam, explicitly labelled *"auditable, never user-extended"*
(`registry.ts:7`). All four built-ins implement it and are driven by the shared
`registerScenario` + `executeScenario` loop (`src/commands/verify.ts:1133-1260`).

Publishing means turning that internal interface into an **external contract**:
a stability promise that third parties / users can author their own verify
scenarios against, plus the surface (exported types, possibly a DSL/plugin
loader) and the compatibility burden that follows.

## 3. Condition check

The condition has two halves. Only the first is met.

### ✅ Half 1 — "at least three scenarios share the same stable lifecycle"

Met. Four scenarios (`safe-backfill`, `migration`, `rollback`, `constraint`) are
all defined as `VerifyScenarioDefinition` instances in `BUILTIN_VERIFY_SCENARIOS`
and execute through the single generic `executeScenario` lifecycle. Registry
invariant tests are green. Architecturally the contract is genuinely shared
across four implementations.

### ❌ Half 2 — "stable lifecycle **in production**"

Not met. Three independent signals:

1. **Near-zero production soak.** Two of the four scenarios landed on
   2026-06-22: `rollback` shipped in tag `v1.37.0`; `constraint` only reaches a
   tag at **`v1.38.1` (2026-06-23, one day before this evaluation)** —
   `v1.38.0` was never tagged. Per project record, **npm publish is deferred**
   for the v1.37/v1.38 line, so half the contract surface is not externally
   released at all. "In production" is not demonstrable.

2. **The contract enum was still being patched as the 4th scenario landed.**
   Commit `d8bc2c4` (*"fix: [verify] register 'table' subject kind in runtime
   allow-list"*) added to the `VerifyScenarioSubjectKind` allow-list while
   `constraint` was landing. `registry.ts:8` (`'table' | 'migration' |
   'rollback'`) grows with each scenario. A contract axis that needed a fix two
   days ago is not yet stable enough to freeze as a public promise.

3. **No external demand.** The sole reason to publish is to let someone define a
   scenario outside the built-in set; no such request exists. This is exactly
   the case the registry spec warns against —
   `2026-06-22-verify-scenario-registry.md:179`: *"Do not model future scenarios
   until they exist."* Publishing now is speculative (YAGNI).

## 4. Decision

**Defer.** Keep `VerifyScenarioDefinition` internal. Make no public stability
promise, export no plugin/DSL surface. The count trigger has fired but is
insufficient; the production-stability condition is unmet and there is no
pull-side demand.

## 5. Replacement re-gates

The "three scenarios" trigger is now satisfied yet inconclusive, so it should not
be the thing that reopens this. Replace it with all three of the following,
**which must hold together** before re-evaluating:

- **Soak gate** — the four scenarios survive ≥N releases / several weeks with
  **zero changes** to `VerifyScenarioDefinition` members and the
  `VerifyScenarioSubjectKind` enum (i.e. the contract shape has actually stopped
  moving).
- **Release gate** — `rollback` and `constraint` are actually npm-published and
  have accrued non-zero production soak (closes the gap left by the deferred
  v1.37/v1.38 publish).
- **Demand gate (pull-based)** — at least one concrete request to author a
  verify scenario outside the built-in set exists; design the external contract
  to that real need rather than a speculative one.

Until all three hold, `VerifyScenarioDefinition` stays internal and carries no
external compatibility guarantee.

## 6. Non-Goals / consequences

- No change to `src/`; no change to `docs/user/` (no user-facing behavior
  change). This document is the only artifact.
- Does not preclude internal refactors of the scenario contract — internal
  freedom is precisely what deferral preserves.
- Supersedes the count-based trigger in
  `2026-06-22-verify-scenario-registry.md:190`,
  `2026-06-22-verify-rollback-scenario.md:293`, and
  `2026-06-20-verification-workflow-suite-follow-up.md:404` as the criterion for
  reopening this question.
