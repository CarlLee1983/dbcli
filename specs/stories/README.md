# ForgeFlow Stories

This repository adopted ForgeFlow 0.7.0 from revision
`cb4bc97673ad3098a4689a1589e1f2c4b5175c63`; `specs/.forgeflow-adoption` is the
machine-readable record of that. It was first adopted at 0.3.0
(`afca7600db01279ddfe74ac030bd226444cc8b11`), then 0.3.2, then 0.6.0, then 0.7.0
via `./scripts/bootstrap --upgrade` from a ForgeFlow checkout.

The recorded revision is the `v0.7.0` tag, not the checkout `bootstrap` happened
to be at — a marker naming an untagged revision makes "which release is this" a
question with two answers.

`make verify` runs `bun run forgeflow:check`, which reconciles the handoff's
`completed_stories` against the repository, in both directions: every recorded
Story needs a `Story:` commit trailer, and every Story whose trailer this
checkout's history carries needs an entry. Upstream's `story-check` and
`handoff-check` are static structure checks that live in a ForgeFlow checkout
and are documented as never deciding whether a declaration is truthful; this
repository's check covers that separate layer and duplicates neither.

**Add the `completed_stories` entry in the change that delivers the Story**, in
the same commit as the trailer or the same pull request. Recording it after the
merge is what left DBCLI-022 to DBCLI-027 unrecorded, and it turns `main` red in
between. ADR-0032.

Create a Story by copying the template:

```sh
cp -R specs/stories/_template specs/stories/<story-id>
```

Complete `story.md` and `acceptance.md` before approval. `task.md` is optional
implementation-progress context and is not a source of product requirements.
