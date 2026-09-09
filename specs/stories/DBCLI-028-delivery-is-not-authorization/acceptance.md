# Acceptance Criteria

## Happy Path

* [x] AC-001: A Story recorded as completed, backed by a `Story:` trailer, whose
      `## Authority` declares `commit: yes` and `push: no` — the agent committed
      locally and a human pushed — produces no failure.
* [x] AC-002: The same Story declaring `commit: no` and `push: no` — a human took
      over both operations — produces no failure.

## Business Rules

* [x] AC-003: The gate reads no permission from any Story: two delivery claims
      identical except for their Authority text reach the same verdict, so a
      Story omitting `## Authority` or a permission within it gains nothing an
      explicit `no` would have cost it.
* [x] AC-004: Delivery and authorization are separate verdicts: a Story with no
      trailer and no exemption fails while declaring `commit: yes` and
      `push: yes`, and a delivered Story passes while declaring both as `no`.
* [x] AC-005: `scripts/lib/forgeflow-handoff.ts` exports no Authority reader, so
      no second authorization parser exists in this repository.

## Failure Cases

* [x] AC-006: A Story recorded as completed with no `specs/stories` directory,
      no trailer, or a `DELIVERED_BEFORE_TRAILERS` commit this repository does
      not contain still fails by name.
* [x] AC-007: A shallow clone is still refused rather than silently passed, and
      a lifecycle block naming a current or next Story is still refused.

## Regression Requirements

* [x] AC-008: `src/` is unchanged.
* [x] AC-009: `PREDATING_FINDINGS` is still empty and both admitted counts are
      still zero, checked against the adopted ForgeFlow revision.
* [x] AC-010: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a delivered Story a human pushed` | `reconcile returns no failures` |
| `AC-002` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a delivered Story a human committed and pushed` | `reconcile returns no failures` |
| `AC-003` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `three Story sources differing only in Authority` | `identical verdicts` |
| `AC-004` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `an undelivered Story declaring commit and push yes` | `one unbacked-claim failure` |
| `AC-005` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `the module namespace` | `no exported name reads Authority` |
| `AC-006` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `the existing reconcile fixtures` | `each failure names its Story` |
| `AC-007` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `the existing shallowCloneRefusal and readLifecycle fixtures` | `refusal text and violations unchanged` |
| `AC-008` | command | `git diff --stat 87e8c48aa303dbccdc5c36a6aa0cbe0f35fc7995 -- src` | `repository checkout` | `empty output` |
| `AC-009` | command | `bun run forgeflow:contract` | `FORGEFLOW_ROOT set to a clean checkout at cb4bc97673ad3098a4689a1589e1f2c4b5175c63` | `0 admitted pre-existing finding(s)` |
| `AC-010` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/unit/scripts/forgeflow-handoff.test.ts tests/unit/build/adr-references.test.ts
bun run forgeflow:check
FORGEFLOW_ROOT=<clean ForgeFlowV2 checkout> bun run forgeflow:contract
make verify
```

`bun run forgeflow:contract` is not part of `make verify`; it needs a clean
ForgeFlow checkout at the pinned revision and must be run separately.

What human review should weigh is the removal itself. This Story argues that the
repository cannot tell who performed an operation and should therefore stop
claiming it can. If there is an approval record that does establish per-operation
authority for the eight declarations ADR-0030 rewrote, that record — not the
merge history — is what would correct them.
