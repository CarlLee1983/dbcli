# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing.

## Happy Path

* [ ] The adoption records 0.6.0 at the tagged release.
      Evidence: `specs/.forgeflow-adoption` reads `version=0.6.0` and
      `revision=51ab1f20defffc9477c02989989dcda244df791e`, which is
      `git rev-parse v0.6.0^{commit}` in the ForgeFlow repository.
* [ ] Every adoption surface agrees.
      Evidence: `bun run forgeflow:check` → exit `0`, reporting agreement with
      `specs/stories/README.md` and five other surfaces.
* [ ] The templates carry the new sections a Story may now declare.
      Evidence: `specs/stories/_template/story.md` contains `## Authority`,
      `## Risk`, `## Architecture` and a `Task mode:` bullet;
      `specs/stories/_template/acceptance.md` contains `## Acceptance Evidence`.
* [ ] Upstream's checkers pass against this repository.
      Evidence: with a checkout at the adopted revision,
      `FORGEFLOW_ROOT=<checkout> bun run forgeflow:contract` → exit `0`,
      reporting 26 Stories — the 25 that existed plus this one — 21 admitted
      findings, and handoff contract OK.
* [ ] `handoff-check` now passes where it used to fail.
      Evidence: upstream `handoff-check` on `specs/handoff.md` reports
      `HANDOFF_CONTRACT_OK`; under v0.3.2 the same file reported eight
      `completed Story is not a Story ID: DBCLI-PLAT-*` failures.

## Business Rules

* [ ] The upgrade changed only what upstream manages.
      Evidence: `./scripts/bootstrap --upgrade --dry-run` from a v0.6.0 checkout
      lists exactly the three `_template/` files and the marker, and
      `git diff --stat` for this Story shows no other file changed by bootstrap.
* [ ] A checkout at another revision is refused.
      Evidence: `FORGEFLOW_ROOT=<a v0.5.2 checkout> bun run forgeflow:contract`
      exits non-zero naming both revisions.
* [ ] No checkout at all is refused, not skipped.
      Evidence: `bun run forgeflow:contract` with `FORGEFLOW_ROOT` unset exits
      non-zero and names the commands that produce a usable checkout.
* [ ] Every one of the 21 pre-existing findings is admitted exactly, by Story.
      Evidence: `PREDATING_FINDINGS` in
      `scripts/lib/forgeflow-contract.ts` lists 21 findings across
      `DBCLI-PLAT-004`, `005`, `006`, `007` and `012`, each string identical to
      what upstream prints.
* [ ] A new finding in an exempt Story fails; a fixed one fails as a stale
      entry; a Story with no entry must be clean.
      Evidence: fixture tests in
      `tests/unit/scripts/forgeflow-contract.test.ts`.
* [ ] The list cannot grow without a deliberate edit.
      Evidence: `ADMITTED_FINDINGS` and `ADMITTED_STORIES` are compared against
      `PREDATING_FINDINGS` by a test, so adding an entry fails until someone
      lowers — never raises — those numbers. Verified by adding an entry: the
      suite goes red. Shrinking is already mechanical, since a fixed finding
      fails as a stale entry; this is the other direction, which was a sentence
      in a header that nothing checked.
* [ ] `make verify` is unchanged by this Story.
      Evidence: `git diff 284b5211..HEAD --name-only -- Makefile src
      tests/contract` is empty. The range starts at DBCLI-017's delivered
      commit, not at `main`: this branch is stacked on it, and its attestation
      work does change the `Makefile`, so a diff from `main` would attribute
      that change here.
* [ ] The offline guarantee is intact.
      Evidence: `bun run forgeflow:check` — the only ForgeFlow step in
      `make verify` — exits `0` with `FORGEFLOW_ROOT` unset, and neither
      `check-forgeflow-adoption.ts` nor `check-forgeflow-handoff.ts` reads that
      variable.

## Failure Cases

* [ ] A Story upstream refuses to read is not counted as a clean Story.
      Evidence: with a Story directory whose `acceptance.md` is empty, upstream
      exits 2 printing an `ERROR` line and no `FAIL` lines; the gate exits
      non-zero quoting it. Before this was checked, that Story was counted as
      satisfying the contract and the total simply went up by one.
* [ ] A handoff that upstream cannot read is not "handoff contract OK".
      Evidence: with `specs/handoff.md` emptied, upstream exits 2 with no `FAIL`
      lines and the gate exits non-zero — the states the handoff contract exists
      to prevent used to be reported as passing.
* [ ] A checkout with uncommitted changes is refused.
      Evidence: edit `scripts/story-check` in the checkout to suppress a finding
      and the gate exits non-zero quoting the dirty path — `rev-parse HEAD` is
      unchanged by such an edit, so revision alone would have gone on asserting
      the adopted rules while running somebody's local ones.
* [ ] A path git cannot read is refused as that, not as an unset variable.
      Evidence: `FORGEFLOW_ROOT=/nonexistent` names the path and says it is not
      a readable git checkout, rather than telling the reader to set a variable
      they already set.
* [ ] A Story directory upstream cannot read is not invisible.
      Evidence: a directory holding only `acceptance.md` makes upstream exit 2;
      the gate refuses. Discovery is upstream's — one no-argument run from the
      repository root — so a directory this gate would not have globbed is still
      seen.
* [ ] A checkout at the adopted revision that cannot run the checker is refused.
      Evidence: with `scripts/` removed from the checkout, the gate exits
      non-zero naming the missing `story-check`, rather than reading zero
      findings for every Story.
* [ ] A marker recording no revision is refused rather than defaulting.
      Evidence: the gate exits 1 naming `specs/.forgeflow-adoption`.
* [ ] A Story directory that upstream reports on but that has no exemption entry
      fails, with the finding quoted rather than counted.
      Evidence: fixture test `a finding in a Story with no exemption fails`.

## Regression Requirements

* [ ] `make verify` passes on the delivered commit, run by ForgePilot in a
      detached worktree of that exact revision, offline and with no ForgeFlow
      checkout present.
* [ ] DBCLI-016's refusal rules and DBCLI-017's attestation are untouched.
      Evidence: `bun run forgeflow:check` and the attestation unit tests pass
      unchanged.
* [ ] No delivered Story's text is edited.
      Evidence: `git diff 284b5211..HEAD --name-only -- specs/stories/` names
      exactly five paths: this Story's two files, the two templates upstream's
      bootstrap replaced, and `specs/stories/README.md`. The README carries the
      canonical adoption declaration that `bun run forgeflow:check` compares
      against the marker, so the upgrade cannot land without it. No file under a
      delivered Story's directory appears.

## Known Limits

The Acceptance Evidence map is expressible and unenforced. It is a
`story-check --ready` check, and this gate runs the default mode; DBCLI-018's
own Story fails `--ready` on exactly that finding and on checkbox AC
identifiers. Adopting `--ready` is a decision about every future Story and needs
a second exemption set for the twenty-five that predate it, so it is out of
scope here — named rather than left to be discovered. Authority, Risk and Task
mode are checked in the default mode and so are enforced from this Story
onward.

## Verification Notes

The contract gate is deliberately not a `make verify` step: it needs a second
checkout, and the canonical gate must run from a clone of this repository alone.
CI runs it as its own job. Confirm from the pull request that the
`forgeflow-contract` job ran and passed, and record the run URL.

The 21 admitted findings are a debt, not a decision that the rules do not apply.
The delivery report names them by Story and rule so the follow-up Story starts
from a list rather than a rediscovery.
