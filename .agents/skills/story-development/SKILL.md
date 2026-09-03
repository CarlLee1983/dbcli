---
name: story-development
description: Implement an approved ForgeFlow Story when a request names a Story ID or asks to build work from specs/stories, including tests, verification, repair, and delivery reporting.
---

# Story Development

Treat the approved Story as the intent boundary and repository verification as
the completion authority.

## Develop the Story

1. Locate `specs/stories/<story-id>/story.md` and
   `acceptance.md`. Read any optional `task.md` as progress
   context only. If the Story is missing, ambiguous, or conflicts with another
   requirement, identify the exact blocker before changing code.
2. Extract the Goal, in-scope behavior, out-of-scope boundary, inputs, outputs,
   business rules, expected errors, constraints, and every acceptance item. The
   implementation contract is complete when each acceptance item maps to an
   observable behavior or verification check. When the Story is security
   sensitive, treat every row of its security fixture matrix as a required case
   with an exact payload and expected persisted output; when it declares
   superseded behavior, change the named tests deliberately instead of treating
   the conflict as a defect.
3. Read the repository agent guide and inspect the relevant architecture, code,
   tests, dependencies, and documented commands. Project tooling is the source
   of truth for technology-specific mechanics.
4. Form a dependency-ordered implementation plan for the smallest coherent
   end-to-end change. Keep requirement decisions with the human; ask only when a
   missing decision materially changes behavior or risk.
5. Implement within the Story boundary. Add or update tests at the lowest useful
   boundary for changed behavior, including stable regression coverage for
   repaired defects.
6. Run useful focused checks while developing, then run `make verify`
   from the repository root.

## Repair Verification Failures

When verification fails, use its output to find the root cause, repair the
implementation or valid test defect, and run `make verify` again.
Preserve the approved Story, acceptance criteria, and required checks throughout
the loop.

Stop only when:

- `make verify` exits successfully; or
- a genuine specification blocker requires human intent before safe progress is
  possible.

Verification failure by itself is not a specification blocker.

## Deliver

After PASS, report:

- changed files
- implementation summary
- tests added or changed
- the exact verification command and result
- assumptions
- remaining risks

When the work changes hands, record the handoff lifecycle block: exactly one
current Story, exactly one next Story or `pending`, completed Story IDs, the
repository baseline commit and worktree state, and the last verification command
and result. State that selection is pending rather than implying it by ordering.

If specification-blocked, report the conflicting or missing requirement,
evidence already inspected, and the smallest human decision needed. Do not
claim completion.
