# Publish to npm from CI when a version tag is pushed

## Goal

Today the owner publishes every release by hand: merge the release PR, tag
`main`, run `npm publish` locally (`CONTRIBUTING.md` "Publishing",
`README.dev.md` "Publication"). The package is built and published from
whatever happens to be on that machine, with a long-lived npm login, and no
provenance attests which commit it came from.

When this Story is done, pushing a `vX.Y.Z` tag publishes that commit to npm
from GitHub Actions through npm trusted publishing (OIDC), with no npm token
stored anywhere. The publish happens only after the tag has been checked
against `package.json` and `main`, the full `make verify` gate has passed on
that commit, and the owner has approved the run in the `npm-publish`
environment. After publishing, the workflow creates a GitHub Release whose notes
are that version's `CHANGELOG.md` section.

The trusted publisher on npmjs.com (owner `CarlLee1983`, repository `dbcli`,
workflow `release.yml`, environment `npm-publish`, allowed action `npm publish`)
and the `npm-publish` environment with its required reviewer are configured by
the owner; npm expires a new trusted publisher configuration that has not
published within 2 days.

## Out of Scope

- Changing `.github/workflows/ci.yml`, `make verify`, `scripts/release-check.sh`,
  or how release PRs are prepared.
- Publishing from branches, pre-release dist-tags (`next`, `beta`), or
  `npm stage publish`.
- Storing an npm token, or keeping a token-based fallback path.
- Changing `package.json` other than adding a script the workflow needs.
- Configuring npmjs.com or the GitHub environment (the owner does these).
- Publishing 9.2.0 or any other release as part of this Story.

## Acceptance Criteria

1. `.github/workflows/release.yml` exists, is triggered only by `push` of tags
   matching `v*.*.*`, and grants `contents: read` at workflow level; any job
   needing more declares its own `permissions:`.
2. Before anything is published, a job fails unless the tag equals `v` plus
   `package.json`'s `version`, and unless the tagged commit is an ancestor of
   `origin/main`.
3. The same commit passes the repository gate in that workflow: test databases
   started from `docker-compose.test.yml`, `bun run services:check`, then
   `make verify`, with the attestation uploaded as an artifact.
4. The publish job runs only after 2 and 3 succeed, uses `environment: npm-publish`,
   has `id-token: write`, uses a Node and npm version that supports trusted
   publishing (npm ≥ 11.5.1, failing the job otherwise), installs with
   `bun install --frozen-lockfile`, and runs `npm publish` with no
   `NODE_AUTH_TOKEN` / `NPM_TOKEN` referenced anywhere in the workflow.
5. A job after a successful publish, with `contents: write`, creates the GitHub
   Release for the tag, using the `## [X.Y.Z]` section of `CHANGELOG.md`
   (heading excluded, up to the next `## [` heading) as its notes. Extraction is
   a script under `scripts/` that exits non-zero when the section is missing or
   empty, covered by a test under `tests/unit/scripts/`.
6. A test under `tests/unit/` parses `release.yml` and fails if criteria 1, 4
   (environment, `id-token`, no token reference) or the job ordering of 2–5
   stop holding.
7. `CONTRIBUTING.md` "Release Process" and `README.dev.md` describe the tag-driven
   flow, the one-time owner setup (trusted publisher fields, environment and
   reviewer), and drop the local `npm publish` instruction except as a stated
   emergency fallback.
8. `make verify` passes.
