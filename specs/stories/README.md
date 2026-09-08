# ForgeFlow Stories

This repository adopted ForgeFlow 0.6.0 from revision
`51ab1f20defffc9477c02989989dcda244df791e`; `specs/.forgeflow-adoption` is the
machine-readable record of that. It was first adopted at 0.3.0
(`afca7600db01279ddfe74ac030bd226444cc8b11`), then 0.3.2, then 0.6.0 via
`./scripts/bootstrap --upgrade` from a ForgeFlow checkout.

The recorded revision is the `v0.6.0` tag, not the checkout `bootstrap` happened
to be at — that was two documentation commits later, and a marker naming an
untagged revision makes "which release is this" a question with two answers.

`make verify` runs `bun run forgeflow:check`, which reconciles the handoff's
`completed_stories` against the repository. Upstream's `story-check` and
`handoff-check` are static structure checks that live in a ForgeFlow checkout
and are documented as never deciding whether a declaration is truthful; this
repository's check covers that separate layer and duplicates neither.

Create a Story by copying the template:

```sh
cp -R specs/stories/_template specs/stories/<story-id>
```

Complete `story.md` and `acceptance.md` before approval. `task.md` is optional
implementation-progress context and is not a source of product requirements.
