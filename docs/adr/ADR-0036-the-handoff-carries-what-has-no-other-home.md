# The handoff carries what has no other home

* Status: accepted
* Date: 2026-09-10

`specs/handoff.md` reached 1,132 lines. About 870 of them were delivery
narrative for Stories that `completed_stories` already recorded — one section
per delivered Story, written at delivery and never removed.

Nothing had ever asked for a line to be removed. That is the same failure the
delivery list itself had before DBCLI-029: a record checked in one direction
only, which can therefore rot in exactly one direction. Here it is one document
up, and it was invisible to every gate this repository has, because upstream's
handoff contract says in as many words that the prose around the lifecycle block
is the writer's business and its checker ignores it.

The file had already written down the answer, at line 48:

> 每個 Story 的理由寫在自己的 commit body 裡，比這份摘要完整——要理解某個決定
> 為什麼是那樣，讀 commit，不要從這裡重新推導。

## Decision

**A delivered Story's narrative does not live in the handoff.** A `##` or `###`
heading naming a Story that `completed_stories` records fails
`bun run forgeflow:check`. What the handoff carries is what has no other home:
the baseline, work in flight, deliveries accepted against an issue rather than a
Story, and the lifecycle block.

**The licence for removing a section is a fuller record that can be named.** A
section goes only where a commit carrying that Story's trailer holds a body of at
least eight lines. Measured across this history, 38 commits carry a `Story:`
trailer and four have thinner bodies than that. `DBCLI-PLAT-007`'s is one line,
so its section moved to `docs/2026-09-10-handoff-sections-without-a-commit.md`
rather than being deleted, and the 2026-09-08 adoption assessment — nobody's
commit message, a dated evaluation in its own right — moved to
`docs/2026-09-08-forgeflow-and-forgepilot-adoption-review.md`. Nothing was
deleted whose fuller record could not be named.

**A clean worktree owns no paths.** `baseline.story_owned_paths` held about
ninety paths accumulated across a dozen delivered Stories while
`dirty_worktree` was `false` and `current_story` was `none`. Upstream defines
those as the working-tree paths *the Story* owns; with nothing uncommitted and no
Story in progress, the honest value is `[]`, and anything else now fails. The
list grew for the same reason the prose did.

**The rule does not police prose.** It refuses a heading that names a recorded
Story, and makes no attempt to tell narration from a passing reference — a rule
that tried would be arguing about writing, and the answer is the same either
way: say it in that Story's commit. Un-attributed historical narrative is left
alone, as upstream intends; the shape that actually grew was one section per
Story, and that shape is what is now refused.

## Consequences

The file is 180 lines. A reader who needs a delivered Story's reasoning runs
`git log --grep 'Story: <ID>'` or opens `docs/adr/`, which is where the fuller
version always was.

The handoff can now shrink. Every other record in this repository that only grows
— the delivery list before DBCLI-029, the Authority declarations before ADR-0031,
this file — was a record nothing ever asked a question of. The question is
cheaper than the cleanup: this one is two rules and a fixture.

Writing a delivery narrative into the handoff now fails the gate in the same
change that records the Story as completed, because ADR-0032 puts both in the
same commit. There is no window in which the section is allowed.

**Falsified if:** a delivered Story's reasoning stops travelling with its commit
— squashed histories that drop bodies, a policy of one-line commit messages, or a
migration that rewrites them. Then `narrativeViolations` in
`scripts/lib/forgeflow-handoff.ts` is refusing the only copy rather than a
duplicate, and the handoff has to carry that text again.
