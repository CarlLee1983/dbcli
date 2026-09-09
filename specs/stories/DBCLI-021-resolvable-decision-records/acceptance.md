# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing.

## Happy Path

* [ ] The adoption records 0.7.0 at the tagged release.
      Evidence: `specs/.forgeflow-adoption` reads `version=0.7.0` and
      `revision=cb4bc97673ad3098a4689a1589e1f2c4b5175c63`, which is
      `git rev-parse v0.7.0^{commit}` in the ForgeFlow repository.
* [ ] Every adoption surface agrees.
      Evidence: `bun run forgeflow:check` → exit `0`.
* [ ] This Story's decision link is resolved by the checker, not by prose.
      Evidence: with a v0.7.0 checkout, `bun run forgeflow:contract` → exit `0`,
      and removing `docs/adr/ADR-0029-*.md` makes it fail with `referenced
      decision record does not exist: ADR-0029`.
* [ ] `make verify` passes.
      Evidence: `make verify` → exit `0`, and `.verification/attestation.json`
      reads `PASS` at the delivered revision with `dirty_worktree` `false`.

## Business Rules

* [ ] The upgrade changed only what upstream manages.
      Evidence: `./scripts/bootstrap --upgrade --dry-run` from a v0.7.0 checkout
      lists only the `_template/` files and the marker, and `git diff --stat`
      for this Story shows no other file changed by bootstrap.
* [ ] Every record was renamed, none rewritten.
      Evidence: `ls docs/adr` shows every file matching `ADR-[0-9][0-9][0-9][0-9]-*.md`,
      the count is unchanged at 28, and `git log --follow` on any one of them
      reaches its pre-rename history.
* [ ] No reference was left pointing at an old name.
      Evidence: a test walks every `docs/adr/...` path reference in the
      repository and fails on one that does not resolve to a file.
* [ ] The contract check sets the decisions root itself.
      Evidence: `bun run forgeflow:contract` resolves `ADR-0029` with no
      `FORGEFLOW_DECISIONS_ROOT` in the caller's environment.
* [ ] The admitted findings did not grow.
      Evidence: the contract check reports 21 admitted pre-existing findings,
      the same number as under 0.6.0.

## Failure Cases

* [ ] A decision record that does not exist is refused.
      Evidence: a `Decision:` bullet naming `ADR-9999` fails the contract check.
* [ ] A dangling record reference is refused.
      Evidence: the reference test fails when a `docs/adr/` path is edited to
      name a file that does not exist.

## Regression Requirements

* [ ] The `make verify` step list is unchanged.
      Evidence: `git diff 44b30e71..HEAD -- Makefile` shows no change to the
      `verify` recipe.
* [ ] Stories a human approved are unedited.
      Evidence: `git diff 44b30e71..HEAD -- specs/stories/` touches only this
      Story's directory, apart from record-path references updated by the
      rename.

## Known Limits

* The reference test checks paths written as `docs/adr/...`. A record named only
  as `ADR-0028` in prose is not a link and is not checked; there are around 300
  such mentions and they do not rot when a file is renamed.

## Verification Notes

`bun run forgeflow:contract` needs a ForgeFlow checkout at the adopted revision,
which CI provides and `make verify` does not. Both must be run before this Story
is offered for review.
