# ForgeFlow Stories

This repository adopted ForgeFlow 0.3.1 from revision
`1096ef5125f1e2d7c304f65d5c7405b76aadf335`; `specs/.forgeflow-adoption` is the
machine-readable record of that. It was first adopted at 0.3.0
(`afca7600db01279ddfe74ac030bd226444cc8b11`).

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
