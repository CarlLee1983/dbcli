# Acceptance Criteria

## Happy Path

* [ ] AC-001: `specs/handoff.md` carries no delivery-narrative section for a
      Story that `completed_stories` records.
* [ ] AC-002: `baseline.story_owned_paths` and `baseline.known_unrelated_paths`
      are `[]`, and `dirty_worktree` is `false`.

## Business Rules

* [ ] AC-003: A heading naming a recorded Story fails the gate, naming the Story.
* [ ] AC-004: A heading naming a Story that is *not* recorded is allowed —
      in-flight work and issue-accepted deliveries have no other home.
* [ ] AC-005: A clean worktree declaring an owned path fails the gate, naming
      the field; a dirty one may declare paths.
* [ ] AC-006: Every removed section names the commit whose body holds the fuller
      record, and nothing is removed without one.

## Failure Cases

* [ ] AC-007: The existing failures are unchanged — a recorded Story with no
      trailer, a stale exemption, a missing commit, an unrecorded delivery, and a
      lifecycle block naming a current or next Story.
* [ ] AC-008: A shallow clone is still refused before any of it runs.

## Regression Requirements

* [ ] AC-009: `src/` is unchanged.
* [ ] AC-010: `bun run forgeflow:contract` passes — upstream's `handoff-check`
      reads the same block — with `PREDATING_FINDINGS` still empty.
* [ ] AC-011: The complete repository verification gate passes.

## Acceptance Evidence

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | command | `bun run forgeflow:check` | `this branch` | `reconciliation passed` |
| `AC-002` | command | `grep -A2 story_owned_paths specs/handoff.md` | `this branch` | `both lists are []` |
| `AC-003` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a handoff with a recorded Story's section` | `one violation naming the Story` |
| `AC-004` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a heading naming an unrecorded Story` | `no violation` |
| `AC-005` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `a clean worktree with one owned path` | `one violation naming the field` |
| `AC-006` | human | `the commit that delivers this Story` | `its body lists each removal with its licensing commit` | `every removed section is accounted for` |
| `AC-007` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `the existing reconcile and lifecycle fixtures` | `unchanged verdicts` |
| `AC-008` | test | `tests/unit/scripts/forgeflow-handoff.test.ts` | `git rev-parse --is-shallow-repository answering true` | `refusal naming --unshallow` |
| `AC-009` | command | `git diff --stat 74902810 -- src` | `repository checkout` | `empty output` |
| `AC-010` | command | `bun run forgeflow:contract` | `FORGEFLOW_ROOT at cb4bc976` | `handoff contract OK` |
| `AC-011` | command | `make verify` | `repository checkout` | `exit 0` |

## Verification Notes

```sh
bun test tests/unit/scripts/forgeflow-handoff.test.ts
bun run forgeflow:check
FORGEFLOW_ROOT=<clean ForgeFlowV2 checkout> bun run forgeflow:contract
make verify
```

What human review should weigh is the removal licence: a section goes only when
a commit carrying that Story's trailer holds a body of at least eight lines, and
the delivering commit lists each removal against the commit that licenses it.
Four Stories in this history have thinner bodies than that, and the 2026-09-08
adoption assessment is nobody's commit message; those move rather than
disappear. If the licence is wrong, this is prose a human wrote being deleted on
a rule, which is the kind of change this repository normally refuses.
